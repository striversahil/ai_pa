import { PrismaClient } from "@prisma/client";
import { ChatAttachment, ChatChannel, ChatMessage, ChatStore, ChatUser } from "./store";

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

  async listChannels(userId: string) {
    const channels = await this.prisma.chatChannel.findMany({
      where: {
        OR: [
          { type: "channel" },
          { type: "dm", members: { some: { userId } } },
        ],
      },
      orderBy: { createdAt: "asc" },
      include: { members: { include: { user: { select: { id: true, name: true, picture: true } } } } },
    });
    return channels.map((c) => {
      const other = c.type === "dm" ? (c.members.find((m) => m.userId !== userId)?.user ?? null) : null;
      return mapChannel(c, other);
    });
  }
  async createChannel(input: { name: string; description: string | null; category: string | null; createdBy: string }) {
    const r = await this.prisma.chatChannel.create({
      data: { name: input.name, description: input.description, category: input.category, type: "channel", createdBy: input.createdBy },
    });
    return mapChannel(r, null);
  }
  async createDm(userA: string, userB: string) {
    const existing = await this.prisma.chatChannel.findFirst({
      where: { type: "dm", members: { every: { userId: { in: [userA, userB] } }, some: { userId: userA } }, AND: { members: { some: { userId: userB } } } },
      include: { members: { include: { user: { select: { id: true, name: true, picture: true } } } } },
    });
    if (existing) {
      const other = existing.members.find((m) => m.userId !== userA)?.user ?? null;
      return mapChannel(existing, other);
    }
    const otherUser = await this.prisma.authUser.findUnique({ where: { id: userB }, select: { id: true, name: true, picture: true } });
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
    return mapChannel(r, otherUser ? { id: otherUser.id, name: otherUser.name, picture: otherUser.picture } : null);
  }
  async canAccessChannel(channelId: string, userId: string) {
    const c = await this.prisma.chatChannel.findFirst({
      where: {
        id: channelId,
        OR: [{ type: "channel" }, { type: "dm", members: { some: { userId } } }],
      },
      select: { id: true },
    });
    return !!c;
  }
  async listUsers(): Promise<ChatUser[]> {
    const users = await this.prisma.authUser.findMany({ select: { id: true, name: true, picture: true }, orderBy: { name: "asc" } });
    return users.map((u) => ({ id: u.id, name: u.name, picture: u.picture }));
  }
  async listMessages(channelId: string, before?: number | null, limit = 50) {
    const rows = await this.prisma.chatMessage.findMany({
      where: { channelId, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: "desc" },
      take: limit,
      include: { sender: { select: { name: true, picture: true } } },
    });
    return rows.reverse().map(mapMessage);
  }
  async getMessage(id: number) {
    const row = await this.prisma.chatMessage.findUnique({
      where: { id },
      include: { sender: { select: { name: true, picture: true } } },
    });
    return row ? mapMessage(row) : null;
  }
  async createMessage(input: { channelId: string; senderId: string; body: string; attachments?: ChatAttachment[] }) {
    const row = await this.prisma.chatMessage.create({
      data: { channelId: input.channelId, senderId: input.senderId, body: input.body, attachments: JSON.stringify(input.attachments ?? []) },
      include: { sender: { select: { name: true, picture: true } } },
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
}