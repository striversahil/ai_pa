// ── Chat store: persistence-agnostic channel/message storage ─────────────────
// Two implementations: D1 (Cloudflare Worker) and Prisma (Express/Postgres).
// The Worker build imports ONLY this file; the Prisma implementation lives in
// store-prisma.ts so the Prisma client never enters the Worker bundle.

export interface ChatUser {
  id: string;
  name: string;
  picture: string | null;
  email?: string | null;
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

export interface ChatReaction {
  messageId: number;
  emoji: string;
  userId: string;
  userName: string;
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
  listReactions(channelId: string): Promise<Record<number, ChatReaction[]>>;
  toggleReaction(messageId: number, userId: string, userName: string, emoji: string): Promise<{ active: boolean; reactions: ChatReaction[] }>;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

// Linked accounts: these two logins belong to the same person (Samarth Gupta)
// and share one chat identity — union inbox, shared read state, and every
// message sent from either is attributed to the primary display account.
const LINKED_ACCOUNT_EMAILS = ["connect.bui2@gmail.com", "crypticlooks@gmail.com"];
const LINKED_PRIMARY_EMAIL = "crypticlooks@gmail.com";

export async function resolveLinkedSender(
  db: any,
  user: { id: string; name?: string; email?: string; picture?: string | null },
): Promise<{ senderId: string; senderName: string; senderPicture: string | null }> {
  const self = { senderId: user.id, senderName: user.name || user.email || "User", senderPicture: user.picture ?? null };
  if (!LINKED_ACCOUNT_EMAILS.includes(String(user.email || ""))) return self;
  try {
    const row = await db.prepare("SELECT id, name, picture FROM auth_user WHERE email = ?").bind(LINKED_PRIMARY_EMAIL).first();
    if (!row) return self;
    return { senderId: row.id, senderName: row.name, senderPicture: row.picture ?? null };
  } catch {
    return self;
  }
}

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

// ── D1 (Cloudflare Worker) ───────────────────────────────────────────────────
class D1ChatStore implements ChatStore {
  constructor(private db: any) {}

  private linkedCache: { ids: string[]; at: number } | null = null;

  private async linkedIds(userId: string): Promise<string[]> {
    if (this.linkedCache && Date.now() - this.linkedCache.at < 60_000) {
      if (this.linkedCache.ids.includes(userId)) return this.linkedCache.ids;
      return [userId];
    }
    try {
      const rows = await this.db
        .prepare(`SELECT id FROM auth_user WHERE email IN (${LINKED_ACCOUNT_EMAILS.map(() => "?").join(",")})`)
        .bind(...LINKED_ACCOUNT_EMAILS)
        .all();
      const ids = ((rows.results || []) as any[]).map((r) => r.id).filter(Boolean);
      this.linkedCache = { ids, at: Date.now() };
      return ids.includes(userId) ? ids : [userId];
    } catch {
      return [userId];
    }
  }

  private async syncLinkedMemberships(ids: string[]): Promise<void> {
    if (ids.length < 2) return;
    for (const from of ids) {
      for (const to of ids) {
        if (from === to) continue;
        try {
          const rows = await this.db.prepare("SELECT channelId FROM chat_member WHERE userId = ?").bind(from).all();
          const channelIds = ((rows.results || []) as any[]).map((r) => r.channelId);
          if (channelIds.length) {
            await this.db.batch(
              channelIds.map((cid) => this.db.prepare("INSERT OR IGNORE INTO chat_member (channelId, userId) VALUES (?, ?)").bind(cid, to)),
            );
          }
        } catch { /* ignore */ }
      }
    }
  }

