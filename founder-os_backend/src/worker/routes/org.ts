// ─────────────────────────────────────────────────────────────────────────────
// routes/org.ts — Organization chart people API (Worker-only, no Express mirror).
//
// GET  /api/org/people[?department=Sales] — employees + login + last login +
//      roster row, joined email-exact. Viewer-scoped server-side (HR sees all,
//      sales-head sees Sales, dept scopes see their own).
// PUT  /api/org/people/:id — the single person save (position, region(s),
//      tlLevel, WhatsApp, office phone, NeoDove mapping, access chips, active).
//      Permission: canManagePerson (root/admin, HR, sales-head→Sales, dept
//      managers→own dept). Reuses updateEmployee + telecaller writes +
//      setUserScopes — never raw SQL.
// POST /api/org/backfill — root-only, idempotent: create employee rows for
//      roster rows that lack one, so no leaderboard row goes invisible.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { authStore, deps, notifyLive, LiveEvent, type Bindings } from '../context';
import { getViewerMe } from '../viewer';
import { readBody } from '../http';
import { getOrgPeople, assignPerson, backfillEmployees } from '../../modules/org/io';

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
      return c.json({ ok: true });
    } catch (e: any) {
      return c.json({ error: (e as any)?.message ?? 'save failed' }, (e as any)?.status ?? 400);
    }
  });

  app.post('/api/org/backfill', async (c) => {
    const me = await getViewerMe(c);
    if (!me?.isRoot) return c.json({ error: 'root only' }, 403);
    try {
      return c.json(await backfillEmployees({ prisma: deps().prisma }));
    } catch (e: any) {
      return c.json({ error: (e as any)?.message ?? 'backfill failed' }, 400);
    }
  });
}
