// ─────────────────────────────────────────────────────────────────────────────
// routes/automations.ts — automation admin API + WhatsApp Marketing.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, getEntryOrReload, DASHBOARD_SLUGS, getMe, authStore, readSessionCookie, requireScope, type Bindings } from '../context';
import { AuthError } from '../../modules/auth/types';
import { AUTOMATION_SCOPES, accessScopesFor } from '../../modules/automation/registry-worker';

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

// Moved to worker/viewer.ts (implementation: modules/telecalling/self-roster.ts).
// Re-exported for existing importers (worker/routes/telecalling.ts,
// modules/device-calls/scopes.ts).
import { resolveSelfTelecaller } from '../viewer';
export { resolveSelfTelecaller };

export function registerAutomationRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/automations', async (c) => {
    const { prisma } = deps();
    // The full registry (triggers/config/runs) is root/admin-only. Non-root
    // users only get the minimal dashboard list needed for their sidebar nav.
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    const isAdmin = !!me?.isAdmin;
    const rows = await prisma.automation.findMany({ orderBy: { createdAt: 'asc' } });
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
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
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
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    if (!me?.isAdmin) return c.json({ error: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (typeof body.enabled === 'boolean') { data.enabled = body.enabled; AutomationEngine.setEnabled(c.req.param('slug'), body.enabled); }
    if (typeof body.cooldownMs === 'number') { data.cooldownMs = Math.max(0, Math.floor(body.cooldownMs)); }
    if (Object.keys(data).length === 0) return c.json({ error: 'nothing to update (use enabled or cooldownMs)' }, 400);
    const row = await prisma.automation.update({ where: { slug: c.req.param('slug') }, data });
    return c.json(row);
  });

  app.get('/api/automations/:slug/data', async (c) => {
    const { AutomationEngine } = deps();
    // Legacy slug alias: old bookmarks/clients still resolve the dashboard.
    const slug = c.req.param('slug') === 'payment-tracker' ? 'debtors-tracker' : c.req.param('slug');
    try {
      if (!AutomationEngine.get(slug)) await getEntryOrReload(slug);
      const query = { ...c.req.query() };
      // Debtors Tracker reads need `debtors-tracker` or the legacy `accounts`
      // alias (the generic data route would otherwise serve it to any
      // signed-in user).
      if (slug === 'debtors-tracker') {
        try {
          const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
          if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
          const held = new Set(((me.scopes ?? []) as string[]).map((s) => String(s).toLowerCase()));
          const allowed = accessScopesFor('debtors-tracker', 'debtors-tracker').some((s) => held.has(s));
          if (!me.isAdmin && !allowed) {
            throw new AuthError('FORBIDDEN', "Requires 'debtors-tracker' permission", 403);
          }
        } catch (e) {
          if (e instanceof AuthError) return c.json({ error: e.message }, ((e as any).status ?? 403) as any);
          throw e;
        }
      }
      // For the telecalling dashboard, non-admin sales agents are scoped to
      // their OWN lead conversion + at-risk data (leaderboard stays team-wide).
      // The agent is identified from the signed-in session: exact roster-email
      // match first, then a loose name match ("muskan" → "Muskan",
      // "samar" → "Samarjeet"). Root/admin/MIS always see the full team view.
      if (c.req.param('slug') === 'telecalling') {
        // Scoping is decided ONLY here, from the session. `?selfAgentId=` is
        // never trusted from the client: the endpoint is auth-exempt (see
        // AUTH_EXEMPT), so an anonymous caller could otherwise hand-pick any
        // staff id and read that region's drill. Always start by dropping it.
        delete query.selfAgentId;
        try {
          const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
          const isAdmin = !!me?.isAdmin || (me?.scopes ?? []).includes('mis') || (me?.scopes ?? []).includes('sales-head');
          // Non-admin sales agents get their OWN roster id injected so the
          // payload can scope `risk`/`recent` (and coerce drills) to them.
          // Root/MIS/sales-head (and anonymous) stay unscoped = full team.
          if (me && !isAdmin) {
            const selfId = await resolveSelfTelecaller(c);
            if (selfId) query.selfAgentId = selfId;
          }
        } catch { /* no session → unscoped */ }
      }
      // For the accounts taskbar, non-admin viewers are scoped to their OWN
      // lane (telecalling-style): the payload only contains their role +
      // shared tasks, so other lanes can't leak through tab-switching or
      // direct API calls. Identity = explicit `?as=` (the "Acting as" picker,
      // authoritative for shared logins) with session matching as fallback.
      if (c.req.param('slug') === 'accounts') {
        try {
          const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
          const isAdmin = !!me?.isAdmin || (me?.scopes ?? []).includes('mis');
          if (me && !isAdmin) {
            const { resolveSelfAccountant } = await import('../../automations/accounts/service');
            const self = await resolveSelfAccountant((query as any).as ?? null, me as any);
            (query as any).scope = { scope: self, isAdmin: false };
          } else if (me) {
            (query as any).scope = { scope: null, isAdmin: true };
          }
        } catch { /* no session → unscoped (auth gate normally blocks first) */ }
      }
      if (c.req.param('slug') === 'digital-marketing') {
        try {
          const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
          const isAdmin = !!me?.isAdmin || (me?.scopes ?? []).includes('mis');
          if (me && !isAdmin) {
            const { resolveSelfDigitalMarketingManager } = await import('../../automations/digital-marketing/service');
            const self = await resolveSelfDigitalMarketingManager((query as any).as ?? null, me as any);
            (query as any).scope = { scope: self, isAdmin: false };
          } else if (me) {
            (query as any).scope = { scope: null, isAdmin: true };
          }
        } catch { /* no session → unscoped */ }
      }
      if (c.req.param('slug') === 'human-resources') {
        try {
          const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
          const scopes = (me?.scopes ?? []) as string[];
          // Anyone granted the HR dashboard gets the complete HR view: every
          // task, the full roster and all expenses/inventory. No self-scoping.
          const hasFullView = !!me?.isAdmin || scopes.includes('mis') || scopes.includes('human-resources');
          if (me && hasFullView) {
            (query as any).scope = { scope: null, isAdmin: true };
          } else if (me) {
            const { resolveSelfHumanResourcesMember } = await import('../../automations/human-resources/service');
            // Users without HR/MIS access get no cross-user data.
            const self = await resolveSelfHumanResourcesMember(null, me as any);
            (query as any).scope = { scope: self, isAdmin: false };
          }
        } catch { /* no session → unscoped */ }
      }
      // Customer master: the payload is the whole book (~2.6k rows with contact
      // details), so it must not be readable by any signed-in user. Same rule
      // as the write routes — dashboard grant, the sales board it embeds in, or
      // sales leadership.
      if (slug === 'master-data') {
        try {
          const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
          const { canViewMaster } = await import('../../modules/master-data/editors');
          if (!canViewMaster(me)) {
            return c.json({ error: "Requires 'master-data' permission" }, 403);
          }
        } catch (e) {
          if (e instanceof AuthError) return c.json({ error: e.message }, ((e as any).status ?? 403) as any);
          return c.json({ error: "Requires 'master-data' permission" }, 403);
        }
      }
      // Reporting Sheet: viewer-filtered payload. The guard attaches the session
      // so data() can narrow to the departments this viewer may open; anyone
      // with no department and no viewer grant is rejected here, not inside.
      if (slug === 'reporting-sheet') {
        try {
          const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
          const { viewableDepartments } = await import('../../modules/reporting/access');
          if (!me || viewableDepartments(me).length === 0) {
            return c.json({ error: "Requires 'reporting-sheet' permission" }, 403);
          }
          (query as any).reportingMe = me;
        } catch (e) {
          if (e instanceof AuthError) return c.json({ error: e.message }, ((e as any).status ?? 403) as any);
          return c.json({ error: "Requires 'reporting-sheet' permission" }, 403);
        }
      }
      const data = await AutomationEngine.getData(slug, query);
      return c.json(data);
    } catch (e: any) {
      console.log(`automation data failed for '${c.req.param('slug')}':`, e?.message);
      return c.json({ error: 'no data provider' }, 404);
    }
  });
}

// WhatsApp Marketing campaign endpoints moved to ./whatsapp-marketing.ts —
// this file is the automation REGISTRY API only. Re-exported for compat.
export { registerMarketingRoutes } from './whatsapp-marketing';
