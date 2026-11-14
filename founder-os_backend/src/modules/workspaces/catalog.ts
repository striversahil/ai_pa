// ─────────────────────────────────────────────────────────────────────────────
// modules/workspaces/catalog.ts — the ONE list of workspaces (dashboards a
// person opens) and their legacy slug aliases.
//
// Replaces three hand-synced lists: DASHBOARD_SLUGS (now derived below and
// re-exported from modules/automation/dashboardSlugs.ts), the alias literals in
// routes, and the AUTH_EXEMPT data paths. Permission SCOPES stay owned by the
// automation registry (RULES `scope` + AUTOMATION_ACCESS_SCOPES in
// modules/automation/registry-worker.ts) — this file does not duplicate them.
//
// Pure + framework-free: imported by the Worker, the guards, and mirrored by
// founder-os_frontend/src/workspaces/aliases.ts (guard: workspace-catalog.test.mjs).
//
// Vocabulary: an AUTOMATION is an engine unit (trigger/actions/runs) managed
// at /automations; a WORKSPACE is what a signed-in viewer opens at /session.
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkspaceDef {
  /** Canonical slug; also the automation slug whose data(ctx) feeds it. */
  slug: string;
  /** Legacy slugs the SERVER resolves to this workspace (data + navigation). */
  aliases?: readonly string[];
  /** Legacy slugs only the FRONTEND redirects here (their data endpoints
   *  still resolve to their own providers, e.g. `telecalling`). */
  navAliases?: readonly string[];
  /** Data provider only — no own tile/renderer (read by another workspace). */
  headless?: boolean;
  /** Data readable without a session (founder decision; mirrors the legacy
   *  AUTH_EXEMPT entries). Do not add more without an explicit decision. */
  publicData?: boolean;
}

export const WORKSPACES: readonly WorkspaceDef[] = [
  { slug: 'dpp-prices-dashboard' },
  { slug: 'wa-engine-monitor' },
  { slug: 'whatsapp-marketing' },
  // Team-performance view; public since the login cookie is host-scoped and
  // preview subdomains would otherwise 401 (founder decision, kept 2026-11-12).
  { slug: 'neodove-telecaller-report', publicData: true },
  // Unified Sales workspace absorbed these dashboards (migration 0100/0101).
  // zoho-sent-analyzer retired as a standalone dashboard 2026-11-14 — its
  // component now renders as the Analyzer tab inside Sales.
  { slug: 'sales', navAliases: ['telecalling', 'enquiry-tracker', 'master-data', 'zoho-sent-analyzer'] },
  { slug: 'accounts' },
  { slug: 'digital-marketing' },
  { slug: 'human-resources' },
  { slug: 'debtors-tracker', aliases: ['payment-tracker'] },
  { slug: 'whatsapp-autopilot' },
  { slug: 'enquiry-procurement' },
  { slug: 'enquiry-management' },
  { slug: 'reporting-sheet' },
  { slug: 'crm' },
  { slug: 'product-line' },
  { slug: 'stock' },
  { slug: 'samarth-overview' },
  { slug: 'sahil-overview' },
  { slug: 'linkedin' },
  { slug: 'ai-usage' },
  // Generic sheet-analysis renderer (SheetAnalysisDashboard fallback).
  { slug: 'telecalling-agent-analysis' },
  // Headless providers read by the Sales workspace panels.
  { slug: 'telecalling', headless: true, publicData: true },
  { slug: 'master-data', headless: true },
];

const BY_SLUG = new Map<string, WorkspaceDef>(WORKSPACES.map((w) => [w.slug, w]));
const DATA_ALIAS = new Map<string, string>(
  WORKSPACES.flatMap((w) => (w.aliases ?? []).map((a) => [a, w.slug] as [string, string])),
);
const NAV_ALIAS = new Map<string, string>(
  WORKSPACES.flatMap((w) => (w.navAliases ?? []).map((a) => [a, w.slug] as [string, string])),
);

/** Server-side alias resolution (data endpoints): `payment-tracker` → `debtors-tracker`. */
export function canonicalSlug(slug: string): string {
  return DATA_ALIAS.get(slug) ?? slug;
}

/** Navigation alias resolution (frontend URLs): data aliases + absorbed dashboards. */
export function canonicalNavSlug(slug: string): string {
  const s = canonicalSlug(slug);
  return NAV_ALIAS.get(s) ?? s;
}

export function workspaceFor(slug: string): WorkspaceDef | null {
  return BY_SLUG.get(canonicalSlug(slug)) ?? null;
}

/** Slugs that render a dashboard (tiles), legacy data aliases included — the
 *  exact contents of the old hand-written DASHBOARD_SLUGS set. */
export function dashboardSlugSet(): Set<string> {
  const out = new Set<string>();
  for (const w of WORKSPACES) {
    if (w.headless) continue;
    out.add(w.slug);
    for (const a of w.aliases ?? []) out.add(a);
  }
  return out;
}

/** True when the slug renders its own dashboard (not headless, not an alias). */
export function hasOwnDashboard(slug: string): boolean {
  const w = BY_SLUG.get(slug);
  return !!w && !w.headless;
}

/** `<prefix>/<slug>/data` for every publicData workspace (AUTH_EXEMPT input). */
export function publicDataPaths(prefix: string): string[] {
  return WORKSPACES.filter((w) => w.publicData).map((w) => `${prefix}/${w.slug}/data`);
}

/** Every alias (data + nav) → canonical target; mirrored on the frontend. */
export function aliasTable(): Record<string, { to: string; kind: 'data' | 'nav' }> {
  const out: Record<string, { to: string; kind: 'data' | 'nav' }> = {};
  for (const [a, to] of DATA_ALIAS) out[a] = { to, kind: 'data' };
  for (const [a, to] of NAV_ALIAS) out[a] = { to, kind: 'nav' };
  return out;
}
