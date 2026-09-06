// ─────────────────────────────────────────────────────────────────────────────
// routes/chat.ts — team chat (Discord-style channels), reactions, typing,
// file attachments.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { chatMe, chatSend, ChatRoutes, createChatStore, resolveLinkedSender, broadcastLive, LiveEvent, isApproved, MAX_ATTACHMENT_BYTES, type Bindings } from '../context';
type ChatApp = Hono<{ Bindings: Bindings }>;

export function registerChatRoutes(app: ChatApp): void {

  app.get('/api/chat/channels', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await ChatRoutes.chatListChannels(createChatStore(c.env), me);
    return c.json(r.body, r.status as any);
  });
  app.get('/api/chat/users', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await ChatRoutes.chatListUsers(createChatStore(c.env), me);
    return c.json(r.body, r.status as any);
  });
  app.post('/api/chat/dm', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const r = await ChatRoutes.chatCreateDm(createChatStore(c.env), me, body.userId);
    return c.json(r.body, r.status as any);
  });
  app.post('/api/chat/channels', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await ChatRoutes.chatCreateChannel(createChatStore(c.env), me, await c.req.json().catch(() => ({})));
    chatSend(c, r);
    return c.json(r.body, r.status as any);
  });
  app.get('/api/chat/channels/:id/messages', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    // Fast path: serve from the channel's ChatRoom Durable Object (in-memory).
    if (c.env.CHAT_ROOM) {
      const doId = c.env.CHAT_ROOM.idFromName(c.req.param('id') ?? '');
      const stub = c.env.CHAT_ROOM.get(doId);
      const doUrl = `https://room/messages?channelId=${encodeURIComponent(c.req.param('id') ?? '')}&limit=${encodeURIComponent(c.req.query('limit') || '50')}${c.req.query('before') ? `&before=${encodeURIComponent(c.req.query('before') || '')}` : ''}`;
      const r = await stub.fetch(new Request(doUrl, { method: 'GET' }));
      if (r.ok) return c.json(await r.json());
    }
    // Fallback to D1 (DO unavailable / dev).
    const r = await ChatRoutes.chatListMessages(createChatStore(c.env), me, c.req.param('id') ?? '', c.req.query('before') ?? null, c.req.query('limit') ?? null);
    return c.json(r.body, r.status as any);
  });
  app.post('/api/chat/channels/:id/messages', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const channelId = c.req.param('id') ?? '';
    const text = String(body.body || '').trim();
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (!text && attachments.length === 0) return c.json({ error: 'body or attachment required' }, 400);

    // Fast path: write through the ChatRoom DO (in-memory + durable D1).
    if (c.env.CHAT_ROOM) {
      const sender = await resolveLinkedSender(c.env.DB, me.user);
      const doId = c.env.CHAT_ROOM.idFromName(channelId);
      const stub = c.env.CHAT_ROOM.get(doId);
      const payload = {
        channelId, senderId: sender.senderId, senderName: sender.senderName,
        senderPicture: sender.senderPicture, body: text, attachments,
        replyToId: body.replyToId ? Number(body.replyToId) : null,
      };
      const r = await stub.fetch(new Request(`https://room/messages?channelId=${encodeURIComponent(channelId)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      }));
      if (r.ok) {
        const msg = await r.json();
        broadcastLive(c, LiveEvent.Chat, { action: 'created', channelId, message: msg });
        return c.json(msg, 201);
      }
    }
    // Fallback to the store (DO unavailable / dev).
    const sender = await resolveLinkedSender(c.env.DB, me.user);
    const meAsSender = { ...me, user: { ...me.user, id: sender.senderId, name: sender.senderName, picture: sender.senderPicture } };
    const r = await ChatRoutes.chatSendMessage(createChatStore(c.env), meAsSender, channelId, body);
    chatSend(c, r);
    return c.json(r.body, r.status as any);
  });
  app.post('/api/chat/channels/:id/read', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const r = await ChatRoutes.chatMarkRead(createChatStore(c.env), me, c.req.param('id') ?? '', body.lastReadId ? Number(body.lastReadId) : null);
    return c.json(r.body, r.status as any);
  });
  app.get('/api/chat/channels/:id/members', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await ChatRoutes.chatListChannelMembers(createChatStore(c.env), me, c.req.param('id') ?? '');
    return c.json(r.body, r.status as any);
  });
  app.post('/api/chat/channels/:id/members', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const r = await ChatRoutes.chatAddChannelMembers(createChatStore(c.env), me, c.req.param('id') ?? '', body.userIds || []);
    return c.json(r.body, r.status as any);
  });
  app.delete('/api/chat/channels/:id/members/:userId', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await ChatRoutes.chatRemoveChannelMember(createChatStore(c.env), me, c.req.param('id') ?? '', c.req.param('userId') ?? '');
    return c.json(r.body, r.status as any);
  });
  app.patch('/api/chat/messages/:id', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await ChatRoutes.chatUpdateMessage(createChatStore(c.env), me, c.req.param('id') ?? '', await c.req.json().catch(() => ({})));
    chatSend(c, r);
    return c.json(r.body, r.status as any);
  });
  app.delete('/api/chat/messages/:id', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await ChatRoutes.chatDeleteMessage(createChatStore(c.env), me, c.req.param('id') ?? '');
    chatSend(c, r);
    return c.json(r.body, r.status as any);
  });
  app.get('/api/chat/channels/:id/reactions', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await ChatRoutes.chatListReactions(createChatStore(c.env), me, c.req.param('id') ?? '');
    return c.json(r.body, r.status as any);
  });
  app.post('/api/chat/messages/:id/reactions', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const r = await ChatRoutes.chatToggleReaction(createChatStore(c.env), me, c.req.param('id') ?? '', String(body.emoji || ''));
    chatSend(c, r);
    return c.json(r.body, r.status as any);
  });

  // Typing indicator — fire-and-forget, no persistence.
  app.post('/api/chat/typing', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const channelId = String(body.channelId || '');
    if (!channelId) return c.json({ error: 'channelId required' }, 400);
    broadcastLive(c, LiveEvent.Chat, {
      action: 'typing',
      channelId,
      userId: me.user.id,
      userName: me.user.name || me.user.email,
    });
    return c.json({ ok: true });
  });

  // ── Chat file attachments (Workers KV) ─────────────────────────────────────
  app.post('/api/chat/files', async (c) => {
    const me = await chatMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    if (!isApproved(me)) return c.json({ error: 'Approval required' }, 403);
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: 'Expected multipart/form-data' }, 400);
    }
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'file field required' }, 400);
    if (file.size > MAX_ATTACHMENT_BYTES) return c.json({ error: 'File too large (max 20MB)' }, 413);
    const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const key = `${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
    const data = await file.arrayBuffer();
    await c.env.CHAT_FILES.put(key, data, { metadata: { name: file.name, type: file.type || 'application/octet-stream' } });
    return c.json({ key, name: file.name, size: file.size, type: file.type || 'application/octet-stream', url: `/api/chat/files/${key}` }, 201);
  });

  app.get('/api/chat/files/:key', async (c) => {
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    const key = c.req.param('key') ?? '';
    const obj = await c.env.CHAT_FILES.getWithMetadata(key, 'arrayBuffer');
    if (obj.value === null) return c.json({ error: 'File not found' }, 404);
    const meta = (obj.metadata || {}) as { name?: string; type?: string };
    const type = meta.type || 'application/octet-stream';
    const name = meta.name || key;
    const headers = new Headers();
    headers.set('Content-Type', type);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    const inline = /^image\/|^video\/|^audio\/|^text\/|^application\/pdf$/.test(type);
    if (!inline) headers.set('Content-Disposition', `attachment; filename="${name.replace(/["\\]/g, '')}"`);
    return new Response(obj.value, { headers });
  });
}