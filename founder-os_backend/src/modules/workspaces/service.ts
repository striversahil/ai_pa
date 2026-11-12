// ─────────────────────────────────────────────────────────────────────────────
// modules/workspaces/service.ts — read side of a workspace for one viewer.
//
// Framework-free: the engine + resolvers are injected so the Worker route,
// guards and any future runtime share one implementation.
//   GET /api/session/workspaces/:slug/data   (canonical)
//   GET /api/automations/:slug/data          (deprecated alias, same function)
// ─────────────────────────────────────────────────────────────────────────────
import { canonicalSlug, hasOwnDashboard } from './catalog';
import { scopeWorkspaceQuery, type ScopeResolvers } from './scoping';

export interface WorkspaceEngine {
  isLoaded(slug: string): boolean;
  reload(slug: string): Promise<unknown>;
  getData(slug: string, query: Record<string, any>): Promise<unknown>;
}

export interface WorkspaceDataResult {
  status: number;
  body: unknown;
}

export async function getWorkspaceData(input: {
  rawSlug: string;
  query: Record<string, any>;
  engine: WorkspaceEngine;
  resolvers: ScopeResolvers;
  log?: (...args: unknown[]) => void;
}): Promise<WorkspaceDataResult> {
  const { rawSlug, engine, resolvers } = input;
  const slug = canonicalSlug(rawSlug);
  try {
    if (!engine.isLoaded(slug)) await engine.reload(slug);
    const scoped = await scopeWorkspaceQuery(slug, input.query, resolvers);
    if (!scoped.ok) return { status: scoped.status, body: { error: scoped.error } };
    const data = await engine.getData(slug, scoped.query);
    return { status: 200, body: data };
  } catch (e: any) {
    (input.log ?? console.log)(`automation data failed for '${rawSlug}':`, e?.message);
    return { status: 404, body: { error: 'no data provider' } };
  }
}

export interface WorkspaceRow {
  slug: string;
  name: string;
  scope: string;
  scopes: string[];
}

/** The workspaces (dashboard tiles) this viewer may open. Admins see every
 *  dashboard; others only those whose scopes they hold — the same rule the
 *  non-admin `GET /api/automations` list applies, minus aliases/headless. */
export function listWorkspaces(
  rows: Array<{ slug: string; name: string }>,
  viewer: { isAdmin: boolean; has(scope: string): boolean },
  scopeFor: (slug: string) => { scope: string; scopes: string[] },
): WorkspaceRow[] {
  return rows
    .filter((r) => hasOwnDashboard(r.slug))
    .map((r) => ({ slug: r.slug, name: r.name, ...scopeFor(r.slug) }))
    .filter((w) => viewer.isAdmin || w.scopes.some((s) => viewer.has(s)));
}
