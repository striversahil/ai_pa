// Extracted verbatim from store.ts by scripts/refactor/split-module.mjs.
// store.ts re-exports everything public here, so existing imports keep working.
import { AuthUser, AuthScope, AuthRole, ROOT_EMAIL } from "../types";
import type { AuthStore } from "./types";

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

// ── In-memory (dev / fallback) ────────────────────────────────────────────────
export class MemoryAuthStore implements AuthStore {
  users = new Map<string, AuthUser>();
  sessions = new Map<string, { userId: string; expiresAt: number }>();
  scopes = new Map<string, AuthScope>();
  userScopes = new Map<string, Set<string>>();
  roles = new Map<string, AuthRole>();
  userRoles = new Map<string, Set<string>>();

  async getUserByEmail(email: string) {
    for (const u of this.users.values()) if (u.email === email) return u;
    return null;
  }
  async upsertUser(input: { email: string; name: string; picture: string | null }) {
    const existing = await this.getUserByEmail(input.email);
    if (existing) {
      existing.name = input.name || existing.name;
      existing.picture = input.picture ?? existing.picture;
      return existing;
    }
    const user: AuthUser = {
      id: newId(),
      email: input.email,
      name: input.name,
      picture: input.picture,
      isRoot: input.email === ROOT_EMAIL,
      createdAt: new Date().toISOString(),
      displayName: null,
      positionOverride: null,
    };
    this.users.set(user.id, user);
    return user;
  }
  async getUserById(id: string) {
    return this.users.get(id) ?? null;
  }
  async createSession(userId: string, expiresAt: number) {
    const id = newId();
    this.sessions.set(id, { userId, expiresAt });
    return id;
  }
  async getSession(id: string) {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (s.expiresAt < Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return s;
  }
  async deleteSession(id: string) {
    this.sessions.delete(id);
  }
  async purgeExpiredSessions() {
    for (const [id, s] of this.sessions) if (s.expiresAt < Date.now()) this.sessions.delete(id);
  }
  async listScopes() {
    return [...this.scopes.values()];
  }
  async createScope(key: string, label: string, description: string | null) {
    const scope: AuthScope = { key, label, description };
    this.scopes.set(key, scope);
    return scope;
  }
  async deleteScope(key: string) {
    this.scopes.delete(key);
    for (const set of this.userScopes.values()) set.delete(key);
  }
  async getUserScopeKeys(userId: string) {
    return [...(this.userScopes.get(userId) ?? [])];
  }
  async updateUserProfile(id: string, patch: { displayName?: string | null; positionOverride?: string | null }) {
    const u = this.users.get(id);
    if (!u) return;
    if (patch.displayName !== undefined) u.displayName = patch.displayName;
    if (patch.positionOverride !== undefined) u.positionOverride = patch.positionOverride;
  }
  async setUserScopes(userId: string, keys: string[]) {
    this.userScopes.set(userId, new Set(keys));
  }
  async listUsers() {
    const out: Array<AuthUser & { scopes: string[]; roles: string[] }> = [];
    for (const u of this.users.values()) {
      out.push({ ...u, scopes: await this.getUserScopeKeys(u.id), roles: await this.getUserRoleKeys(u.id) });
    }
    return out;
  }
  async listRoles() {
    return [...this.roles.values()];
  }
  async createRole(key: string, label: string, description: string | null, scopeKeys: string[]) {
    const role: AuthRole = { key, label, description, scopeKeys };
    this.roles.set(key, role);
    return role;
  }
  async deleteRole(key: string) {
    this.roles.delete(key);
    for (const set of this.userRoles.values()) set.delete(key);
  }
  async getUserRoleKeys(userId: string) {
    return [...(this.userRoles.get(userId) ?? [])];
  }
  async setUserRoles(userId: string, keys: string[]) {
    this.userRoles.set(userId, new Set(keys));
  }
  async deleteUser(id: string) {
    this.users.delete(id);
    this.userScopes.delete(id);
    this.userRoles.delete(id);
    for (const [sid, s] of this.sessions) {
      if (s.userId === id) this.sessions.delete(sid);
    }
  }
  async getAuthSnapshot(userId: string) {
    return {
      user: this.users.get(userId) ?? null,
      scopes: await this.getUserScopeKeys(userId),
      roles: await this.getUserRoleKeys(userId),
      roleScopes: Object.fromEntries([...this.roles.entries()].map(([k, r]) => [k, r.scopeKeys])),
    };
  }
}
