import { PrismaClient } from "@prisma/client";
import { ChatAttachment, ChatChannel, ChatMessage, ChatReaction, ChatStore, ChatUser } from "./store";

// Prisma-backed ChatStore for the Express / Postgres runtime. Kept in a separate
// file so the Prisma client never enters the Cloudflare Worker bundle.

function parseAttachments(raw: string | null): ChatAttachment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapMessage(row: any): ChatMessage {
  const replyTo = row.replyToId
    ? { id: row.replyToId, senderName: row.replyTo?.sender?.name || "Unknown", body: row.replyTo?.body || "" }
    : null;
  return {
    id: row.id,
    channelId: row.channelId,
    senderId: row.senderId,
    senderName: row.sender?.name || "Unknown",
    senderPicture: row.sender?.picture ?? null,
    body: row.deletedAt ? "" : row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    attachments: parseAttachments(row.attachments),
    replyToId: row.replyToId ?? null,
    replyTo,
  };
}

function mapChannel(row: any, other: ChatUser | null): ChatChannel {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    type: row.type === "dm" ? "dm" : "channel",
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    otherUser: other,
  };
}

export class PrismaChatStore implements ChatStore {
  constructor(private prisma: PrismaClient) {}

  async listChannels(userId: string, isAdmin = false) {
    const channels = await this.prisma.chatChannel.findMany({
      where: {
        OR: [
          { type: "channel", ...(isAdmin ? {} : { members: { some: { userId } } }) },
          { type: "dm", members: { some: { userId } } },
        ],
      },
      orderBy: { createdAt: "asc" },
      include: { members: { include: { user: { select: { id: true, name: true, picture: true, email: true } } } } },
    });
    return channels.map((c) => {
      const other = c.type === "dm" ? (c.members.find((m) => m.userId !== userId)?.user ?? null) : null;
      return mapChannel(c, other);
    });
  }
  async createChannel(input: { name: string; description: string | null; category: string | null; createdBy: string; memberIds?: string[] }) {
    const r = await this.prisma.chatChannel.create({
      data: {
        name: input.name,
        description: input.description,
        category: input.category,
        type: "channel",
        createdBy: input.createdBy,
        members: { create: [...new Set([input.createdBy, ...(input.memberIds || [])])].map((userId) => ({ userId })) },
      },
    });
    return mapChannel(r, null);
  }
  async createDm(userA: string, userB: string) {
    const existing = await this.prisma.chatChannel.findFirst({
      where: { type: "dm", members: { every: { userId: { in: [userA, userB] } }, some: { userId: userA } }, AND: { members: { some: { userId: userB } } } },
      include: { members: { include: { user: { select: { id: true, name: true, picture: true, email: true } } } } },
    });
    if (existing) {
      const other = existing.members.find((m) => m.userId !== userA)?.user ?? null;
      return mapChannel(existing, other);
    }
    const otherUser = await this.prisma.authUser.findUnique({ where: { id: userB }, select: { id: true, name: true, picture: true, email: true } });
    const r = await this.prisma.chatChannel.create({
      data: {
        name: otherUser?.name || "Direct Message",
        description: null,
        category: null,
        type: "dm",
        createdBy: userA,
        members: { create: [{ userId: userA }, { userId: userB }] },
      },
    });
    return mapChannel(r, otherUser ? { id: otherUser.id, name: otherUser.name, picture: otherUser.picture, email: otherUser.email } : null);
  }
  async listChannelMembers(channelId: string) {
    const rows = await this.prisma.chatMember.findMany({
      where: { channelId },
      include: { user: { select: { id: true, name: true, picture: true, email: true } } },
      orderBy: { user: { name: "asc" } },
    });
    return rows.map((m) => ({ id: m.user.id, name: m.user.name, picture: m.user.picture }));
  }
  async addChannelMembers(channelId: string, userIds: string[]) {
    await this.prisma.chatMember.createMany({
      data: userIds.map((userId) => ({ channelId, userId })),
      skipDuplicates: true,
    });
  }
  async removeChannelMember(channelId: string, userId: string) {
    await this.prisma.chatMember.deleteMany({ where: { channelId, userId } });
  }
  async canAccessChannel(channelId: string, userId: string, isAdmin = false) {
    const c = await this.prisma.chatChannel.findFirst({
      where: {
        id: channelId,
        ...(isAdmin ? {} : { members: { some: { userId } } }),
      },
      select: { id: true },
    });
    return !!c;
  }
  async listUsers(): Promise<ChatUser[]> {
    const users = await this.prisma.authUser.findMany({ select: { id: true, name: true, picture: true, email: true }, orderBy: { name: "asc" } });
    return users.map((u) => ({ id: u.id, name: u.name, picture: u.picture, email: u.email }));
  }
  async listMessages(channelId: string, before?: number | null, limit = 50) {
    const rows = await this.prisma.chatMessage.findMany({
      where: { channelId, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: "desc" },
      take: limit,
      include: {
        sender: { select: { name: true, picture: true } },
        replyTo: { include: { sender: { select: { name: true } } } },
      },
    });
    return rows.reverse().map(mapMessage);
  }
  async getMessage(id: number) {
    const row = await this.prisma.chatMessage.findUnique({
      where: { id },
      include: {
        sender: { select: { name: true, picture: true } },
        replyTo: { include: { sender: { select: { name: true } } } },
      },
    });
    return row ? mapMessage(row) : null;
  }
  async getUnreadCounts(userId: string) {
    const states = await this.prisma.chatReadState.findMany({ where: { userId } });
    const byChannel = new Map(states.map((s) => [s.channelId, s.lastReadId]));
    const channels = await this.prisma.chatChannel.findMany({
      where: {
        OR: [{ type: "channel" }, { type: "dm", members: { some: { userId } } }],
      },
      select: { id: true },
    });
    const out: Record<string, number> = {};
    for (const c of channels) {
      const lastRead = byChannel.get(c.id) ?? 0;
      const cnt = await this.prisma.chatMessage.count({
        where: { channelId: c.id, id: { gt: lastRead }, deletedAt: null },
      });
      if (cnt > 0) out[c.id] = cnt;
    }
    return out;
  }
  async listChannelsWithUnread(userId: string, isAdmin = false) {
    const channels = await this.listChannels(userId, isAdmin);
    const unread = await this.getUnreadCounts(userId);
    return channels.map((c) => ({ ...c, unread: unread[c.id] || 0 }));
  }
  async markChannelRead(userId: string, channelId: string, lastReadId: number) {
    await this.prisma.chatReadState.upsert({
      where: { userId_channelId: { userId, channelId } },
      update: { lastReadId },
      create: { userId, channelId, lastReadId },
    });
  }
  async createMessage(input: { channelId: string; senderId: string; body: string; attachments?: ChatAttachment[]; replyToId?: number | null }) {
    const row = await this.prisma.chatMessage.create({
      data: {
        channelId: input.channelId,
        senderId: input.senderId,
        body: input.body,
        attachments: JSON.stringify(input.attachments ?? []),
        replyToId: input.replyToId ?? null,
      },
      include: {
        sender: { select: { name: true, picture: true } },
        replyTo: { include: { sender: { select: { name: true } } } },
      },
    });
    return mapMessage(row);
  }
  async updateMessage(id: number, body: string) {
    const row = await this.prisma.chatMessage.update({
      where: { id },
      data: { body, editedAt: new Date() },
      include: { sender: { select: { name: true, picture: true } } },
    });
    return mapMessage(row);
  }
  async deleteMessage(id: number) {
    await this.prisma.chatMessage.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private reactionsReady: Promise<void> | null = null;
  private ensureReactionTable(): Promise<void> {
    if (!this.reactionsReady) {
      this.reactionsReady = this.prisma
        .$executeRawUnsafe(
          "CREATE TABLE IF NOT EXISTS chat_reaction (\"messageId\" INTEGER NOT NULL, \"userId\" TEXT NOT NULL, emoji TEXT NOT NULL, \"createdAt\" TEXT NOT NULL, PRIMARY KEY (\"messageId\", \"userId\", emoji))",
        )
        .then(() => {});
    }
    return this.reactionsReady;
  }
  async listReactions(channelId: string): Promise<Record<number, ChatReaction[]>> {
    await this.ensureReactionTable();
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT r."messageId" AS "messageId", r.emoji AS emoji, r."userId" AS "userId", u.name AS "userName"
       FROM chat_reaction r
       JOIN chat_message m ON m.id = r."messageId"
       JOIN auth_user u ON u.id = r."userId"
       WHERE m."channelId" = $1 ORDER BY r."createdAt" ASC`,
      channelId,
    )) as any[];
    const out: Record<number, ChatReaction[]> = {};
    for (const r of rows) {
      if (!out[r.messageId]) out[r.messageId] = [];
      out[r.messageId].push({ messageId: Number(r.messageId), emoji: r.emoji, userId: r.userId, userName: r.userName });
    }
    return out;
  }
  async toggleReaction(messageId: number, userId: string, userName: string, emoji: string) {
    await this.ensureReactionTable();
    const del = await this.prisma.$executeRawUnsafe(
      'DELETE FROM chat_reaction WHERE "messageId" = $1 AND "userId" = $2 AND emoji = $3',
      messageId, userId, emoji,
    );
    const removed = del > 0;
    if (!removed) {
      await this.prisma.$executeRawUnsafe(
        'INSERT INTO chat_reaction ("messageId", "userId", emoji, "createdAt") VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        messageId, userId, emoji, new Date().toISOString(),
      );
    }
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT r.emoji AS emoji, r."userId" AS "userId", u.name AS "userName"
       FROM chat_reaction r JOIN auth_user u ON u.id = r."userId"
       WHERE r."messageId" = $1 ORDER BY r."createdAt" ASC`,
      messageId,
    )) as any[];
    const reactions = rows.map((r) => ({ messageId, emoji: r.emoji, userId: r.userId, userName: r.userName }));
    return { active: removed ? false : true, reactions };
  }
}