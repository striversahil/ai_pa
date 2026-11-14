// Extracted verbatim from routes.ts by scripts/refactor/split-module.mjs.
// routes.ts re-exports everything public here, so existing imports keep working.
import { authEnabled, startLogin, completeLogin, ensureScopesSeeded, ensureRolesSeeded, getMe, invalidateSessionCache, requireUser, requireManager, listUsers, listRoles, roleGrantBlocker, listScopes, createScope as svcCreateScope, deleteScope as svcDeleteScope, setUserScopes as svcSetUserScopes, invalidateAllSessionCaches, createRole as svcCreateRole, deleteRole as svcDeleteRole, setUserRoles as svcSetUserRoles, cleanProfilePatch, setUserProfile as svcSetUserProfile, deleteUser as svcDeleteUser } from "../service";
import { AuthStore } from "../store";
import { sessionCookieHeader, readSessionCookie, clearSessionCookieHeader } from "../session";
import { AuthError } from "../types";
import type { AuthResult } from "./types";
import { json, redirect, isRoot, isTargetRoot } from "./pure";

// ── Public routes ─────────────────────────────────────────────────────────────
export async function authLogin(env: any, publicOrigin: string): Promise<AuthResult> {
  if (!authEnabled(env)) return json(501, { error: "Google auth not configured" });
  const { url } = startLogin(env, publicOrigin);
  return redirect(url);
}

export async function authCallback(
  env: any,
  store: AuthStore,
  code: string | null,
  publicOrigin: string,
  secure: boolean,
): Promise<AuthResult> {
  if (!code) return json(400, { error: "Missing code" });
  try {
    const { sessionId } = await completeLogin(env, store, code, publicOrigin);
    await ensureScopesSeeded(store);
    await ensureRolesSeeded(store);
    return { status: 302, redirect: "/", setCookie: sessionCookieHeader(sessionId, secure) };
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("OAUTH_FAILED", e?.message || "login failed");
    return json(err.status, { error: err.message });
  }
}

export async function authMe(store: AuthStore, cookieHeader: string | null): Promise<AuthResult> {
  const me = await getMe(store, readSessionCookie(cookieHeader));
  if (!me) return json(401, { error: "Not authenticated" });
  return json(200, me);
}

export async function authLogout(store: AuthStore, cookieHeader: string | null, secure: boolean): Promise<AuthResult> {
  const id = readSessionCookie(cookieHeader);
  if (id) {
    await store.deleteSession(id);
    invalidateSessionCache(id);
  }
  return { status: 200, body: { ok: true }, setCookie: clearSessionCookieHeader(secure) };
}

// ── Root-only management ──────────────────────────────────────────────────────
export async function asRoot(store: AuthStore, cookieHeader: string | null) {
  const me = await requireUser(store, cookieHeader);
  if (!isRoot(me)) throw new AuthError("FORBIDDEN", "Root only", 403);
  return me;
}

// ── User-manager gate ─────────────────────────────────────────────────────────
// Root/admin or anyone holding the `user-admin` scope. Managers may
// assign roles, but top-down only: NEVER the root user, NEVER anything
// granting the `admin` scope, NEVER anything granting `user-admin` itself
// (only root onboards new managers), and NEVER a role holding a scope the
// manager themselves was not granted (root decides what a manager may pass
// on — enforced per endpoint below).
export async function asUserManager(store: AuthStore, cookieHeader: string | null) {
  const me = await requireManager(store, cookieHeader);
  return { me, root: isRoot(me) };
}

