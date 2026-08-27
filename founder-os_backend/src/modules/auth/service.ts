import { AuthScope, AuthRole, AuthUser, AuthError, MeResponse, ROOT_EMAIL } from "./types";
import { AuthStore, createAuthStore } from "./store";
import { buildGoogleAuthUrl, exchangeGoogleCode, GoogleConfig } from "./google";
import { SESSION_COOKIE, SESSION_MAX_AGE, readSessionCookie } from "./session";

export const DEFAULT_SCOPES: AuthScope[] = [
  { key: "admin", label: "Administrator", description: "Full access to every view and user management" },
  { key: "dashboard", label: "Dashboard", description: "Main pipeline dashboard" },
  { key: "enquiries", label: "Enquiries", description: "Enquiry tracking board" },
  { key: "founder-ai", label: "Founder AI", description: "Founder assistant and Company Brain" },
  { key: "whatsapp", label: "WhatsApp", description: "WhatsApp inbox and digests" },
  { key: "automations", label: "Automations", description: "Automation registry" },
  { key: "zoho", label: "Zoho Estimates", description: "Zoho estimate queue" },
  { key: "neodove", label: "NeoDove", description: "Telecaller reports" },
  { key: "dpp", label: "DPP Prices", description: "DPP price dashboard" },
  { key: "enterprise-ops", label: "Enterprise Ops", description: "Operations analytics" },
  { key: "wa-engine", label: "WA Engine", description: "WhatsApp engine monitor" },
  { key: "whatsapp-marketing", label: "WhatsApp Marketing", description: "Marketing campaigns" },
  { key: "sheet-analysis", label: "Sheet Analysis", description: "Sheet analysis dashboard" },
  { key: "brain", label: "Brain", description: "Company Brain search" },
  { key: "autopilot", label: "WhatsApp Autopilot", description: "Autopilot task queue and review dashboard" },
];

/**
 * Scopes a ROLE may grant. Roles are intentionally limited to automation
 * dashboard views — nothing outside the automations dashboards. To grant a
 * main-platform view (dashboard, enquiries, whatsapp, …) use direct scopes.
 */
export const DASHBOARD_SCOPES = [
  "zoho",
  "neodove",
  "dpp",
  "enterprise-ops",
  "wa-engine",
  "whatsapp-marketing",
  "sheet-analysis",
  "autopilot",
];

export const DEFAULT_ROLES: AuthRole[] = [
  {
    key: "mis",
    label: "MIS",
    description: "Management information dashboards (Zoho estimates, etc.)",
    scopeKeys: ["zoho"],
  },
];

