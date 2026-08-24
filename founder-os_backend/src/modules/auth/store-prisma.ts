import { PrismaClient } from "@prisma/client";
import { AuthScope, AuthUser, ROOT_EMAIL } from "./types";
import { AuthStore } from "./store";

// Prisma-backed AuthStore for the Express / Postgres runtime. Kept in a separate
// file so the Prisma client never enters the Cloudflare Worker bundle.

export class PrismaAuthStore implements AuthStore {
  constructor(private prisma: PrismaClient) {}

  private mapUser(row: any): AuthUser | null {
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      picture: row.picture,
      isRoot: !!row.isRoot,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async getUserByEmail(email: string) {
    return this.mapUser(await this.prisma.authUser.findUnique({ where: { email } }));
  }
  async upsertUser(input: { email: string; name: string; picture: string | null }) {
    return this.prisma.authUser.upsert({
      where: { email: input.email },
      update: { name: input.name || undefined, picture: input.picture ?? undefined },
      create: {
        email: input.email,
        name: input.name,
        picture: input.picture,
        isRoot: input.email === ROOT_EMAIL,
      },
    }).then((u) => this.mapUser(u)!);
  }
  async getUserById(id: string) {
    return this.mapUser(await this.prisma.authUser.findUnique({ where: { id } }));
  }
  async createSession(userId: string, expiresAt: number) {
    const s = await this.prisma.authSession.create({
      data: { userId, expiresAt: new Date(expiresAt) },
    });
    return s.id;
  }
  async getSession(id: string) {
    const s = await this.prisma.authSession.findUnique({ where: { id } });
    if (!s) return null;
    if (s.expiresAt.getTime() < Date.now()) {
      await this.deleteSession(id);
      return null;
    }
    return { userId: s.userId, expiresAt: s.expiresAt.getTime() };
  }
  async deleteSession(id: string) {
    await this.prisma.authSession.delete({ where: { id } }).catch(() => {});
  }
  async purgeExpiredSessions() {
    await this.prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
  async listScopes() {
    return this.prisma.authScope.findMany({ orderBy: { key: "asc" } });
  }
  async createScope(key: string, label: string, description: string | null) {
    return this.prisma.authScope.upsert({
      where: { key },
      update: { label, description },
      create: { key, label, description },
    });
  }
  async deleteScope(key: string) {
    await this.prisma.authScope.delete({ where: { key } }).catch(() => {});
  }
  async getUserScopeKeys(userId: string) {
    const rows = await this.prisma.authUserScope.findMany({ where: { userId }, select: { scopeKey: true } });
    return rows.map((r) => r.scopeKey);
  }
  async setUserScopes(userId: string, keys: string[]) {
    await this.prisma.$transaction([
      this.prisma.authUserScope.deleteMany({ where: { userId } }),
      this.prisma.authUserScope.createMany({
        data: keys.map((scopeKey) => ({ userId, scopeKey })),
        skipDuplicates: true,
      }),
    ]);
  }
  async listUsers() {
    const users = await this.prisma.authUser.findMany({ orderBy: { createdAt: "asc" } });
    return Promise.all(
      users.map(async (u) => ({ ...this.mapUser(u)!, scopes: await this.getUserScopeKeys(u.id) })),
    );
  }
}

export type { AuthScope };