export async function authListUsers(store: AuthStore, cookieHeader: string | null): Promise<AuthResult> {
  try {
    const { me, root } = await asUserManager(store, cookieHeader);
    const allUsers = await listUsers(store);
    // The root user is never listed in the Users portal (for anyone,
    // including root — the portal manages logins, and the root row is
    // unmanageable by design). Root identity stays visible via /api/auth/me.
    const users = allUsers.filter((u: any) => !isTargetRoot(u));
    if (root || me.isAdmin) return json(200, users);
    // Non-root managers see everyone (their job) but role keys outside their
    // own power are masked to a count — names stay hidden, not just disabled.
    // (Role saves force-keep these masked assignments; see authSetUserRoles.)
    const roles = await listRoles(store);
    const byKey = new Map(roles.map((r) => [r.key, r]));
    const visible = (k: string) => {
      const r = byKey.get(k);
      return !!r && roleGrantBlocker(me.scopes, r.scopeKeys ?? []) === null;
    };
    return json(200, users.map((u: any) => {
      const hidden = (u.roles ?? []).filter((k: string) => !visible(k)).length;
      return { ...u, roles: (u.roles ?? []).filter(visible), ...(hidden > 0 ? { hiddenRoles: hidden } : {}) };
    }));
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}

export async function authListScopes(store: AuthStore, cookieHeader: string | null): Promise<AuthResult> {
  try {
    const me = await requireUser(store, cookieHeader);
    await ensureScopesSeeded(store);
    const all = await listScopes(store);
    if (me.isAdmin) return json(200, all);
    // Non-admin viewers only see their own scopes — the rest of the catalog
    // (other dashboards' names) stays hidden, not just ungrantable.
    const have = new Set(me.scopes.map((s) => String(s).toLowerCase()));
    return json(200, all.filter((s: any) => have.has(String(s.key).toLowerCase())));
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}

export async function authCreateScope(
  store: AuthStore,
  cookieHeader: string | null,
  payload: { key?: string; label?: string; description?: string | null },
): Promise<AuthResult> {
  try {
    await asRoot(store, cookieHeader);
    if (!payload.key || !payload.label) return json(400, { error: "key and label required" });
    const scope = await svcCreateScope(store, payload.key, payload.label, payload.description ?? null);
    return json(201, scope);
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}

export async function authDeleteScope(
  store: AuthStore,
  cookieHeader: string | null,
  key: string,
): Promise<AuthResult> {
  try {
    await asRoot(store, cookieHeader);
    if (key === "admin") return json(400, { error: "Cannot delete the admin scope" });
    await svcDeleteScope(store, key);
    return json(200, { ok: true });
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}

export async function authSetUserScopes(
  store: AuthStore,
  cookieHeader: string | null,
  userId: string,
  keys: string[],
): Promise<AuthResult> {
  try {
    await asRoot(store, cookieHeader);
    if (!Array.isArray(keys)) return json(400, { error: "keys must be an array" });
    await svcSetUserScopes(store, userId, keys);
    invalidateAllSessionCaches();
    return json(200, { ok: true });
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}

export async function authListRoles(store: AuthStore, cookieHeader: string | null): Promise<AuthResult> {
  try {
    const me = await requireUser(store, cookieHeader);
    const all = await listRoles(store);
    if (me.isAdmin) return json(200, all);
    // Non-admin viewers only see roles they could grant — anything holding a
    // scope outside their own stays hidden, not just disabled.
    return json(200, all.filter((r: any) => roleGrantBlocker(me.scopes, r.scopeKeys ?? []) === null));
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}

export async function authCreateRole(
  store: AuthStore,
  cookieHeader: string | null,
  payload: { key?: string; label?: string; description?: string | null; scopeKeys?: string[] },
): Promise<AuthResult> {
  try {
    await asRoot(store, cookieHeader);
    if (!payload.key || !payload.label) return json(400, { error: "key and label required" });
    const scopeKeys = payload.scopeKeys ?? [];
    const role = await svcCreateRole(store, payload.key, payload.label, payload.description ?? null, scopeKeys);
    return json(201, role);
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}

export async function authDeleteRole(
  store: AuthStore,
  cookieHeader: string | null,
  key: string,
): Promise<AuthResult> {
  try {
    await asRoot(store, cookieHeader);
    if (key === "admin") return json(400, { error: "Cannot delete the admin role" });
    await svcDeleteRole(store, key);
    return json(200, { ok: true });
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}

export async function authSetUserRoles(
  store: AuthStore,
  cookieHeader: string | null,
  userId: string,
  keys: string[],
): Promise<AuthResult> {
  try {
    const { me, root } = await asUserManager(store, cookieHeader);
    if (!Array.isArray(keys)) return json(400, { error: "keys must be an array" });
    if (!root) {
      const target = await store.getUserById(userId);
      if (!target) return json(404, { error: "user not found" });
      if (isTargetRoot(target)) return json(403, { error: "Only root can modify the root user" });
      const roles = await listRoles(store);
      const byKey = new Map(roles.map((r) => [r.key, r]));
      for (const k of keys) {
        if (!byKey.get(k)) return json(400, { error: `Unknown role: ${k}` });
      }
      // Top-down delegation, delta-checked: ADDING a role the manager couldn't
      // grant is rejected loud. REMOVING is allowed only within their power —
      // currently-held root-managed roles are force-kept (the masked UI omits
      // them from the payload, and a curl strip must silently no-op, never
      // revoke root-granted access).
      const current = await store.getUserRoleKeys(userId);
      const locked = (k: string) => {
        const r = byKey.get(k);
        return !!r && roleGrantBlocker(me.scopes, r.scopeKeys ?? []) !== null;
      };
      for (const k of keys) {
        if (!current.includes(k) && locked(k)) {
          const reason = roleGrantBlocker(me.scopes, byKey.get(k)!.scopeKeys ?? []);
          return json(403, { error: `Role '${k}': ${reason}` });
        }
      }
      keys = [...new Set([...keys, ...current.filter((k) => locked(k))])];
    }
    await svcSetUserRoles(store, userId, keys);
    invalidateAllSessionCaches();
    return json(200, { ok: true });
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}

/**
 * Manager-set display-name override (Users portal): grouping/display only,
 * never access. Position is HR-owned (PUT /api/org/people/:id). Managers may
 * edit any non-root login (including their own name); the root user stays
 * untouchable.
 */
export async function authSetUserProfile(
  store: AuthStore,
  cookieHeader: string | null,
  userId: string,
  body: { displayName?: unknown },
): Promise<AuthResult> {
  try {
    await asUserManager(store, cookieHeader);
    if (!userId) return json(400, { error: "user id required" });
    const target = await store.getUserById(userId);
    if (!target) return json(404, { error: "user not found" });
    if (isTargetRoot(target)) return json(403, { error: "Only root can modify the root user" });
    const patch = cleanProfilePatch(body ?? {});
    await svcSetUserProfile(store, userId, patch);
    return json(200, { ok: true });
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}

/**
 * Hard-remove a login (user row + direct scopes + role joins + ALL sessions).
 * Roster rows are untouched. Guards: manager gate; never root; never self
 * (no lockout); non-root managers may only delete users whose CURRENT roles
 * are all within their own grantable power (same top-down rule as role saves).
 */
export async function authDeleteUser(
  store: AuthStore,
  cookieHeader: string | null,
  userId: string,
): Promise<AuthResult> {
  try {
    const { me, root } = await asUserManager(store, cookieHeader);
    if (!userId) return json(400, { error: "user id required" });
    const target = await store.getUserById(userId);
    if (!target) return json(404, { error: "user not found" });
    if (isTargetRoot(target)) return json(403, { error: "The root user cannot be removed" });
    if (me.user.id === target.id) return json(403, { error: "You cannot remove your own login" });
    if (!root && !me.isAdmin) {
      const roles = await listRoles(store);
      const byKey = new Map(roles.map((r) => [r.key, r]));
      const current = await store.getUserRoleKeys(userId);
      for (const k of current) {
        const r = byKey.get(k);
        if (r && roleGrantBlocker(me.scopes, r.scopeKeys ?? []) !== null) {
          return json(403, { error: `Only root can remove a user holding '${k}' — ask root` });
        }
      }
    }
    await svcDeleteUser(store, userId);
    invalidateAllSessionCaches();
    return json(200, { ok: true });
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}
