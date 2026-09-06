// ─────────────────────────────────────────────────────────────────────────────
// routes/triggers.ts — automation trigger endpoints (GitHub Actions cron calls
// these) + internal run-automation for the async runner.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireSecret, getEntryOrReload, notifyLive, type Bindings } from '../context';

export function registerTriggerRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.post('/api/trigger/:slug', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { AutomationEngine } = deps();
    const slug = c.req.param('slug');
    const entry = await getEntryOrReload(slug);
    if (!entry) return c.json({ error: `automation '${slug}' not loaded` }, 404);
    if (c.req.query('async') === '1' && c.env.ASYNC_RUNNER) {
      const origin = new URL(c.req.url).origin;
      const stub = c.env.ASYNC_RUNNER.get(c.env.ASYNC_RUNNER.idFromName(slug));
      c.executionCtx.waitUntil(
        stub.fetch(new Request(`https://do/schedule?slug=${encodeURIComponent(slug)}&origin=${encodeURIComponent(origin)}`)).catch(() => {})
      );
      return c.json({ ok: true, async: true, message: `Automation '${slug}' scheduled` });
    }
    await AutomationEngine.scan(slug);
    notifyLive(c, { type: 'automation', slug });
    return c.json({ message: `Automation '${slug}' triggered`, ok: true });
  });

  // Internal: runs an automation scan synchronously (called by AsyncTaskRunner's alarm).
  app.post('/api/internal/run-automation', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { AutomationEngine } = deps();
    const slug = c.req.query('slug') || '';
    const entry = await getEntryOrReload(slug);
    if (!entry) return c.json({ error: `automation '${slug}' not loaded` }, 404);
    await AutomationEngine.scan(slug);
    notifyLive(c, { type: 'automation', slug });
    return c.json({ ok: true });
  });
}