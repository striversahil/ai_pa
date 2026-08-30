import { AuthScope, AuthRole, AuthUser, ROOT_EMAIL } from "./types";

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
  listUsers(): Promise<Array<AuthUser & { scopes: string[]; roles: string[] }>>;
  listRoles(): Promise<AuthRole[]>;
  createRole(key: string, label: string, description: string | null, scopeKeys: string[]): Promise<AuthRole>;
  deleteRole(key: string): Promise<void>;
  getUserRoleKeys(userId: string): Promise<string[]>;
  setUserRoles(userId: string, keys: string[]): Promise<void>;
  /** One-shot auth snapshot: user + scopes + roles + role→scopes, in as few
   *  D1 round-trips as possible (the hot path runs on every API request). */
  getAuthSnapshot(userId: string): Promise<{ user: AuthUser | null; scopes: string[]; roles: string[]; roleScopes: Record<string, string[]> }>;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

// ── In-memory (dev / fallback) ────────────────────────────────────────────────
class MemoryAuthStore implements AuthStore {
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
class D1AuthStore implements AuthStore {
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
    };
    await this.db
      .prepare(
        "INSERT INTO auth_user (id, email, name, picture, isRoot, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(user.id, user.email, user.name, user.picture, user.isRoot ? 1 : 0, user.createdAt)
      .run();
    return user;
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
    await this.db
      .prepare("INSERT OR REPLACE INTO auth_scope (key, label, description) VALUES (?, ?, ?)")
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
    await this.db.prepare("INSERT OR REPLACE INTO auth_role (key, label, description) VALUES (?, ?, ?)").bind(key, label, description).run();
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

let cachedMemory: MemoryAuthStore | null = null;

export function createAuthStore(env: any): AuthStore {
  if (env && env.DB && typeof env.DB.prepare === "function") return new D1AuthStore(env.DB);
  // Prisma store is wired by the Express server (store-prisma.ts).
  if (env && env.__prismaAuthStore) return env.__prismaAuthStore as AuthStore;
  if (!cachedMemory) cachedMemory = new MemoryAuthStore();
  return cachedMemory;
}

export { MemoryAuthStore };
