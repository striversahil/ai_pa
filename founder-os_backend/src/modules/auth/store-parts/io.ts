// Extracted verbatim from store.ts by scripts/refactor/split-module.mjs.
// store.ts re-exports everything public here, so existing imports keep working.
import { AuthUser, AuthScope, AuthRole, ROOT_EMAIL } from "../types";
import type { AuthStore } from "./types";
import { newId } from "./pure";

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
  async listLoginEmails() {
    return [...this.users.values()].map((u) => String(u.email ?? '').trim().toLowerCase()).filter(Boolean);
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

// ── D1 (Cloudflare Worker) ───────────────────────────────────────────────────
export class D1AuthStore implements AuthStore {
  constructor(private db: any) {}

  /** Ensure the auth_role tables exist. Creates them on first use if the
   *  migration hasn't been applied yet — idempotent (CREATE TABLE IF NOT EXISTS). */
  private async ensureRoleTables(): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_role'")
      .first();
    if (row) return true;
    try {
      await this.db.batch([
        this.db.prepare("CREATE TABLE IF NOT EXISTS auth_role (key TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT)"),
        this.db.prepare(
          "CREATE TABLE IF NOT EXISTS auth_role_scope (roleKey TEXT NOT NULL, scopeKey TEXT NOT NULL, PRIMARY KEY (roleKey, scopeKey), FOREIGN KEY (roleKey) REFERENCES auth_role(key) ON DELETE CASCADE, FOREIGN KEY (scopeKey) REFERENCES auth_scope(key) ON DELETE CASCADE)",
        ),
        this.db.prepare(
          "CREATE TABLE IF NOT EXISTS auth_user_role (userId TEXT NOT NULL, roleKey TEXT NOT NULL, PRIMARY KEY (userId, roleKey), FOREIGN KEY (userId) REFERENCES auth_user(id) ON DELETE CASCADE, FOREIGN KEY (roleKey) REFERENCES auth_role(key) ON DELETE CASCADE)",
        ),
      ]);
    } catch {
      return false;
    }
    return true;
  }

  private mapUser(row: any): AuthUser | null {
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      picture: row.picture,
      isRoot: !!row.isRoot,
      createdAt: row.createdAt,
      displayName: row.displayName ?? null,
      positionOverride: row.positionOverride ?? null,
    };
  }

  async getUserByEmail(email: string) {
    const row = await this.db.prepare("SELECT * FROM auth_user WHERE email = ?").bind(email).first();
    return this.mapUser(row);
  }
  async upsertUser(input: { email: string; name: string; picture: string | null }) {
    const existing = await this.getUserByEmail(input.email);
    if (existing) {
      await this.db
        .prepare("UPDATE auth_user SET name = ?, picture = ? WHERE id = ?")
        .bind(input.name || existing.name, input.picture ?? existing.picture, existing.id)
        .run();
      return (await this.getUserById(existing.id))!;
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
    await this.db
      .prepare(
        "INSERT INTO auth_user (id, email, name, picture, isRoot, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(user.id, user.email, user.name, user.picture, user.isRoot ? 1 : 0, user.createdAt)
      .run();
    return user;
  }
  async updateUserProfile(id: string, patch: { displayName?: string | null; positionOverride?: string | null }) {
    if (patch.displayName !== undefined) {
      await this.db.prepare("UPDATE auth_user SET displayName = ? WHERE id = ?").bind(patch.displayName, id).run();
    }
    if (patch.positionOverride !== undefined) {
      await this.db.prepare("UPDATE auth_user SET positionOverride = ? WHERE id = ?").bind(patch.positionOverride, id).run();
    }
  }
  async getUserById(id: string) {
    const row = await this.db.prepare("SELECT * FROM auth_user WHERE id = ?").bind(id).first();
    return this.mapUser(row);
  }
  async createSession(userId: string, expiresAt: number) {
    const id = newId();
    await this.db
      .prepare("INSERT INTO auth_session (id, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)")
      .bind(id, userId, new Date(expiresAt).toISOString(), new Date().toISOString())
      .run();
    return id;
  }
  async getSession(id: string) {
    const row = await this.db.prepare("SELECT * FROM auth_session WHERE id = ?").bind(id).first();
    if (!row) return null;
    const expires = new Date(row.expiresAt).getTime();
    if (expires < Date.now()) {
      await this.deleteSession(id);
      return null;
    }
    return { userId: row.userId, expiresAt: expires };
  }
  async deleteSession(id: string) {
    await this.db.prepare("DELETE FROM auth_session WHERE id = ?").bind(id).run();
  }
  async purgeExpiredSessions() {
    await this.db.prepare("DELETE FROM auth_session WHERE expiresAt < ?").bind(new Date().toISOString()).run();
  }
  async listScopes() {
    const rows = await this.db.prepare("SELECT * FROM auth_scope ORDER BY key").all();
    return (rows.results || []) as AuthScope[];
  }
  async createScope(key: string, label: string, description: string | null) {
    // Upsert WITHOUT delete: INSERT OR REPLACE would DELETE the row first and
    // fire ON DELETE CASCADE (wiping auth_user_scope + auth_role_scope rows).
    await this.db
      .prepare("INSERT INTO auth_scope (key, label, description) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET label = excluded.label, description = excluded.description")
      .bind(key, label, description)
      .run();
    return { key, label, description };
  }
  async deleteScope(key: string) {
    await this.db.prepare("DELETE FROM auth_scope WHERE key = ?").bind(key).run();
    await this.db.prepare("DELETE FROM auth_user_scope WHERE scopeKey = ?").bind(key).run();
  }
  async getUserScopeKeys(userId: string) {
    const rows = await this.db.prepare("SELECT scopeKey FROM auth_user_scope WHERE userId = ?").bind(userId).all();
    return (rows.results || []).map((r: any) => r.scopeKey);
  }
  async setUserScopes(userId: string, keys: string[]) {
    await this.db.prepare("DELETE FROM auth_user_scope WHERE userId = ?").bind(userId).run();
    for (const k of keys) {
      await this.db.prepare("INSERT OR IGNORE INTO auth_user_scope (userId, scopeKey) VALUES (?, ?)").bind(userId, k).run();
    }
  }
  async listUsers() {
    const rows = await this.db.prepare("SELECT * FROM auth_user ORDER BY createdAt").all();
    const users = (rows.results || []).map((r: any) => this.mapUser(r)!);
    return Promise.all(
      users.map(async (u) => ({
        ...u,
        scopes: await this.getUserScopeKeys(u.id),
        roles: await this.getUserRoleKeys(u.id),
      })),
    );
  }
  async listLoginEmails() {
    const rows = await this.db.prepare("SELECT lower(email) AS email FROM auth_user").all();
    return ((rows?.results ?? []) as any[]).map((r) => String(r.email ?? '').trim().toLowerCase()).filter(Boolean);
  }
  async listRoles() {
    if (!(await this.ensureRoleTables())) return [];
    const rows = await this.db.prepare("SELECT * FROM auth_role ORDER BY key").all();
    const roles = (rows.results || []) as Array<{ key: string; label: string; description: string | null }>;
    return Promise.all(
      roles.map(async (r) => {
        const sc = await this.db.prepare("SELECT scopeKey FROM auth_role_scope WHERE roleKey = ?").bind(r.key).all();
        return { ...r, scopeKeys: (sc.results || []).map((x: any) => x.scopeKey) };
      }),
    );
  }
  async createRole(key: string, label: string, description: string | null, scopeKeys: string[]) {
    if (!(await this.ensureRoleTables())) return { key, label, description, scopeKeys };
    // Upsert WITHOUT delete: INSERT OR REPLACE would DELETE the row first and
    // fire ON DELETE CASCADE on auth_user_role — silently unassigning this
    // role from every user whenever its scopes are edited. ON CONFLICT DO
    // UPDATE edits the row in place, so user assignments survive role saves.
    await this.db.prepare("INSERT INTO auth_role (key, label, description) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET label = excluded.label, description = excluded.description").bind(key, label, description).run();
    await this.db.prepare("DELETE FROM auth_role_scope WHERE roleKey = ?").bind(key).run();
    for (const s of scopeKeys) {
      await this.db.prepare("INSERT OR IGNORE INTO auth_role_scope (roleKey, scopeKey) VALUES (?, ?)").bind(key, s).run();
    }
    return { key, label, description, scopeKeys };
  }
  async deleteRole(key: string) {
    if (!(await this.ensureRoleTables())) return;
    await this.db.prepare("DELETE FROM auth_role_scope WHERE roleKey = ?").bind(key).run();
    await this.db.prepare("DELETE FROM auth_user_role WHERE roleKey = ?").bind(key).run();
    await this.db.prepare("DELETE FROM auth_role WHERE key = ?").bind(key).run();
  }
  async getUserRoleKeys(userId: string) {
    if (!(await this.ensureRoleTables())) return [];
    const rows = await this.db.prepare("SELECT roleKey FROM auth_user_role WHERE userId = ?").bind(userId).all();
    return (rows.results || []).map((r: any) => r.roleKey);
  }
  async setUserRoles(userId: string, keys: string[]) {
    if (!(await this.ensureRoleTables())) return;
    await this.db.prepare("DELETE FROM auth_user_role WHERE userId = ?").bind(userId).run();
    for (const k of keys) {
      await this.db.prepare("INSERT OR IGNORE INTO auth_user_role (userId, roleKey) VALUES (?, ?)").bind(userId, k).run();
    }
  }
  async deleteUser(id: string) {
    // Children first (FKs are CASCADE, but explicit deletes keep the
    // in-memory/mock D1 paths honest too).
    await this.db.prepare("DELETE FROM auth_user_scope WHERE userId = ?").bind(id).run();
    try {
      if (await this.ensureRoleTables()) {
        await this.db.prepare("DELETE FROM auth_user_role WHERE userId = ?").bind(id).run();
      }
    } catch { /* role tables may not exist yet — user row delete still proceeds */ }
    await this.db.prepare("DELETE FROM auth_session WHERE userId = ?").bind(id).run();
    await this.db.prepare("DELETE FROM auth_user WHERE id = ?").bind(id).run();
  }
  async getAuthSnapshot(userId: string) {
    const rolesReady = await this.ensureRoleTables();
    const [userR, scopesR, rolesR, roleScopesR] = await this.db.batch([
      this.db.prepare("SELECT * FROM auth_user WHERE id = ?").bind(userId),
      this.db.prepare("SELECT scopeKey FROM auth_user_scope WHERE userId = ?").bind(userId),
      rolesReady
        ? this.db.prepare("SELECT roleKey FROM auth_user_role WHERE userId = ?").bind(userId)
        : this.db.prepare("SELECT 'none' AS roleKey WHERE 1 = 0"),
      rolesReady
        ? this.db.prepare("SELECT r.key AS roleKey, r.label, r.description, rs.scopeKey FROM auth_role r LEFT JOIN auth_role_scope rs ON rs.roleKey = r.key")
        : this.db.prepare("SELECT 'none' AS roleKey, 'x' AS label, NULL AS description, NULL AS scopeKey WHERE 1 = 0"),
    ]);
    const user = this.mapUser((userR as any)?.results?.[0] ?? (userR as any) ?? null);
    const scopes = ((scopesR as any).results || []).map((r: any) => r.scopeKey);
    const roles = ((rolesR as any).results || []).map((r: any) => r.roleKey);
    const roleScopes: Record<string, string[]> = {};
    for (const r of ((roleScopesR as any).results || []) as any[]) {
      if (!roleScopes[r.roleKey]) roleScopes[r.roleKey] = [];
      if (r.scopeKey) roleScopes[r.roleKey].push(r.scopeKey);
    }
    return { user, scopes, roles, roleScopes };
  }
}
