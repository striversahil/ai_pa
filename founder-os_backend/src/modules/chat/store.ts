// ── Chat store: persistence-agnostic channel/message storage ─────────────────
// Two implementations: D1 (Cloudflare Worker) and Prisma (Express/Postgres).
// The Worker build imports ONLY this file; the Prisma implementation lives in
// store-prisma.ts so the Prisma client never enters the Worker bundle.

export interface ChatUser {
  id: string;
  name: string;
  picture: string | null;
}

export interface ChatChannel {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  type: "channel" | "dm";
  createdBy: string;
  createdAt: string;
  otherUser?: ChatUser | null;
}

export interface ChatAttachment {
  key: string;
  name: string;
  size: number;
  type: string;
}

export interface ChatMessage {
  id: number;
  channelId: string;
  senderId: string;
  senderName: string;
  senderPicture: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  attachments: ChatAttachment[];
  replyToId: number | null;
  replyTo?: { id: number; senderName: string; body: string } | null;
}

export interface ChatStore {
  listChannels(userId: string, isAdmin?: boolean): Promise<ChatChannel[]>;
  listChannelsWithUnread(userId: string, isAdmin?: boolean): Promise<Array<ChatChannel & { unread: number }>>;
  createChannel(input: { name: string; description: string | null; category: string | null; createdBy: string; memberIds?: string[] }): Promise<ChatChannel>;
  createDm(userA: string, userB: string): Promise<ChatChannel>;
  canAccessChannel(channelId: string, userId: string, isAdmin?: boolean): Promise<boolean>;
  listUsers(): Promise<ChatUser[]>;
  listChannelMembers(channelId: string): Promise<ChatUser[]>;
  addChannelMembers(channelId: string, userIds: string[]): Promise<void>;
  removeChannelMember(channelId: string, userId: string): Promise<void>;
  listMessages(channelId: string, before?: number | null, limit?: number): Promise<ChatMessage[]>;
  getMessage(id: number): Promise<ChatMessage | null>;
  getUnreadCounts(userId: string): Promise<Record<string, number>>;
  markChannelRead(userId: string, channelId: string, lastReadId: number): Promise<void>;
  createMessage(input: { channelId: string; senderId: string; body: string; attachments?: ChatAttachment[]; replyToId?: number | null }): Promise<ChatMessage>;
  updateMessage(id: number, body: string): Promise<ChatMessage | null>;
  deleteMessage(id: number): Promise<void>;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

function parseAttachments(raw: string | null): ChatAttachment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapMessage(row: any): ChatMessage | null {
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
class MemoryChatStore implements ChatStore {
  channels = new Map<string, ChatChannel>();
  members = new Map<string, Set<string>>();
  users = new Map<string, ChatUser>();
  messages: ChatMessage[] = [];
  seq = 1;

  async listChannels(userId: string, isAdmin = false) {
    return [...this.channels.values()].filter((c) => {
      if (isAdmin) return true;
      const m = this.members.get(c.id);
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
}

// ── D1 (Cloudflare Worker) ───────────────────────────────────────────────────
class D1ChatStore implements ChatStore {
  constructor(private db: any) {}

  private async otherUser(channelId: string, excludeUserId: string): Promise<ChatUser | null> {
    const row = await this.db
      .prepare(
        "SELECT u.id, u.name, u.picture FROM chat_member m JOIN auth_user u ON u.id = m.userId WHERE m.channelId = ? AND m.userId != ? LIMIT 1",
      )
      .bind(channelId, excludeUserId)
      .first();
    return row ? { id: row.id, name: row.name, picture: row.picture ?? null } : null;
  }

  private mapChannel(row: any, other: ChatUser | null): ChatChannel {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      type: row.type === "dm" ? "dm" : "channel",
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      otherUser: other,
    };
  }

  async listChannels(userId: string, isAdmin = false) {
    const rows = await this.db
      .prepare(
        "SELECT * FROM chat_channel c WHERE ? OR EXISTS (SELECT 1 FROM chat_member m WHERE m.channelId = c.id AND m.userId = ?) ORDER BY c.createdAt ASC",
      )
      .bind(isAdmin ? 1 : 0, userId)
      .all();
    const channels = (rows.results || []) as any[];
    return Promise.all(channels.map(async (r) => this.mapChannel(r, r.type === "dm" ? await this.otherUser(r.id, userId) : null)));
  }
  async createChannel(input) {
    const channel: ChatChannel = { id: newId(), name: input.name, description: input.description, category: input.category, type: "channel", createdBy: input.createdBy, createdAt: new Date().toISOString() };
    await this.db
      .prepare("INSERT INTO chat_channel (id, name, description, category, type, createdBy, createdAt) VALUES (?, ?, ?, ?, 'channel', ?, ?)")
      .bind(channel.id, channel.name, channel.description, channel.category, channel.createdBy, channel.createdAt)
      .run();
    const memberIds = [...new Set([input.createdBy, ...(input.memberIds || [])])];
    await this.db.batch(
      memberIds.map((uid) => this.db.prepare("INSERT OR IGNORE INTO chat_member (channelId, userId) VALUES (?, ?)").bind(channel.id, uid)),
    );
    return channel;
  }
  async createDm(userA: string, userB: string) {
    const existing = await this.db
      .prepare(
        "SELECT c.id FROM chat_channel c JOIN chat_member m1 ON m1.channelId = c.id AND m1.userId = ? JOIN chat_member m2 ON m2.channelId = c.id AND m2.userId = ? WHERE c.type = 'dm' LIMIT 1",
      )
      .bind(userA, userB)
      .first();
    if (existing) {
      const row = await this.db.prepare("SELECT * FROM chat_channel WHERE id = ?").bind(existing.id).first();
      const other = await this.otherUser(row.id, userA);
      return this.mapChannel(row, other);
    }
    const otherUser = await this.db.prepare("SELECT id, name, picture FROM auth_user WHERE id = ?").bind(userB).first();
    const name = otherUser?.name || "Direct Message";
    const channel: ChatChannel = { id: newId(), name, description: null, category: null, type: "dm", createdBy: userA, createdAt: new Date().toISOString(), otherUser: otherUser ? { id: otherUser.id, name: otherUser.name, picture: otherUser.picture ?? null } : null };
    await this.db
      .prepare("INSERT INTO chat_channel (id, name, description, category, type, createdBy, createdAt) VALUES (?, ?, NULL, NULL, 'dm', ?, ?)")
      .bind(channel.id, channel.name, channel.createdBy, channel.createdAt)
      .run();
    await this.db.batch([
      this.db.prepare("INSERT INTO chat_member (channelId, userId) VALUES (?, ?)").bind(channel.id, userA),
      this.db.prepare("INSERT INTO chat_member (channelId, userId) VALUES (?, ?)").bind(channel.id, userB),
    ]);
    return channel;
  }
  async listChannelMembers(channelId: string) {
    const rows = await this.db
      .prepare("SELECT u.id, u.name, u.picture FROM chat_member m JOIN auth_user u ON u.id = m.userId WHERE m.channelId = ? ORDER BY u.name ASC")
      .bind(channelId)
      .all();
    return ((rows.results || []) as any[]).map((r) => ({ id: r.id, name: r.name, picture: r.picture ?? null }));
  }
  async addChannelMembers(channelId: string, userIds: string[]) {
    await this.db.batch(
      userIds.map((uid) => this.db.prepare("INSERT OR IGNORE INTO chat_member (channelId, userId) VALUES (?, ?)").bind(channelId, uid)),
    );
  }
  async removeChannelMember(channelId: string, userId: string) {
    await this.db.prepare("DELETE FROM chat_member WHERE channelId = ? AND userId = ?").bind(channelId, userId).run();
  }
  async canAccessChannel(channelId: string, userId: string, isAdmin = false) {
    const row = await this.db
      .prepare(
        "SELECT 1 FROM chat_channel c WHERE c.id = ? AND (? OR EXISTS (SELECT 1 FROM chat_member m WHERE m.channelId = c.id AND m.userId = ?))",
      )
      .bind(channelId, isAdmin ? 1 : 0, userId)
      .first();
    return !!row;
  }
  async listUsers() {
    const rows = await this.db.prepare("SELECT id, name, picture FROM auth_user ORDER BY name ASC").all();
    return ((rows.results || []) as any[]).map((r) => ({ id: r.id, name: r.name, picture: r.picture ?? null }));
  }
  async listMessages(channelId: string, before?: number | null, limit = 50) {
    const SELECT = `
      SELECT m.*, u.name AS senderName, u.picture AS senderPicture,
             ru.name AS replyToSenderName, rm.body AS replyToBody
      FROM chat_message m
      JOIN auth_user u ON u.id = m.senderId
      LEFT JOIN chat_message rm ON rm.id = m.replyToId
      LEFT JOIN auth_user ru ON ru.id = rm.senderId`;
    const rows = before
      ? await this.db
          .prepare(`${SELECT} WHERE m.channelId = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`)
          .bind(channelId, before, limit)
          .all()
      : await this.db
          .prepare(`${SELECT} WHERE m.channelId = ? ORDER BY m.id DESC LIMIT ?`)
          .bind(channelId, limit)
          .all();
    return (rows.results || []).reverse().map(mapMessage).filter(Boolean) as ChatMessage[];
  }
  async getMessage(id: number) {
    const row = await this.db
      .prepare(
        `SELECT m.*, u.name AS senderName, u.picture AS senderPicture,
                ru.name AS replyToSenderName, rm.body AS replyToBody
         FROM chat_message m
         JOIN auth_user u ON u.id = m.senderId
         LEFT JOIN chat_message rm ON rm.id = m.replyToId
         LEFT JOIN auth_user ru ON ru.id = rm.senderId
         WHERE m.id = ?`,
      )
      .bind(id)
      .first();
    return mapMessage(row);
  }
  async createMessage(input) {
    await this.db
      .prepare("INSERT INTO chat_message (channelId, senderId, body, createdAt, attachments, replyToId) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(input.channelId, input.senderId, input.body, new Date().toISOString(), JSON.stringify(input.attachments ?? []), input.replyToId ?? null)
      .run();
    const row = await this.db
      .prepare(
        `SELECT m.*, u.name AS senderName, u.picture AS senderPicture,
                ru.name AS replyToSenderName, rm.body AS replyToBody
         FROM chat_message m
         JOIN auth_user u ON u.id = m.senderId
         LEFT JOIN chat_message rm ON rm.id = m.replyToId
         LEFT JOIN auth_user ru ON ru.id = rm.senderId
         WHERE m.channelId = ? ORDER BY m.id DESC LIMIT 1`,
      )
      .bind(input.channelId)
      .first();
    return mapMessage(row)!;
  }
  async getUnreadCounts(userId: string) {
    const rows = await this.db
      .prepare(
        `SELECT m.channelId, COUNT(*) AS cnt
         FROM chat_message m
         LEFT JOIN chat_read_state rs ON rs.channelId = m.channelId AND rs.userId = ?
         WHERE m.id > COALESCE(rs.lastReadId, 0) AND m.deletedAt IS NULL
         GROUP BY m.channelId`,
      )
      .bind(userId)
      .all();
    const out: Record<string, number> = {};
    for (const r of (rows.results || []) as any[]) out[r.channelId] = Number(r.cnt) || 0;
    return out;
  }
  async listChannelsWithUnread(userId: string, isAdmin = false) {
    // Single round-trip: channels + unread counts + DM counterpart lookups.
    const [chRows, unreadRows, dmRows] = await this.db.batch([
      this.db
        .prepare(
          "SELECT * FROM chat_channel c WHERE ? OR EXISTS (SELECT 1 FROM chat_member m WHERE m.channelId = c.id AND m.userId = ?) ORDER BY c.createdAt ASC",
        )
        .bind(isAdmin ? 1 : 0, userId),
      this.db
        .prepare(
          `SELECT m.channelId, COUNT(*) AS cnt
           FROM chat_message m
           LEFT JOIN chat_read_state rs ON rs.channelId = m.channelId AND rs.userId = ?
           WHERE m.id > COALESCE(rs.lastReadId, 0) AND m.deletedAt IS NULL
           GROUP BY m.channelId`,
        )
        .bind(userId),
      this.db
        .prepare(
          `SELECT m.channelId, u.id, u.name, u.picture
           FROM chat_member m JOIN auth_user u ON u.id = m.userId
           WHERE m.channelId IN (SELECT id FROM chat_channel WHERE type = 'dm') AND m.userId != ?`,
        )
        .bind(userId),
    ]);
    const channels = ((chRows as any).results || []) as any[];
    const unread: Record<string, number> = {};
    for (const r of ((unreadRows as any).results || []) as any[]) unread[r.channelId] = Number(r.cnt) || 0;
    const dmCounterpart: Record<string, ChatUser> = {};
    for (const r of ((dmRows as any).results || []) as any[]) {
      if (!dmCounterpart[r.channelId]) dmCounterpart[r.channelId] = { id: r.id, name: r.name, picture: r.picture ?? null };
    }
    return channels.map((r: any) => {
      const ch = this.mapChannel(r, r.type === "dm" ? dmCounterpart[r.id] || null : null);
      return { ...ch, unread: unread[r.id] || 0 };
    });
  }
  async markChannelRead(userId: string, channelId: string, lastReadId: number) {
    await this.db
      .prepare(
        "INSERT INTO chat_read_state (userId, channelId, lastReadId) VALUES (?, ?, ?) ON CONFLICT(userId, channelId) DO UPDATE SET lastReadId = excluded.lastReadId",
      )
      .bind(userId, channelId, lastReadId)
      .run();
  }
  async updateMessage(id: number, body: string) {
    const row = await this.db
      .prepare("UPDATE chat_message SET body = ?, editedAt = ? WHERE id = ?")
      .bind(body, new Date().toISOString(), id)
      .run();
    if (!row.meta || !row.meta.changes) return null;
    return this.getMessage(id);
  }
  async deleteMessage(id: number) {
    await this.db
      .prepare("UPDATE chat_message SET deletedAt = ? WHERE id = ?")
      .bind(new Date().toISOString(), id)
      .run();
  }
}

let cachedMemory: MemoryChatStore | null = null;

export function createChatStore(env: any): ChatStore {
  if (env && env.DB && typeof env.DB.prepare === "function") return new D1ChatStore(env.DB);
  if (env && env.__prismaChatStore) return env.__prismaChatStore as ChatStore;
  if (!cachedMemory) cachedMemory = new MemoryChatStore();
  return cachedMemory;
}

export { MemoryChatStore };