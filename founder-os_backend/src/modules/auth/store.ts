import { AuthScope, AuthUser, ROOT_EMAIL } from "./types";

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
  listUsers(): Promise<Array<AuthUser & { scopes: string[] }>>;
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
    const out: Array<AuthUser & { scopes: string[] }> = [];
    for (const u of this.users.values()) {
      out.push({ ...u, scopes: await this.getUserScopeKeys(u.id) });
    }
    return out;
  }
}

// ── D1 (Cloudflare Worker) ───────────────────────────────────────────────────
class D1AuthStore implements AuthStore {
  constructor(private db: any) {}

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
    return Promise.all(users.map(async (u) => ({ ...u, scopes: await this.getUserScopeKeys(u.id) })));
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