export function getGoogleConfig(env: any): GoogleConfig | null {
  const clientId = env?.GOOGLE_CLIENT_ID || "";
  const clientSecret = env?.GOOGLE_CLIENT_SECRET || "";
  const publicOrigin = env?.AUTH_PUBLIC_ORIGIN || "";
  if (!clientId || !clientSecret || !publicOrigin) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${publicOrigin.replace(/\/$/, "")}/api/auth/google/callback`,
  };
}

export function authEnabled(env: any): boolean {
  return getGoogleConfig(env) !== null;
}

/** Seed default categories/scopes on first use so root can immediately assign them. */
export async function ensureScopesSeeded(store: AuthStore): Promise<void> {
  const existing = await store.listScopes();
  if (existing.length > 0) return;
  for (const s of DEFAULT_SCOPES) await store.createScope(s.key, s.label, s.description);
}

/** Seed default roles (e.g. MIS) on first use. */
export async function ensureRolesSeeded(store: AuthStore): Promise<void> {
  const existing = await store.listRoles();
  if (existing.length > 0) return;
  for (const r of DEFAULT_ROLES) await store.createRole(r.key, r.label, r.description, r.scopeKeys);
}

export function startLogin(env: any, publicOrigin: string): { url: string } {
  const cfg = getGoogleConfig(env);
  if (!cfg) throw new AuthError("OAUTH_FAILED", "Google auth is not configured", 500);
  // Override redirect base with the caller-supplied public origin (handles the
  // Pages proxy, where the browser origin differs from the worker's).
  const cfgWithOrigin: GoogleConfig = {
    ...cfg,
    redirectUri: `${publicOrigin.replace(/\/$/, "")}/api/auth/google/callback`,
  };
  const state = Math.random().toString(36).slice(2);
  return { url: buildGoogleAuthUrl(cfgWithOrigin, state) };
}

export async function completeLogin(
  env: any,
  store: AuthStore,
  code: string,
  publicOrigin: string,
): Promise<{ sessionId: string; user: AuthUser }> {
  const cfg = getGoogleConfig(env);
  if (!cfg) throw new AuthError("OAUTH_FAILED", "Google auth is not configured", 500);
  const cfgWithOrigin: GoogleConfig = {
    ...cfg,
    redirectUri: `${publicOrigin.replace(/\/$/, "")}/api/auth/google/callback`,
  };
  const profile = await exchangeGoogleCode(cfgWithOrigin, code);
  const user = await store.upsertUser(profile);
  const expiresAt = Date.now() + SESSION_MAX_AGE * 1000;
  const sessionId = await store.createSession(user.id, expiresAt);
  return { sessionId, user };
}

function toMe(user: AuthUser, scopes: string[], roles: string[]): MeResponse {
  return {
    user,
    scopes,
    roles,
    isRoot: user.isRoot,
    isAdmin: user.isRoot || scopes.includes("admin"),
  };
}

/** Effective scopes = direct scopes ∪ scopes bundled into the user's roles. */
async function resolveUserScopes(store: AuthStore, userId: string, roles: string[]): Promise<string[]> {
  const direct = await store.getUserScopeKeys(userId);
  if (roles.length === 0) return direct;
  const roleScopes = new Set<string>();
  for (const r of await store.listRoles()) {
    if (roles.includes(r.key)) for (const s of r.scopeKeys) roleScopes.add(s);
  }
  return [...new Set([...direct, ...roleScopes])];
}

export async function getMe(store: AuthStore, sessionId: string | null): Promise<MeResponse | null> {
  if (!sessionId) return null;
  const sess = await store.getSession(sessionId);
  if (!sess) return null;
  const user = await store.getUserById(sess.userId);
  if (!user) return null;
  const roles = await store.getUserRoleKeys(user.id);
  const scopes = await resolveUserScopes(store, user.id, roles);
  return toMe(user, scopes, roles);
}

/** Throws AuthError(UNAUTHENTICATED) when no valid session; used as a gate. */
export async function requireUser(store: AuthStore, cookieHeader?: string | null): Promise<MeResponse> {
  const me = await getMe(store, readSessionCookie(cookieHeader));
  if (!me) throw new AuthError("UNAUTHENTICATED", "Authentication required", 401);
  return me;
}

/** Like requireUser, but also demands a specific category/scope (or root/admin). */
export async function requireScope(
  store: AuthStore,
  cookieHeader: string | null | undefined,
  scope: string,
): Promise<MeResponse> {
  const me = await requireUser(store, cookieHeader);
  if (me.isAdmin) return me;
  if (!me.scopes.includes(scope)) {
    throw new AuthError("FORBIDDEN", `Requires '${scope}' permission`, 403);
  }
  return me;
}

/** Requires a signed-in user who has been approved (holds any scope/role) — used
 *  for team-wide features like chat that every approved member may use. */
export function isApproved(me: MeResponse): boolean {
  return me.isAdmin || me.scopes.length > 0 || me.roles.length > 0;
}

// ── Root management helpers ───────────────────────────────────────────────────
export async function listUsers(store: AuthStore) {
  return store.listUsers();
}
export async function listScopes(store: AuthStore) {
  return store.listScopes();
}
export async function createScope(store: AuthStore, key: string, label: string, description: string | null) {
  if (!/^[a-z0-9-]+$/.test(key)) throw new AuthError("FORBIDDEN", "Scope key must be a-z0-9-", 400);
  return store.createScope(key.toLowerCase(), label, description);
}
export async function deleteScope(store: AuthStore, key: string) {
  await store.deleteScope(key);
}
export async function setUserScopes(store: AuthStore, userId: string, keys: string[]) {
  await store.setUserScopes(userId, keys);
}

// ── Role management ───────────────────────────────────────────────────────────
export async function listRoles(store: AuthStore) {
  await ensureRolesSeeded(store);
  return store.listRoles();
}

export async function createRole(store: AuthStore, key: string, label: string, description: string | null, scopeKeys: string[]) {
  if (!/^[a-z0-9-]+$/.test(key)) throw new AuthError("FORBIDDEN", "Role key must be a-z0-9-", 400);
  if (!Array.isArray(scopeKeys)) throw new AuthError("FORBIDDEN", "scopeKeys must be an array", 400);
  const invalid = scopeKeys.filter((s) => !DASHBOARD_SCOPES.includes(s));
  if (invalid.length > 0) {
    throw new AuthError(
      "FORBIDDEN",
      `Roles may only grant automation dashboard scopes, not: ${invalid.join(", ")}`,
      400,
    );
  }
  return store.createRole(key.toLowerCase(), label, description, [...new Set(scopeKeys)]);
}

export async function deleteRole(store: AuthStore, key: string) {
  await store.deleteRole(key);
}

export async function setUserRoles(store: AuthStore, userId: string, keys: string[]) {
  await store.setUserRoles(userId, keys);
}

export { createAuthStore, SESSION_COOKIE, ROOT_EMAIL };
