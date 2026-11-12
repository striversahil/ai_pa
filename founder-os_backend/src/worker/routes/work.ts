// ─────────────────────────────────────────────────────────────────────────────
// routes/work.ts — My Work queue + notifications API (Phase 2).
//
// Worker-only (Express is frozen). Projection runs lazily on read: the
// estimate-followup projector converges open assignments into OPEN actions,
// then the scoped read serves them. Escalation sweep is LOG-ONLY (SystemJob
// WOULD_ESCALATE rows, no notifications) until thresholds are reviewed.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { authStore, deps, getMe, readSessionCookie, type Bindings } from '../context';
import { resolveCaller } from '../../modules/core/permissions';
import { projectEstimateFollowups, sweepEscalationsLogOnly } from '../../modules/core/projectors';

function nowIso(): string {
  return new Date().toISOString();
}

function shapeAction(a: any, names: Map<string, string>): any {
  return {
    id: a.id,
    category: a.category,
    title: a.title,
    entityType: a.entityType ?? null,
    entityId: a.entityId ?? null,
    assigneeId: a.assigneeId ?? null,
    assigneeName: (a.assigneeId && names.get(a.assigneeId)) || null,
    dueAt: a.dueAt ?? null,
    priority: a.priority ?? 'MEDIUM',
    status: a.status,
    createdAt: a.createdAt ?? null,
  };
}

async function employeeNames(p: any, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  try {
    const rows: any[] = await p.coreEmployee.findMany({ where: { id: { in: [...new Set(ids)] } } });
    for (const r of rows) out.set(r.id, r.fullName || r.displayName || r.id);
  } catch { /* names best-effort */ }
  return out;
}

