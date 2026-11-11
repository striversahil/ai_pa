// ─────────────────────────────────────────────────────────────────────────────
// routes/work.ts — My Work queue + notifications API (Phase 0: empty shapes).
//
// Worker-only (Express is frozen). Phase 0 returns empty lists so the frontend
// can wire `useLiveDashboard` fetchers with zero behavior change. Phase 2 opens
// real core_action rows via modules/core projectors + scope filter can().
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { authStore, getMe, readSessionCookie, type Bindings } from '../context';

export function registerWorkRoutes(app: Hono<{ Bindings: Bindings }>): void {
  const viewer = async (c: any) => {
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    if (!me) return { me: null as any, error: c.json({ error: 'Authentication required' }, 401) };
    return { me, error: null as any };
  };

  app.get('/api/work/my', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    return c.json({ actions: [], nextEscalationAt: null });
  });

  app.get('/api/work/team', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    return c.json({ actions: [], scope: 'team' });
  });

  app.post('/api/work/actions/:id/complete', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    // Phase 0: no core_action rows exist yet.
    return c.json({ error: 'no such action' }, 404);
  });

  app.get('/api/notifications', async (c) => {
    const v = await viewer(c);
    if (v.error) return v.error;
    return c.json({ notifications: [] });
  });
}
