// ─────────────────────────────────────────────────────────────────────────────
// routes/my-leave.ts — employee leave self-service (full day / half day / short).
//
//   GET  /api/leave/mine                  → my applications + my roster link
//   POST /api/leave/requests              → apply (member forced to the caller)
//   POST /api/leave/requests/:id/cancel    → withdraw my still-pending request
//
// Every approved login may use this; the service layer pins the caller's own
// roster member, so one employee can never read or write another's leave.
// HR decisions live in routes/human-resources.ts (`leave-requests`).
// Worker-only: Express is frozen.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { notifyLive, LiveEvent, type Bindings } from '../context';
import { resolveSelfHumanResourcesMember } from '../../automations/human-resources/service';
import {
  applyLeaveRequest, cancelLeaveRequest, listMyLeave,
} from '../../automations/human-resources/leave-requests';
import { requireViewer } from '../viewer';
import { readBody, writeError } from '../http';

function actorLabel(me: any): string | null {
  return me?.user?.name ?? me?.user?.email ?? null;
}

function errorResponse(c: any, e: unknown) {
  return writeError(c, e, 'request failed');
}

/** The caller's link to the HR roster — no link means no leave applications. */
function unlinked(c: any) {
  return c.json({
    error: 'Your login is not linked to an HR employee record. Ask HR to set your login email.',
  }, 403);
}

export function registerMyLeaveRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/leave/mine', async (c) => {
    let me: any = null;
    try { me = await requireViewer(c); } catch { return c.json({ error: 'Authentication required' }, 401); }
    try {
      const self = await resolveSelfHumanResourcesMember(null, me);
      if (!self) {
        return c.json({ linked: false, self: null, requests: [] });
      }
      return c.json({
        linked: true,
        self: {
          id: self.selfId, name: self.selfName,
          designation: self.designation, matchedBy: self.matchedBy ?? null,
        },
        requests: await listMyLeave(self.selfId),
      });
    } catch (e) { return errorResponse(c, e); }
  });

  app.post('/api/leave/requests', async (c) => {
    let me: any = null;
    try { me = await requireViewer(c); } catch { return c.json({ error: 'Authentication required' }, 401); }
    const body = await readBody(c);
    try {
      const self = await resolveSelfHumanResourcesMember(null, me);
      if (!self) return unlinked(c);
      const row = await applyLeaveRequest(body || {}, self.selfId, actorLabel(me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row, 201);
    } catch (e) { return errorResponse(c, e); }
  });

  app.post('/api/leave/requests/:id/cancel', async (c) => {
    let me: any = null;
    try { me = await requireViewer(c); } catch { return c.json({ error: 'Authentication required' }, 401); }
    try {
      const self = await resolveSelfHumanResourcesMember(null, me);
      if (!self) return unlinked(c);
      const out = await cancelLeaveRequest(c.req.param('id') ?? '', self.selfId, actorLabel(me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(out);
    } catch (e) { return errorResponse(c, e); }
  });
}
