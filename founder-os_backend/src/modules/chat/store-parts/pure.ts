// Extracted verbatim from store.ts by scripts/refactor/split-module.mjs.
// store.ts re-exports everything public here, so existing imports keep working.
import type { ChatAttachment, ChatMessage, ChatStore, ChatChannel, ChatUser, ChatReaction } from "./types";

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

// Linked accounts: these two logins belong to the same person (Samarth Gupta)
// and share one chat identity — union inbox, shared read state, and every
// message sent from either is attributed to the primary display account.
export const LINKED_ACCOUNT_EMAILS = ["connect.bui2@gmail.com", "crypticlooks@gmail.com"];

export const LINKED_PRIMARY_EMAIL = "crypticlooks@gmail.com";

export function parseAttachments(raw: string | null): ChatAttachment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function mapMessage(row: any): ChatMessage | null {
  if (!row) return null;
  const replyTo = row.replyToId
    ? { id: row.replyToId, senderName: row.replyToSenderName || "Unknown", body: row.replyToBody || "" }
    : null;
  return {
    id: row.id,
    channelId: row.channelId,
    senderId: row.senderId,
    senderName: row.senderName || "Unknown",
    senderPicture: row.senderPicture ?? null,
    body: row.deletedAt ? "" : row.body,
    createdAt: row.createdAt,
    editedAt: row.editedAt ?? null,
    deletedAt: row.deletedAt ?? null,
    attachments: parseAttachments(row.attachments ?? null),
    replyToId: row.replyToId ?? null,
    replyTo,
  };
}

// ── In-memory (dev / fallback) ────────────────────────────────────────────────
export class MemoryChatStore implements ChatStore {
  channels = new Map<string, ChatChannel>();
  members = new Map<string, Set<string>>();
  users = new Map<string, ChatUser>();
  messages: ChatMessage[] = [];
  reactions = new Map<number, Map<string, ChatReaction>>();
  seq = 1;

  async listChannels(userId: string, isAdmin = false) {
    return [...this.channels.values()].filter((c) => {
      const m = this.members.get(c.id);
      if (c.type === "dm") return !!m && m.has(userId);
      if (isAdmin) return true;
      return !!m && m.has(userId);
    }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async listChannelsWithUnread(userId: string, isAdmin = false) {
    const channels = await this.listChannels(userId, isAdmin);
    const unread = await this.getUnreadCounts(userId);
    return channels.map((c) => ({ ...c, unread: unread[c.id] || 0 }));
  }
  async createChannel(input) {
    const channel: ChatChannel = { id: newId(), name: input.name, description: input.description, category: input.category, type: "channel", createdBy: input.createdBy, createdAt: new Date().toISOString() };
    this.channels.set(channel.id, channel);
    const members = new Set<string>([input.createdBy, ...(input.memberIds || [])]);
    this.members.set(channel.id, members);
    return channel;
  }
  async createDm(userA: string, userB: string) {
    for (const c of this.channels.values()) {
      if (c.type !== "dm") continue;
      const m = this.members.get(c.id);
      if (m && m.has(userA) && m.has(userB)) {
        const other = this.users.get(userA === c.createdBy ? userB : userA) ?? null;
        return { ...c, otherUser: other };
      }
    }
    const otherUser = this.users.get(userB) ?? { id: userB, name: userB, picture: null };
    const channel: ChatChannel = { id: newId(), name: otherUser.name, description: null, category: null, type: "dm", createdBy: userA, createdAt: new Date().toISOString(), otherUser };
    this.channels.set(channel.id, channel);
    this.members.set(channel.id, new Set([userA, userB]));
    return channel;
  }
  async listChannelMembers(channelId: string) {
    const ids = this.members.get(channelId) || new Set<string>();
    return [...ids].map((id) => this.users.get(id) ?? { id, name: id, picture: null });
  }
  async addChannelMembers(channelId: string, userIds: string[]) {
    const m = this.members.get(channelId) || new Set<string>();
    for (const id of userIds) m.add(id);
    this.members.set(channelId, m);
  }
  async removeChannelMember(channelId: string, userId: string) {
    this.members.get(channelId)?.delete(userId);
  }
  async canAccessChannel(channelId: string, userId: string, isAdmin = false) {
    if (isAdmin) return true;
    const c = this.channels.get(channelId);
    if (!c) return false;
    const m = this.members.get(channelId);
    return !!m && m.has(userId);
  }
  async listUsers() {
    return [...this.users.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  async listMessages(channelId, before?: number | null, limit = 50) {
    return this.messages
      .filter((m) => m.channelId === channelId && (before == null || m.id < before))
      .sort((a, b) => b.id - a.id)
      .slice(0, limit)
      .sort((a, b) => a.id - b.id);
  }
  async getMessage(id: number) {
    return this.messages.find((m) => m.id === id) ?? null;
  }
  async getUnreadCounts(userId: string) {
    const out: Record<string, number> = {};
    for (const c of this.channels.values()) {
      if (c.type !== "channel" && !(this.members.get(c.id)?.has(userId))) continue;
      const cnt = this.messages.filter((m) => m.channelId === c.id && !m.deletedAt).length;
      if (cnt > 0) out[c.id] = cnt;
    }
    return out;
  }
  async markChannelRead(userId: string, channelId: string, lastReadId: number) { /* noop for memory */ }
  async createMessage(input) {
    const msg: ChatMessage = { id: this.seq++, channelId: input.channelId, senderId: input.senderId, senderName: input.senderId, senderPicture: null, body: input.body, createdAt: new Date().toISOString(), editedAt: null, deletedAt: null, attachments: input.attachments ?? [], replyToId: input.replyToId ?? null };
    if (msg.replyToId) {
      const r = this.messages.find((x) => x.id === msg.replyToId);
      if (r) msg.replyTo = { id: r.id, senderName: r.senderName, body: r.body };
    }
    this.messages.push(msg);
    return msg;
  }
  async updateMessage(id: number, body: string) {
    const m = this.messages.find((x) => x.id === id);
    if (!m) return null;
    m.body = body;
    m.editedAt = new Date().toISOString();
    return m;
  }
  async deleteMessage(id: number) {
    const m = this.messages.find((x) => x.id === id);
    if (m) m.deletedAt = new Date().toISOString();
  }
  async listReactions(channelId: string) {
    const ids = new Set(this.messages.filter((m) => m.channelId === channelId).map((m) => m.id));
    const out: Record<number, ChatReaction[]> = {};
    for (const [key, list] of this.reactions) {
      if (!ids.has(key)) continue;
      out[key] = [...list.values()];
    }
    return out;
  }
  async toggleReaction(messageId: number, userId: string, userName: string, emoji: string) {
    const list = this.reactions.get(messageId) ?? new Map<string, ChatReaction>();
    const key = `${userId}:${emoji}`;
    let active = true;
    if (list.has(key)) {
      list.delete(key);
      active = false;
    } else {
      list.set(key, { messageId, emoji, userId, userName });
    }
    if (list.size === 0) this.reactions.delete(messageId);
    else this.reactions.set(messageId, list);
    return { active, reactions: [...list.values()] };
  }
}
