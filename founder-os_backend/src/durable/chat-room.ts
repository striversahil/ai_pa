// ChatRoom Durable Object — per-channel in-memory message cache for fast chat.
//
// One instance per channel (idFromName(channelId)). On cold start it seeds the
// last N messages from D1 into memory; subsequent reads are served from memory
// and writes are appended in-memory then written through to D1 (durable).
// This removes the D1 round-trip on the chat hot path (message send/read).
//
// Writes also persist the new message id to state.storage so a restart can
// pick up where the cache left off.

const CACHE_PAGE = 200;

export interface ChatRoomMsg {
  id: number;
  channelId: string;
  senderId: string;
  senderName: string;
  senderPicture: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  attachments: unknown[];
  replyToId: number | null;
  replyTo?: { id: number; senderName: string; body: string } | null;
}

export class ChatRoomDO {
  state: DurableObjectState;
  env: any;
  messages: ChatRoomMsg[] = [];
  loaded = false;
  channelId: string | null = null;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded || !this.channelId) return;
    this.loaded = true;
    const cached = (await this.state.storage.get<ChatRoomMsg[]>('messages')) || [];
    if (cached.length > 0) {
      this.messages = cached;
      return;
    }
    // Seed from D1 (one query, then remember the high-water mark).
    try {
      const stmt = this.env.DB.prepare(
        `SELECT m.*, u.name AS senderName, u.picture AS senderPicture,
                ru.name AS replyToSenderName, rm.body AS replyToBody
         FROM chat_message m
         JOIN auth_user u ON u.id = m.senderId
         LEFT JOIN chat_message rm ON rm.id = m.replyToId
         LEFT JOIN auth_user ru ON ru.id = rm.senderId
         WHERE m.channelId = ? ORDER BY m.id DESC LIMIT ${CACHE_PAGE}`,
      );
      const res = await stmt.bind(this.channelId).all();
      const rows = (res.results || []).reverse();
      this.messages = rows.map((r: any) => ({
        id: r.id, channelId: r.channelId, senderId: r.senderId,
        senderName: r.senderName || 'Unknown', senderPicture: r.senderPicture ?? null,
        body: r.deletedAt ? '' : r.body, createdAt: r.createdAt,
        editedAt: r.editedAt ?? null, deletedAt: r.deletedAt ?? null,
        attachments: this.parseAtt(r.attachments),
        replyToId: r.replyToId ?? null,
        replyTo: r.replyToId
          ? { id: r.replyToId, senderName: r.replyToSenderName || 'Unknown', body: r.replyToBody || '' }
          : null,
      }));
    } catch {
      this.messages = [];
    }
    await this.state.storage.put('messages', this.messages);
  }

  parseAtt(raw: string | null): unknown[] {
    if (!raw) return [];
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Channel id travels on the request — the worker knows it from the path.
    this.channelId = url.searchParams.get('channelId') || this.channelId;
    await this.ensureLoaded();

    if (url.pathname === '/messages' && request.method === 'GET') {
      const before = Number(url.searchParams.get('before') || 0) || Infinity;
      const limit = Math.min(Number(url.searchParams.get('limit') || 50) || 50, 200);
      const rows = this.messages.filter((m) => m.id < before).slice(-limit);
      // History older than the in-memory window → read through to D1.
      if (rows.length < limit && Number.isFinite(before)) {
        try {
          const stmt = this.env.DB.prepare(
            `SELECT m.*, u.name AS senderName, u.picture AS senderPicture,
                    ru.name AS replyToSenderName, rm.body AS replyToBody
             FROM chat_message m
             JOIN auth_user u ON u.id = m.senderId
             LEFT JOIN chat_message rm ON rm.id = m.replyToId
             LEFT JOIN auth_user ru ON ru.id = rm.senderId
             WHERE m.channelId = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`,
          );
          const res = await stmt.bind(this.channelId, before, limit).all();
          const rows2 = (res.results || []).reverse().map((r: any) => ({
            id: r.id, channelId: r.channelId, senderId: r.senderId,
            senderName: r.senderName || 'Unknown', senderPicture: r.senderPicture ?? null,
            body: r.deletedAt ? '' : r.body, createdAt: r.createdAt,
            editedAt: r.editedAt ?? null, deletedAt: r.deletedAt ?? null,
            attachments: this.parseAtt(r.attachments),
            replyToId: r.replyToId ?? null,
            replyTo: r.replyToId
              ? { id: r.replyToId, senderName: r.replyToSenderName || 'Unknown', body: r.replyToBody || '' }
              : null,
          }));
          return new Response(JSON.stringify(rows2), { headers: { 'content-type': 'application/json' } });
        } catch { /* fall through to cache */ }
      }
      return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
    }

    if (url.pathname === '/messages' && request.method === 'POST') {
      const body = JSON.parse(await request.text());
      const now = new Date().toISOString();
      const msg: ChatRoomMsg = {
        id: 0, // assigned below by D1
        channelId: String(body.channelId),
        senderId: String(body.senderId),
        senderName: String(body.senderName || body.senderId),
        senderPicture: body.senderPicture ?? null,
        body: String(body.body || ''),
        createdAt: now,
        editedAt: null,
        deletedAt: null,
        attachments: Array.isArray(body.attachments) ? body.attachments : [],
        replyToId: body.replyToId ? Number(body.replyToId) : null,
      };
      // Resolve reply context from memory if present.
      if (msg.replyToId) {
        const r = this.messages.find((m) => m.id === msg.replyToId);
        if (r) msg.replyTo = { id: r.id, senderName: r.senderName, body: r.body };
      }
      // Durable write-through.
      try {
        await this.env.DB.prepare(
          'INSERT INTO chat_message (channelId, senderId, body, createdAt, attachments, replyToId) VALUES (?, ?, ?, ?, ?, ?)',
        )
          .bind(msg.channelId, msg.senderId, msg.body, now, JSON.stringify(msg.attachments), msg.replyToId)
          .run();
        const row = await this.env.DB.prepare(
          'SELECT id FROM chat_message WHERE channelId = ? ORDER BY id DESC LIMIT 1',
        ).bind(msg.channelId).first();
        msg.id = Number((row as any)?.id || 0);
      } catch {
        return new Response(JSON.stringify({ error: 'persist failed' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
      // Memory + durable cache.
      this.messages.push(msg);
      if (this.messages.length > CACHE_PAGE) this.messages = this.messages.slice(-CACHE_PAGE);
      await this.state.storage.put('messages', this.messages);
      return new Response(JSON.stringify(msg), { status: 201, headers: { 'content-type': 'application/json' } });
    }

    return new Response('not found', { status: 404 });
  }
}