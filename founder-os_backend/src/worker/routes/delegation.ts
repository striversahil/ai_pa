// ─────────────────────────────────────────────────────────────────────────────
// routes/delegation.ts — employee-facing Delegation board API.
//
// Worker-only (Express is frozen). Sits on top of the single HR task model:
//   GET    /api/delegation/board        → my day (employee) / team board (HR)
//   GET    /api/delegation/tasks/:id/logs → append-only journal for one task
//   POST   /api/delegation/tasks        → create (self task or HR assignment)
//   PATCH  /api/delegation/tasks/:id    → status/remark (+ content on self tasks)
//   DELETE /api/delegation/tasks/:id    → remove (self-created only for employees)
//   PUT    /api/delegation/members/:id/login-email → HR links a roster member
//          to a platform login (drives the Logins panel).
//
// Whoever is signed in may use the board; the service layer scopes every read
// and write to the caller's own roster member unless they hold HR access.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { notifyLive, LiveEvent, type Bindings } from '../context';
import { createAuthStore } from '../../modules/auth/store';
import {
  createSelfTask, deleteDelegationTask, getDelegationBoard, getTaskHistory,
  isHrManager, updateDelegationTask,
} from '../../automations/human-resources/delegation';
import { createTask, updateMember } from '../../automations/human-resources/service';
import { requireViewer } from '../viewer';
import { readBody, writeError } from '../http';

function actorLabel(me: any): string | null {
  return me?.user?.name ?? me?.user?.email ?? null;
}

function errorResponse(c: any, e: unknown) {
  return writeError(c, e, 'request failed');
}

/** Every demo of the platform that can sign in — used only to flag which
 *  roster members already have a working login (Logins panel). */
async function knownLogins(c: any): Promise<Set<string>> {
  try {
    return new Set(await createAuthStore(c.env).listLoginEmails());
  } catch {
    return new Set();
  }
}

export function registerDelegationRoutes(app: Hono<{ Bindings: Bindings }>): void {
  const viewer = async (c: any) => {
    try {
      return { me: await requireViewer(c), error: null };
    } catch {
      return { me: null, error: c.json({ error: 'Authentication required' }, 401) };
    }
  };

  app.get('/api/delegation/board', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    try {
      const board = await getDelegationBoard({
        me: v.me,
        date: c.req.query('date') ?? undefined,
        knownLogins: await knownLogins(c),
      });
      return c.json(board);
    } catch (e) { return errorResponse(c, e); }
  });

  app.get('/api/delegation/tasks/:id/logs', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    try {
      return c.json(await getTaskHistory(c.req.param('id') ?? '', v.me,
        Number(c.req.query('limit') ?? 100)));
    } catch (e) { return errorResponse(c, e); }
  });

  app.post('/api/delegation/tasks', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    const body = await readBody(c);
    try {
      // HR users assign work through the same form the HR dashboard uses;
      // everyone else can only add a task to their own list.
      const row = isHrManager(v.me) && body?.assignedToId
        ? await createTask(body, actorLabel(v.me))
        : await createSelfTask(body || {}, v.me, actorLabel(v.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row, 201);
    } catch (e) { return errorResponse(c, e); }
  });

  app.patch('/api/delegation/tasks/:id', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    const body = await readBody(c);
    try {
      const row = await updateDelegationTask(
        c.req.param('id') ?? '', body || {}, v.me, actorLabel(v.me),
      );
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  app.delete('/api/delegation/tasks/:id', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    try {
      await deleteDelegationTask(c.req.param('id') ?? '', v.me, actorLabel(v.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  app.put('/api/delegation/members/:id/login-email', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    if (!isHrManager(v.me)) {
      return c.json({ error: 'Only HR users can link logins' }, 403);
    }
    const body = await readBody(c);
    try {
      const row = await updateMember(c.req.param('id') ?? '', {
        loginEmail: body?.loginEmail ?? null,
      });
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ id: String((row as any)?.id ?? ''), loginEmail: (row as any)?.loginEmail ?? null });
    } catch (e) { return errorResponse(c, e); }
  });
}
