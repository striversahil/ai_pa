// ─────────────────────────────────────────────────────────────────────────────
// routes/org.ts — Organization chart people API (Worker-only, no Express mirror).
//
// GET  /api/org/people[?department=Sales] — employees + login + last login +
//      sales profile, joined email-exact. Viewer-scoped server-side (HR sees
//      all, sales-head sees Sales, dept scopes see their own). Logins carry
//      their roles' chart positions.
// PUT  /api/org/people/:id — the single person save (position, region list,
//      team lead, WhatsApp, office phone, NeoDove mapping, active). HR never
//      touches access — scopes payloads are ignored (Users & Permissions owns
//      access through roles). Permission: canManagePerson (root/admin, HR,
//      sales-head→Sales, dept managers→own dept). Writes the employee row only
//      — there is no second roster (mig 0177).
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { authStore, deps, notifyLive, LiveEvent, type Bindings } from '../context';
import { getViewerMe } from '../viewer';
import { readBody } from '../http';
import { getOrgPeople, assignPerson } from '../../modules/org/io';

export function registerOrgRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/org/people', async (c) => {
    const me = await getViewerMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    try {
      const body = await getOrgPeople({
        prisma: deps().prisma,
        store: authStore(c),
        db: (c.env as any)?.DB,
        me,
        department: c.req.query('department') ?? null,
      });
      return c.json(body);
    } catch (e: any) {
      return c.json({ error: (e as any)?.message ?? 'load failed' }, (e as any)?.status ?? 400);
    }
  });

  app.put('/api/org/people/:id', async (c) => {
    const me = await getViewerMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    try {
      const body = await readBody(c);
      await assignPerson({
        prisma: deps().prisma,
        store: authStore(c),
        me,
        employeeId: c.req.param('id') ?? '',
        input: (body ?? {}) as any,
      });
      try { notifyLive(c, { type: LiveEvent.Telecalling }); } catch { /* non-fatal */ }
      try { notifyLive(c, { type: LiveEvent.HumanResources }); } catch { /* non-fatal */ }
      // Access may have changed — refresh sidebar/workspace lists that listen
      // for automation events (useWorkspaces), not just HR/telecalling.
      try { notifyLive(c, { type: LiveEvent.Automation }); } catch { /* non-fatal */ }
      return c.json({ ok: true });
    } catch (e: any) {
      return c.json({ error: (e as any)?.message ?? 'save failed' }, (e as any)?.status ?? 400);
    }
  });
}
