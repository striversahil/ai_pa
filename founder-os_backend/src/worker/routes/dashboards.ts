// ─────────────────────────────────────────────────────────────────────────────
// routes/dashboards.ts — per-role dashboard definitions (Phase 6a).
//
// Worker-only (Express is frozen). Reads hlp_dashboard/hlp_widget seeds and
// resolves each widget against the existing scope-filtered endpoints' backing
// reads — no new data logic, just composition. Served payloads never bypass
// scope: team widgets require TEAM-or-wider callers, enforced here.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, type Bindings } from '../context';
import { resolveCaller } from '../../modules/core/permissions';
import { getViewerMe } from '../viewer';

interface WidgetPayload {
  key: string;
  type: string;
  title: string;
  dataSource: string;
  data: unknown;
}

async function countOpenActions(p: any, employeeIds: string[] | null): Promise<{ open: number; overdue: number }> {
  try {
    const where: any = { status: 'OPEN' };
    if (employeeIds) where.assigneeId = employeeIds.length === 1 ? employeeIds[0] : { in: employeeIds };
    const rows: any[] = await p.coreAction.findMany({ where, take: 1000 }).catch(() => []);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    let overdue = 0;
    for (const r of rows) if (r.dueAt && String(r.dueAt).slice(0, 10) < today) overdue++;
    return { open: rows.length, overdue };
  } catch {
    return { open: 0, overdue: 0 };
  }
}

async function unreadCount(p: any, employeeId: string | null): Promise<number> {
  if (!employeeId) return 0;
  try {
    const rows: any[] = await p.coreNotification?.findMany?.({
      where: { employeeId, status: 'QUEUED' }, take: 200,
    }).catch(() => []) ?? [];
    return rows.length;
  } catch {
    return 0;
  }
}

export function registerDashboardRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/dashboards/:key', async (c) => {
    const me = await getViewerMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    try {
      const { prisma } = deps();
      const p = prisma as any;
      const caller = await resolveCaller(p, me.user?.id ?? null, me);
      const key = String(c.req.param('key') ?? '');
      const def: any = await p.hlpDashboard?.findMany?.({}).catch(() => []) ?? [];
      const dash = (def as any[]).find((d) => String(d.key) === key && d.active !== false && d.active !== 0);
      if (!dash) return c.json({ error: 'no such dashboard' }, 404);
      // Team widgets need TEAM-or-wider scope; personal desks need a link.
      const isTeam = key === 'sales-team';
      if (isTeam && caller.scope !== 'TEAM' && caller.scope !== 'DEPARTMENT' && caller.scope !== 'ALL') {
        return c.json({ error: 'managers only' }, 403);
      }
      if (!isTeam && !caller.employeeId) return c.json({ error: 'no linked employee' }, 403);
      const widgets: any[] = await p.hlpWidget?.findMany?.({}).catch(() => []) ?? [];
      const mine = (widgets as any[]).filter((w) => String(w.dashboardId) === String(dash.id));
      const out: WidgetPayload[] = [];
      for (const w of mine.sort((a: any, b: any) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0))) {
        const ds = String(w.dataSource ?? '');
        let data: unknown = null;
        if (ds === 'work/my') data = await countOpenActions(p, caller.employeeId ? [caller.employeeId] : []);
        else if (ds === 'work/team') {
          const ids = caller.scope === 'ALL' || caller.scope === 'DEPARTMENT' ? null : caller.visibleEmployeeIds;
          data = await countOpenActions(p, ids);
        } else if (ds === 'notifications/unread') data = { unread: await unreadCount(p, caller.employeeId) };
        out.push({ key: String(w.key), type: String(w.type ?? 'kpi'), title: String(w.title ?? ''), dataSource: ds, data });
      }
      return c.json({
        key: dash.key, name: dash.name, scope: caller.scope, widgets: out,
      });
    } catch (e: any) {
      return c.json({ error: e?.message ?? 'dashboard unavailable' }, 500);
    }
  });
}