export function registerWorkRoutes(app: Hono<{ Bindings: Bindings }>): void {
  const viewer = async (c: any) => {
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    if (!me) return { me: null as any, error: c.json({ error: 'Authentication required' }, 401) };
    return { me, error: null as any };
  };

  app.get('/api/work/my', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    try {
      const { prisma } = deps();
      const caller = await resolveCaller(prisma as any, v.me.user?.id ?? null, v.me);
      if (!caller.employeeId) return c.json({ actions: [], scope: caller.scope });
      const [projection, sweep] = await Promise.all([
        projectEstimateFollowups(prisma as any),
        sweepEscalationsLogOnly(prisma as any, [caller.employeeId]),
      ]);
      const rows: any[] = await (prisma as any).coreAction.findMany({
        where: { status: 'OPEN', assigneeId: caller.employeeId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }).catch(() => []);
      const names = await employeeNames(prisma as any, rows.map((r) => r.assigneeId).filter(Boolean));
      return c.json({ actions: rows.map((r) => shapeAction(r, names)), scope: caller.scope, projection, sweep });
    } catch (e: any) {
      return c.json({ error: e?.message ?? 'work queue unavailable' }, 500);
    }
  });

  app.get('/api/work/team', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    try {
      const { prisma } = deps();
      const caller = await resolveCaller(prisma as any, v.me.user?.id ?? null, v.me);
      await projectEstimateFollowups(prisma as any);
      let where: any = { status: 'OPEN' };
      if (caller.scope === 'OWN') {
        if (!caller.employeeId) return c.json({ actions: [], scope: caller.scope });
        where = { ...where, assigneeId: caller.employeeId };
      } else if (caller.scope === 'TEAM') {
        where = { ...where, assigneeId: { in: caller.visibleEmployeeIds } };
      }
      const rows: any[] = await (prisma as any).coreAction.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 }).catch(() => []);
      const sweepIds = caller.scope === 'ALL' || caller.scope === 'DEPARTMENT'
        ? [...new Set(rows.map((r) => r.assigneeId).filter(Boolean))]
        : caller.visibleEmployeeIds;
      const sweep = await sweepEscalationsLogOnly(prisma as any, sweepIds);
      const names = await employeeNames(prisma as any, rows.map((r) => r.assigneeId).filter(Boolean));
      return c.json({ actions: rows.map((r) => shapeAction(r, names)), scope: caller.scope, sweep });
    } catch (e: any) {
      return c.json({ error: e?.message ?? 'team queue unavailable' }, 500);
    }
  });

  app.post('/api/work/actions/:id/complete', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    try {
      const { prisma } = deps();
      const p = prisma as any;
      const caller = await resolveCaller(p, v.me.user?.id ?? null, v.me);
      const action: any = await p.coreAction.findUnique({ where: { id: c.req.param('id') ?? '' } }).catch(() => null);
      if (!action || action.status !== 'OPEN') return c.json({ error: 'no such open action' }, 404);
      const allowed = caller.scope === 'ALL' || caller.scope === 'DEPARTMENT'
        || (caller.employeeId && action.assigneeId === caller.employeeId)
        || (caller.scope === 'TEAM' && caller.visibleEmployeeIds.includes(action.assigneeId));
      if (!allowed) return c.json({ error: 'not your action' }, 403);
      const row: any = await p.coreAction.update({
        where: { id: action.id },
        data: { status: 'DONE', completedBy: caller.employeeId ?? 'manager', completedAt: nowIso(), updatedAt: nowIso() },
      });
      try {
        await p.coreActionEvent.create({
          data: { id: `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`, actionId: action.id, eventType: 'COMPLETED', actorType: 'EMPLOYEE', actorId: caller.employeeId, note: null },
        });
        await p.coreAuditEvent.create({
          data: {
            id: `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}x`, actorType: 'EMPLOYEE', actorId: caller.employeeId,
            source: 'dashboard', entityType: 'core_action', entityId: action.id, operation: 'complete',
            changes: JSON.stringify({ status: { from: 'OPEN', to: 'DONE' } }),
          },
        });
      } catch { /* audit best-effort */ }
      // Phase 6a producer: completing someone else's action notifies them.
      try {
        const { notifyUsers } = await import('../../modules/core/notify');
        const actorName = caller.employeeId ?? 'a manager';
        if (action.assigneeId && action.assigneeId !== caller.employeeId) {
          await notifyUsers([{
            employeeId: String(action.assigneeId), title: 'Follow-up marked done',
            body: `${String(action.title ?? 'A follow-up').slice(0, 120)} — completed by ${actorName}.`,
            entityType: 'core_action', entityId: action.id, actionId: action.id,
          }], caller.employeeId);
        }
      } catch { /* never block completion */ }
      return c.json({ action: shapeAction(row, await employeeNames(p, [row.assigneeId].filter(Boolean))) });
    } catch (e: any) {
      return c.json({ error: e?.message ?? 'complete failed' }, 500);
    }
  });

  // Phase 6a: in-app pull — own QUEUED notifications, newest first.
  app.get('/api/notifications', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    try {
      const { prisma } = deps();
      const caller = await resolveCaller(prisma as any, v.me.user?.id ?? null, v.me);
      if (!caller.employeeId) return c.json({ notifications: [], unread: 0 });
      const rows: any[] = await (prisma as any).coreNotification?.findMany?.({
        where: { employeeId: caller.employeeId, status: 'QUEUED' },
        orderBy: { createdAt: 'desc' }, take: 100,
      }).catch(() => []) ?? [];
      return c.json({
        unread: rows.length,
        notifications: rows.map((r: any) => ({
          id: String(r.id), title: String(r.title ?? ''), body: String(r.body ?? ''),
          entityType: r.entityType ?? null, entityId: r.entityId ?? null,
          actionId: r.actionId ?? null, createdAt: r.createdAt ?? null,
        })),
      });
    } catch (e: any) {
      return c.json({ error: e?.message ?? 'notifications unavailable' }, 500);
    }
  });

  app.post('/api/notifications/:id/read', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    try {
      const { prisma } = deps();
      const p = prisma as any;
      const caller = await resolveCaller(p, v.me.user?.id ?? null, v.me);
      const row: any = await p.coreNotification?.findUnique?.({ where: { id: c.req.param('id') ?? '' } }).catch(() => null);
      if (!row) return c.json({ error: 'no such notification' }, 404);
      if (!caller.employeeId || String(row.employeeId) !== caller.employeeId) return c.json({ error: 'not yours' }, 403);
      const { markNotificationRead } = await import('../../modules/core/notify');
      await markNotificationRead(String(row.id));
      return c.json({ ok: true });
    } catch (e: any) {
      return c.json({ error: e?.message ?? 'mark-read failed' }, 500);
    }
  });
}
