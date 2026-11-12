// ─────────────────────────────────────────────────────────────────────────────
// modules/workspaces/scoping.ts — per-workspace viewer scoping.
//
// Turns "who is asking" into either a query patch for the provider's data(ctx)
// or a denial. Moved verbatim (logic + messages + error swallowing) from the
// per-slug `if (slug === ...)` branches that lived inline in
// worker/routes/automations.ts `GET /api/automations/:slug/data`.
//
// Pure orchestration: every lookup (session, roster matching, permission
// predicates) comes in through `ScopeResolvers`, so the guard
// scripts/guards/workspace-scoping.test.mjs can run it with fakes. The real
// resolvers live in ./resolvers.ts.
//
// Rules preserved on purpose (do not "simplify"):
//  • telecalling deletes client-supplied `selfAgentId` FIRST, always — the
//    endpoint is publicData, so the query string is untrusted.
//  • telecalling/accounts/digital-marketing/human-resources swallow lookup
//    errors (unscoped), as before.
//  • debtors-tracker rethrows non-auth errors (→ 404 upstream), as before.
//  • master-data / reporting-sheet map any non-auth error to 403, as before.
//  • Admin semantics differ per workspace (mis / sales-head / human-resources).
// ─────────────────────────────────────────────────────────────────────────────
import { AuthError } from '../auth/types';

type Me = any;
type Query = Record<string, any>;

export interface ScopeResolvers {
  /** The signed-in viewer (memoised per request); may throw. */
  loadMe(): Promise<Me | null>;
  resolveSelfTelecallerId(me: Me): Promise<string | null>;
  resolveSelfAccountant(as: string | null, me: Me): Promise<unknown>;
  resolveSelfDigitalMarketingManager(as: string | null, me: Me): Promise<unknown>;
  resolveSelfHumanResourcesMember(as: null, me: Me): Promise<unknown>;
  accessScopesFor(slug: string, scope?: string | null): string[];
  canViewMaster(me: Me | null): boolean;
  viewableDepartments(me: Me | null): unknown[];
}

export type ScopeResult =
  | { ok: true; query: Query }
  | { ok: false; status: number; error: string };

type Scoper = (query: Query, r: ScopeResolvers) => Promise<ScopeResult>;

const allow = (query: Query): ScopeResult => ({ ok: true, query });
const deny = (status: number, error: string): ScopeResult => ({ ok: false, status, error });
const fromAuthError = (e: AuthError): ScopeResult => deny(((e as any).status ?? 403) as number, e.message);
const scopesOf = (me: Me | null): string[] => (me?.scopes ?? []) as string[];

/** Debtors Tracker reads need `debtors-tracker` or a legacy alias scope
 *  (`payment-tracker`, `accounts`) — otherwise any signed-in user could read it. */
const debtorsTracker: Scoper = async (query, r) => {
  try {
    const me = await r.loadMe();
    if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
    const held = new Set(scopesOf(me).map((s) => String(s).toLowerCase()));
    const allowed = r.accessScopesFor('debtors-tracker', 'debtors-tracker').some((s) => held.has(s));
    if (!me.isAdmin && !allowed) {
      throw new AuthError('FORBIDDEN', "Requires 'debtors-tracker' permission", 403);
    }
  } catch (e) {
    if (e instanceof AuthError) return fromAuthError(e);
    throw e;
  }
  return allow(query);
};

/** Non-admin sales agents see their OWN conversion/at-risk rows (leaderboard
 *  stays team-wide). Root/admin/MIS/sales-head and anonymous = full team. */
const telecalling: Scoper = async (query, r) => {
  delete query.selfAgentId; // never trusted from the client
  try {
    const me = await r.loadMe();
    const isAdmin = !!me?.isAdmin || scopesOf(me).includes('mis') || scopesOf(me).includes('sales-head');
    if (me && !isAdmin) {
      const selfId = await r.resolveSelfTelecallerId(me);
      if (selfId) query.selfAgentId = selfId;
    }
  } catch { /* no session → unscoped */ }
  return allow(query);
};

/** Accounts taskbar: non-admins see their OWN lane. Identity = explicit `?as=`
 *  ("Acting as" picker, authoritative for shared logins), session fallback. */
const accounts: Scoper = async (query, r) => {
  try {
    const me = await r.loadMe();
    const isAdmin = !!me?.isAdmin || scopesOf(me).includes('mis');
    if (me && !isAdmin) {
      const self = await r.resolveSelfAccountant(query.as ?? null, me);
      query.scope = { scope: self, isAdmin: false };
    } else if (me) {
      query.scope = { scope: null, isAdmin: true };
    }
  } catch { /* no session → unscoped (auth gate normally blocks first) */ }
  return allow(query);
};

const digitalMarketing: Scoper = async (query, r) => {
  try {
    const me = await r.loadMe();
    const isAdmin = !!me?.isAdmin || scopesOf(me).includes('mis');
    if (me && !isAdmin) {
      const self = await r.resolveSelfDigitalMarketingManager(query.as ?? null, me);
      query.scope = { scope: self, isAdmin: false };
    } else if (me) {
      query.scope = { scope: null, isAdmin: true };
    }
  } catch { /* no session → unscoped */ }
  return allow(query);
};

/** Anyone granted the HR dashboard gets the complete HR view; others get only
 *  their own rows (no cross-user data). */
const humanResources: Scoper = async (query, r) => {
  try {
    const me = await r.loadMe();
    const scopes = scopesOf(me);
    const hasFullView = !!me?.isAdmin || scopes.includes('mis') || scopes.includes('human-resources');
    if (me && hasFullView) {
      query.scope = { scope: null, isAdmin: true };
    } else if (me) {
      const self = await r.resolveSelfHumanResourcesMember(null, me);
      query.scope = { scope: self, isAdmin: false };
    }
  } catch { /* no session → unscoped */ }
  return allow(query);
};

/** Customer master is the whole book with contact details — dashboard grant,
 *  the sales board it embeds in, or sales leadership only. */
const masterData: Scoper = async (query, r) => {
  try {
    const me = await r.loadMe();
    if (!r.canViewMaster(me)) return deny(403, "Requires 'master-data' permission");
  } catch (e) {
    if (e instanceof AuthError) return fromAuthError(e);
    return deny(403, "Requires 'master-data' permission");
  }
  return allow(query);
};

/** Reporting Sheet: data() narrows to the departments this viewer may open;
 *  a viewer with none is rejected here. */
const reportingSheet: Scoper = async (query, r) => {
  try {
    const me = await r.loadMe();
    if (!me || r.viewableDepartments(me).length === 0) {
      return deny(403, "Requires 'reporting-sheet' permission");
    }
    query.reportingMe = me;
  } catch (e) {
    if (e instanceof AuthError) return fromAuthError(e);
    return deny(403, "Requires 'reporting-sheet' permission");
  }
  return allow(query);
};

/** Canonical slug → scoper. Workspaces not listed are served unscoped
 *  (see docs/rewrite-log.md "Open gap"). */
export const SCOPERS: Readonly<Record<string, Scoper>> = {
  'debtors-tracker': debtorsTracker,
  'telecalling': telecalling,
  'accounts': accounts,
  'digital-marketing': digitalMarketing,
  'human-resources': humanResources,
  'master-data': masterData,
  'reporting-sheet': reportingSheet,
};

/** Apply the workspace's scoper (if any) to a COPY of the query. */
export async function scopeWorkspaceQuery(slug: string, query: Query, r: ScopeResolvers): Promise<ScopeResult> {
  const q = { ...query };
  const scoper = SCOPERS[slug];
  return scoper ? scoper(q, r) : allow(q);
}
