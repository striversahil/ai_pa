// Extracted verbatim from store.ts by scripts/refactor/split-module.mjs.
// store.ts re-exports everything public here, so existing imports keep working.
import { AuthUser, AuthScope, AuthRole } from "../types";

// ── AuthStore: persistence-agnostic user/session/scope storage ───────────────
// Three implementations: D1 (Cloudflare Worker), Prisma (Express/Postgres),
// in-memory (dev / graceful fallback). The Worker build imports ONLY this file;
// the Prisma implementation lives in store-prisma.ts so the Prisma client never
// enters the Worker bundle.

export interface AuthStore {
  getUserByEmail(email: string): Promise<AuthUser | null>;
  upsertUser(input: { email: string; name: string; picture: string | null }): Promise<AuthUser>;
  getUserById(id: string): Promise<AuthUser | null>;
  createSession(userId: string, expiresAt: number): Promise<string>;
  getSession(id: string): Promise<{ userId: string; expiresAt: number } | null>;
  deleteSession(id: string): Promise<void>;
  purgeExpiredSessions(): Promise<void>;
  listScopes(): Promise<AuthScope[]>;
  createScope(key: string, label: string, description: string | null): Promise<AuthScope>;
  deleteScope(key: string): Promise<void>;
  getUserScopeKeys(userId: string): Promise<string[]>;
  setUserScopes(userId: string, keys: string[]): Promise<void>;
  /** Manager-set identity overrides (display name + position). Null clears. */
  updateUserProfile(id: string, patch: { displayName?: string | null }): Promise<void>;
  listUsers(): Promise<Array<AuthUser & { scopes: string[]; roles: string[] }>>;
  /** Lower-cased login emails (Logins panel + delegation board). One light
   *  query — cheaper than listUsers when only presence matters. */
  listLoginEmails(): Promise<string[]>;
  listRoles(): Promise<AuthRole[]>;
  createRole(key: string, label: string, description: string | null, scopeKeys: string[]): Promise<AuthRole>;
  deleteRole(key: string): Promise<void>;
  getUserRoleKeys(userId: string): Promise<string[]>;
  setUserRoles(userId: string, keys: string[]): Promise<void>;
  /** Hard-remove a login: user row + direct scopes + role joins + ALL sessions.
   *  Roster rows (Telecaller/HR/Accounts/…) are untouched — the person still
   *  exists as staff, only the platform login dies. */
  deleteUser(id: string): Promise<void>;
  /** One-shot auth snapshot: user + scopes + roles + role→scopes, in as few
   *  D1 round-trips as possible (the hot path runs on every API request). */
  getAuthSnapshot(userId: string): Promise<{ user: AuthUser | null; scopes: string[]; roles: string[]; roleScopes: Record<string, string[]> }>;
}
