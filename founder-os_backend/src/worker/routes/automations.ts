// ─────────────────────────────────────────────────────────────────────────────
// routes/automations.ts — the automation REGISTRY API (the machine side).
//
//   GET   /api/automations          registry list (admin: full; others: trimmed)
//   GET   /api/automations/:slug    definition + recent runs (admin)
//   PATCH /api/automations/:slug    enable/pause, cooldown (admin)
//   GET   /api/automations/:slug/data   DEPRECATED alias → /api/session/workspaces/:slug/data
//
// Viewer-facing reads (which dashboards can I open, my scoped data) belong to
// routes/session.ts. Do not add business-data endpoints here.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, DASHBOARD_SLUGS, type Bindings } from '../context';
import { serveWorkspaceData } from '../workspace-data';
import { AUTOMATION_SCOPES, accessScopesFor, listAutomationDefs } from '../../modules/automation/registry-worker';

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

// Moved to worker/viewer.ts (implementation: modules/telecalling/self-roster.ts).
// Re-exported for existing importers (worker/routes/telecalling.ts,
// modules/device-calls/scopes.ts).
import { resolveSelfTelecaller, getViewerMe } from '../viewer';
import { readBody } from '../http';
export { resolveSelfTelecaller };

export function registerAutomationRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/automations', async (c) => {
    const { prisma } = deps();
    // The full registry (triggers/config/runs) is root/admin-only. Non-root
    // users only get the minimal dashboard list needed for their sidebar nav.
    const me = await getViewerMe(c);
    const isAdmin = !!me?.isAdmin;
    const rows = await listAutomationDefs(prisma);
    const withDashboard = DASHBOARD_SLUGS;
    const full = rows.map((r: any) => ({
      id: r.id, slug: r.slug, name: r.name, description: r.description, type: r.type,
      enabled: r.enabled, cooldownMs: r.cooldownMs, lastRunAt: r.lastRunAt, runCount: r.runCount,
      hasDashboard: withDashboard.has(r.slug),
      // Permission scope for the dashboard (rule.json `scope`, mirrored in the
      // registry; defaults to the slug so new dashboards work with zero edits).
      // `scopes` carries legacy aliases for one dashboard (e.g. Debtors Tracker
      // is readable by sales via `debtors-tracker` and accounts via `accounts`).
      scope: AUTOMATION_SCOPES[r.slug] ?? r.slug,
      scopes: accessScopesFor(r.slug, AUTOMATION_SCOPES[r.slug] ?? r.slug),
      trigger: parseJson(r.triggerJson), condition: parseJson(r.conditionJson),
      actions: parseJson(r.actionsJson), config: parseJson(r.configJson),
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }));
    if (isAdmin) return c.json(full);
    // Non-admin clients get the minimal dashboard list PLUS the permission
    // scope per dashboard, so the sidebar/page guard can resolve access
    // dynamically (new dashboard automations work with zero frontend edits).
    // Trimmed to scopes the viewer holds — other dashboards' names stay
    // hidden at the API level, not just unlinked in the UI.
    const granted = new Set(((me?.scopes ?? []) as string[]).map((s) => String(s).toLowerCase()));
    return c.json(full
      .filter((r: any) => (r.scopes as string[]).some((s) => granted.has(String(s).toLowerCase())))
      .map((r: any) => ({
        slug: r.slug, name: r.name, hasDashboard: r.hasDashboard,
        scope: r.scope ?? r.slug, scopes: r.scopes,
      })));
  });

  app.get('/api/automations/:slug', async (c) => {
    const { prisma } = deps();
    // Full automation detail (raw triggerJson/configJson) is admin-only —
    // configs can hold Sheet URLs / chat IDs / vendor handles. Non-admins
    // already get the minimal list from GET /api/automations.
    const me = await getViewerMe(c);
    if (!me?.isAdmin) return c.json({ error: 'Forbidden' }, 403);
    const row = await prisma.automation.findUnique({
      where: { slug: c.req.param('slug') },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!row) return c.json({ error: 'automation not found' }, 404);
    return c.json({
      ...row,
      trigger: parseJson(row.triggerJson), condition: parseJson(row.conditionJson),
      actions: parseJson(row.actionsJson), config: parseJson(row.configJson),
    });
  });

  app.patch('/api/automations/:slug', async (c) => {
    const { prisma, AutomationEngine } = deps();
    const me = await getViewerMe(c);
    if (!me?.isAdmin) return c.json({ error: 'Forbidden' }, 403);
    const body = await readBody(c);
    const data: Record<string, unknown> = {};
    if (typeof body.enabled === 'boolean') { data.enabled = body.enabled; AutomationEngine.setEnabled(c.req.param('slug'), body.enabled); }
    if (typeof body.cooldownMs === 'number') { data.cooldownMs = Math.max(0, Math.floor(body.cooldownMs)); }
    if (Object.keys(data).length === 0) return c.json({ error: 'nothing to update (use enabled or cooldownMs)' }, 400);
    const row = await prisma.automation.update({ where: { slug: c.req.param('slug') }, data });
    return c.json(row);
  });

  // DEPRECATED alias of GET /api/session/workspaces/:slug/data (same handler,
  // worker/workspace-data.ts). Kept for old clients/bookmarks + the public
  // telecalling/NeoDove paths in AUTH_EXEMPT. Viewer scoping lives in
  // modules/workspaces/scoping.ts — do not add per-slug logic here.
  app.get('/api/automations/:slug/data', async (c) => {
    const res = await serveWorkspaceData(c, c.req.param('slug'));
    res.headers.set('Deprecation', 'true');
    res.headers.set('Link', `</api/session/workspaces/${c.req.param('slug')}/data>; rel="successor-version"`);
    return res;
  });
}

// WhatsApp Marketing campaign endpoints moved to ./whatsapp-marketing.ts —
// this file is the automation REGISTRY API only. Re-exported for compat.
export { registerMarketingRoutes } from './whatsapp-marketing';
