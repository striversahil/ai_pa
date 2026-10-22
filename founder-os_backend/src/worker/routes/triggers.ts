// ─────────────────────────────────────────────────────────────────────────────
// routes/triggers.ts — automation trigger endpoints (GitHub Actions cron calls
// these) + internal run-automation for the async runner.
// ─────────────────────────────────────────────────────────────────────────────
// Region model (founder, 2026-10-22): the EOD remark-deduction run is retired
// (no individual holds, no penalties). The route stays staged as a stub so the
// daily workflow keeps firing harmlessly across deploy windows; remove it
// together with the workflow when cron.ts drops the slot.
import type { Hono } from 'hono';
import { deps, requireSecret, getEntryOrReload, notifyLive, type Bindings } from '../context';
import { LiveEvent } from '../../live';

export function registerTriggerRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // Retired EOD remark deduction — kept as a stub while the GH daily workflow
  // still dispatches it (telecalling-eod-deduction job). Harmless: no writes.
  app.post('/api/trigger/telecalling/eod', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    return c.json({ ok: true, retired: true, message: 'EOD remark deduction retired — region model (founder, 2026-10-22)' });
  });

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