  private async otherUser(channelId: string, excludeUserId: string): Promise<ChatUser | null> {
    const ids = await this.linkedIds(excludeUserId);
    const row = await this.db
      .prepare(
        `SELECT u.id, u.name, u.picture, u.email FROM chat_member m JOIN auth_user u ON u.id = m.userId WHERE m.channelId = ? AND m.userId NOT IN (${ids.map(() => "?").join(",")}) LIMIT 1`,
      )
      .bind(channelId, ...ids)
      .first();
    return row ? { id: row.id, name: row.name, picture: row.picture ?? null, email: row.email ?? null } : null;
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
    const ids = await this.linkedIds(userId);
    const ph = ids.map(() => "?").join(",");
    const rows = await this.db
      .prepare(
        `SELECT * FROM chat_channel c
         WHERE (c.type = 'channel' AND (? OR EXISTS (SELECT 1 FROM chat_member m WHERE m.channelId = c.id AND m.userId IN (${ph}))))
            OR (c.type = 'dm' AND EXISTS (SELECT 1 FROM chat_member m2 WHERE m2.channelId = c.id AND m2.userId IN (${ph})))
         ORDER BY c.createdAt ASC`,
      )
      .bind(isAdmin ? 1 : 0, ...ids, ...ids)
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
    const otherUser = await this.db.prepare("SELECT id, name, picture, email FROM auth_user WHERE id = ?").bind(userB).first();
    const name = otherUser?.name || "Direct Message";
    const channel: ChatChannel = { id: newId(), name, description: null, category: null, type: "dm", createdBy: userA, createdAt: new Date().toISOString(), otherUser: otherUser ? { id: otherUser.id, name: otherUser.name, picture: otherUser.picture ?? null, email: otherUser.email ?? null } : null };
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
      .prepare("SELECT u.id, u.name, u.picture, u.email FROM chat_member m JOIN auth_user u ON u.id = m.userId WHERE m.channelId = ? ORDER BY u.name ASC")
      .bind(channelId)
      .all();
    return ((rows.results || []) as any[]).map((r) => ({ id: r.id, name: r.name, picture: r.picture ?? null, email: r.email ?? null }));
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
    const ids = await this.linkedIds(userId);
    const row = await this.db
      .prepare(
        `SELECT 1 FROM chat_channel c WHERE c.id = ? AND (? OR EXISTS (SELECT 1 FROM chat_member m WHERE m.channelId = c.id AND m.userId IN (${ids.map(() => "?").join(",")})))`,
      )
      .bind(channelId, isAdmin ? 1 : 0, ...ids)
      .first();
    return !!row;
  }
  async listUsers() {
    const rows = await this.db.prepare("SELECT id, name, picture, email FROM auth_user ORDER BY name ASC").all();
    return ((rows.results || []) as any[]).map((r) => ({ id: r.id, name: r.name, picture: r.picture ?? null, email: r.email ?? null }));
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
    const ids = await this.linkedIds(userId);
    await this.syncLinkedMemberships(ids);
    const ph = ids.map(() => "?").join(",");
    const [chRows, unreadRows, dmRows] = await this.db.batch([
      this.db
        .prepare(
          `SELECT * FROM chat_channel c
           WHERE (c.type = 'channel' AND (? OR EXISTS (SELECT 1 FROM chat_member m WHERE m.channelId = c.id AND m.userId IN (${ph}))))
              OR (c.type = 'dm' AND EXISTS (SELECT 1 FROM chat_member m2 WHERE m2.channelId = c.id AND m2.userId IN (${ph})))
           ORDER BY c.createdAt ASC`,
        )
        .bind(isAdmin ? 1 : 0, ...ids, ...ids),
      this.db
        .prepare(
          `SELECT m.channelId, COUNT(*) AS cnt
           FROM chat_message m
           LEFT JOIN (SELECT channelId, MAX(lastReadId) AS lastReadId FROM chat_read_state WHERE userId IN (${ph}) GROUP BY channelId) rs
             ON rs.channelId = m.channelId
           WHERE m.id > COALESCE(rs.lastReadId, 0) AND m.deletedAt IS NULL
           GROUP BY m.channelId`,
        )
        .bind(...ids),
      this.db
        .prepare(
          `SELECT m.channelId, u.id, u.name, u.picture, u.email
           FROM chat_member m JOIN auth_user u ON u.id = m.userId
           WHERE m.channelId IN (SELECT id FROM chat_channel WHERE type = 'dm') AND m.userId NOT IN (${ph})`,
        )
        .bind(...ids),
    ]);
    const channels = ((chRows as any).results || []) as any[];
    const unread: Record<string, number> = {};
    for (const r of ((unreadRows as any).results || []) as any[]) unread[r.channelId] = Number(r.cnt) || 0;
    const dmCounterpart: Record<string, ChatUser> = {};
    for (const r of ((dmRows as any).results || []) as any[]) {
      if (!dmCounterpart[r.channelId]) dmCounterpart[r.channelId] = { id: r.id, name: r.name, picture: r.picture ?? null, email: r.email ?? null };
    }
    return channels.map((r: any) => {
      const ch = this.mapChannel(r, r.type === "dm" ? dmCounterpart[r.id] || null : null);
      return { ...ch, unread: unread[r.id] || 0 };
    });
  }
  async markChannelRead(userId: string, channelId: string, lastReadId: number) {
    const ids = await this.linkedIds(userId);
    await this.db.batch(
      ids.map((id) =>
        this.db
          .prepare(
            "INSERT INTO chat_read_state (userId, channelId, lastReadId) VALUES (?, ?, ?) ON CONFLICT(userId, channelId) DO UPDATE SET lastReadId = excluded.lastReadId",
          )
          .bind(id, channelId, lastReadId),
      ),
    );
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

  private reactionsReady: Promise<void> | null = null;
  private ensureReactionTable(): Promise<void> {
    if (!this.reactionsReady) {
      this.reactionsReady = this.db
        .prepare(
          "CREATE TABLE IF NOT EXISTS chat_reaction (messageId INTEGER NOT NULL, userId TEXT NOT NULL, emoji TEXT NOT NULL, createdAt TEXT NOT NULL, PRIMARY KEY (messageId, userId, emoji))",
        )
        .run()
        .then(() => {});
    }
    return this.reactionsReady;
  }

  async listReactions(channelId: string) {
    await this.ensureReactionTable();
    const rows = await this.db
      .prepare(
        "SELECT r.messageId, r.emoji, r.userId, u.name AS userName FROM chat_reaction r JOIN chat_message m ON m.id = r.messageId JOIN auth_user u ON u.id = r.userId WHERE m.channelId = ? ORDER BY r.rowid ASC",
      )
      .bind(channelId)
      .all();
    const out: Record<number, ChatReaction[]> = {};
    for (const r of (rows.results || []) as any[]) {
      if (!out[r.messageId]) out[r.messageId] = [];
      out[r.messageId].push({ messageId: r.messageId, emoji: r.emoji, userId: r.userId, userName: r.userName });
    }
    return out;
  }
  async toggleReaction(messageId: number, userId: string, userName: string, emoji: string) {
    await this.ensureReactionTable();
    const del = await this.db
      .prepare("DELETE FROM chat_reaction WHERE messageId = ? AND userId = ? AND emoji = ?")
      .bind(messageId, userId, emoji)
      .run();
    const removed = Number(del?.meta?.changes ?? 0) > 0;
    if (!removed) {
      await this.db
        .prepare("INSERT OR IGNORE INTO chat_reaction (messageId, userId, emoji, createdAt) VALUES (?, ?, ?, ?)")
        .bind(messageId, userId, emoji, new Date().toISOString())
        .run();
    }
    const rows = await this.db
      .prepare("SELECT r.emoji, r.userId, u.name AS userName FROM chat_reaction r JOIN auth_user u ON u.id = r.userId WHERE r.messageId = ? ORDER BY r.rowid ASC")
      .bind(messageId)
      .all();
    const reactions = ((rows.results || []) as any[]).map((r) => ({ messageId, emoji: r.emoji, userId: r.userId, userName: r.userName }));
    return { active: removed ? false : true, reactions };
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