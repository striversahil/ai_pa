// ─────────────────────────────────────────────────────────────────────────────
// routes/whatsapp.ts — WhatsApp webhook ingest, token store, send endpoints,
// contacts, summarize, SSE events, pending-items.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireSecret, validateChatId, broadcastLive, LiveEvent, type Bindings } from '../context';

export function registerWhatsappRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── WhatsApp webhook (founder-os ingest path) ───────────────────────────────
  app.post('/api/whatsapp/webhook', async (c) => {
    const { WhatsAppController } = deps();
    const body = await c.req.json().catch(() => ({}));
    await WhatsAppController.handleWebhook(body);
    broadcastLive(c, LiveEvent.Messages);
    broadcastLive(c, LiveEvent.Contacts);
    broadcastLive(c, LiveEvent.Digests);
    broadcastLive(c, LiveEvent.PendingItems);
    return c.json({ success: true });
  });

  // ── Token webhook / store ───────────────────────────────────────────────────
  app.post('/api/token/webhook', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    const source = String(body?.source || '').trim().toLowerCase();
    const token = body?.token;
    const metadata = body?.metadata ? JSON.stringify(body.metadata) : null;
    if (!source || token === undefined || token === null) return c.json({ error: 'source and token required' }, 400);
    const tokenStr = JSON.stringify(token);
    await prisma.token.upsert({
      where: { source },
      update: { token: tokenStr, metadata, updatedAt: new Date() },
      create: { source, token: tokenStr, metadata },
    });
    return c.json({ ok: true, source, updatedAt: new Date().toISOString() });
  });

  app.get('/api/token/:source', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const source = c.req.param('source').trim().toLowerCase();
    const row = await prisma.token.findUnique({ where: { source } });
    if (!row) return c.json({ error: 'token not found' }, 404);
    let parsedToken: any;
    try { parsedToken = JSON.parse(row.token); } catch { parsedToken = row.token; }
    return c.json({ source: row.source, token: parsedToken, metadata: row.metadata ? JSON.parse(row.metadata) : null, updatedAt: row.updatedAt });
  });

  app.get('/api/token', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const { prisma } = deps();
    const rows = await prisma.token.findMany({ select: { source: true, metadata: true, createdAt: true, updatedAt: true } });
    return c.json(rows.map((r: any) => ({ source: r.source, metadata: r.metadata ? JSON.parse(r.metadata) : null, createdAt: r.createdAt, updatedAt: r.updatedAt })));
  });

  // ── WhatsApp send ───────────────────────────────────────────────────────────
  app.post('/api/whatsapp/send', async (c) => {
    const { StorageRepository, WhatsAppService, OutboundService, MessageQueueService } = deps();
    const body = await c.req.json().catch(() => ({}));
    const { chatId: rawChatId, message_body } = body;
    if (!rawChatId || !message_body) return c.json({ error: 'Missing chatId or message_body' }, 400);
    let trimmed = String(rawChatId).trim();
    if (!trimmed.includes('@')) trimmed = trimmed + '@c.us';
    const suffix = trimmed.split('@').pop() || '';
    if (!['g.us', 'c.us', 'lid'].includes(suffix)) return c.json({ error: 'chatId must end with @c.us, @g.us, or @lid' }, 400);
    const validationError = validateChatId(trimmed);
    if (validationError) return c.json({ error: validationError }, 400);

    const allowlisted = await StorageRepository.hasInboundMessages(trimmed);
    if (!allowlisted) {
      return c.json({ success: false, error: 'chatId is not allowlisted: only contacts who have messaged you in the past can receive messages' }, 403);
    }

    await WhatsAppService.saveMessage({ chatId: trimmed, sender: 'You', body: message_body, timestamp: new Date() });

    const resolvedCount = await StorageRepository.resolveChatPendingItemsByChatId(trimmed, 'SEND');
    if (resolvedCount > 0) {
      console.log({ chatId: trimmed, resolvedCount }, 'Resolved open pending items after founder send');
    }

    const result = await OutboundService.sendWithJitter(trimmed, message_body);
    if (result === 'rate_limited' || result === 'failed') {
      await MessageQueueService.enqueueDelayedMorning(trimmed, message_body, 30 * 60 * 1000 + Math.floor(Math.random() * 30 * 60 * 1000));
    } else if (result === 'outside_hours') {
      await MessageQueueService.enqueueDelayedMorning(trimmed, message_body);
    }
    broadcastLive(c, LiveEvent.Messages, { chatId: trimmed });
    broadcastLive(c, LiveEvent.Contacts, { chatId: trimmed });
    broadcastLive(c, LiveEvent.PendingItems, { chatId: trimmed });
    return c.json({ success: true, result });
  });

  app.post('/api/whatsapp-proxy/send', async (c) => {
    const { StorageRepository, WhatsAppService, OutboundService, MessageQueueService } = deps();
    const body = await c.req.json().catch(() => ({}));
    const chatId = body.chatId;
    const message_body = body.message_body;
    if (!chatId || !message_body) return c.json({ error: 'Missing chatId or message_body' }, 400);
    const validationError = validateChatId(chatId);
    if (validationError) return c.json({ error: validationError }, 400);
    const allowlisted = await StorageRepository.hasInboundMessages(chatId);
    if (!allowlisted) return c.json({ error: 'chatId is not allowlisted: only contacts who have messaged you in the past can receive messages' }, 403);
    await WhatsAppService.saveMessage({ chatId, sender: 'You', body: message_body, timestamp: new Date() });
    const resolvedCount = await StorageRepository.resolveChatPendingItemsByChatId(chatId, 'SEND');
    if (resolvedCount > 0) console.log({ chatId, resolvedCount }, 'Resolved open pending items after founder send');
    const result = await OutboundService.sendWithJitter(chatId, message_body);
    if (result === 'rate_limited' || result === 'failed') {
      await MessageQueueService.enqueueDelayedMorning(chatId, message_body, 30 * 60 * 1000 + Math.floor(Math.random() * 30 * 60 * 1000));
    } else if (result === 'outside_hours') {
      await MessageQueueService.enqueueDelayedMorning(chatId, message_body);
    }
    return c.json({ success: true, result });
  });

  // ── Contacts ────────────────────────────────────────────────────────────────
  app.get('/api/whatsapp/contacts', async (c) => {
    const { StorageRepository } = deps();
    const dbContacts = await StorageRepository.fetchContacts();
    const contacts = dbContacts.map((cc: any) => ({
      uid: cc.chatId, name: cc.name, phone_number: cc.phoneNumber, pushName: cc.pushName,
      isGroup: cc.isGroup, picture: cc.picture || null, lastMessageAt: cc.lastMessageAt, lastMessageBody: cc.lastMessageBody, unreadCount: cc.unreadCount,
    }));
    return c.json({ contacts });
  });

  app.get('/api/whatsapp/contacts/:contactUid/messages', async (c) => {
    const { StorageRepository } = deps();
    const chatId = c.req.param('contactUid');
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
    const before = c.req.query('before') ? new Date(c.req.query('before') as string) : null;
    const messages = await StorageRepository.fetchMessagesByChatId(chatId, limit, before);
    return c.json(messages.sort((a: any, b: any) => a.timestamp.getTime() - b.timestamp.getTime()));
  });

  app.put('/api/whatsapp/contacts/:contactUid/picture', async (c) => {
    const { StorageRepository } = deps();
    const chatId = c.req.param('contactUid');
    const body = await c.req.json().catch(() => ({}));
    const picture = String(body?.picture ?? '').trim() || null;
    await StorageRepository.updateContactPicture(chatId, picture);
    broadcastLive(c, LiveEvent.Contacts, { chatId });
    return c.json({ ok: true, chatId, picture });
  });

  app.get('/api/whatsapp/contacts/:contactUid/note', async (c) => {
    const { StorageRepository } = deps();
    const chatId = c.req.param('contactUid');
    const note = await StorageRepository.getChatNote(chatId);
    return c.json({ chatId, content: note?.content || '' });
  });

  app.put('/api/whatsapp/contacts/:contactUid/note', async (c) => {
    const { StorageRepository } = deps();
    const chatId = c.req.param('contactUid');
    const body = await c.req.json().catch(() => ({}));
    const content = String(body?.content ?? '').trim();
    const note = await StorageRepository.upsertChatNote(chatId, content);
    broadcastLive(c, LiveEvent.Contacts, { chatId });
    return c.json({ chatId, content: note.content });
  });

  app.get('/api/whatsapp/contacts/:contactUid/summarize', async (c) => {
    const { StorageRepository, WhatsAppService, AIService, prisma } = deps();
    const chatId = c.req.param('contactUid');
    const contact = await StorageRepository.fetchContactByChatId(chatId);
    const contactName = contact?.name || chatId.split('@')[0];
    const founderNote = await StorageRepository.getChatNote(chatId);
    const localMsgs = await WhatsAppService.fetchMessagesByChatId(chatId);
    if (localMsgs.length === 0) {
      return c.json({
        id: chatId, chatId, chatName: contactName,
        summary: 'No message history available to summarize.', priority: 'low',
        category: 'General', sentiment: 'neutral', requiresFounder: false, createdAt: new Date().toISOString(),
      });
    }
    const messagesInput = localMsgs
      .sort((a: any, b: any) => a.timestamp.getTime() - b.timestamp.getTime())
      .map((m: any) => ({ sender: m.sender === 'You' || m.sender === 'Founder' ? 'You' : m.sender, body: m.body, timestamp: m.timestamp }));
    const summaryResult = await AIService.summarizeConversation(contactName, messagesInput, founderNote?.content || '');
    const digest = await prisma.digest.upsert({
      where: { id: chatId },
      update: {
        chatId, chatName: contactName, summary: summaryResult.summary,
        priority: (summaryResult.priority || 'medium') as any, category: summaryResult.category || 'General',
        sentiment: summaryResult.sentiment || 'neutral', requiresFounder: !!summaryResult.requires_founder,
        suggestedReply: summaryResult.suggested_reply || null, createdAt: new Date(),
      },
      create: {
        id: chatId, chatId, chatName: contactName, summary: summaryResult.summary,
        priority: (summaryResult.priority || 'medium') as any, category: summaryResult.category || 'General',
        sentiment: summaryResult.sentiment || 'neutral', requiresFounder: !!summaryResult.requires_founder,
        suggestedReply: summaryResult.suggested_reply || null, createdAt: new Date(),
      },
    });
    if (summaryResult.pending_from_founder && summaryResult.pending_from_founder.length > 0) {
      for (const item of summaryResult.pending_from_founder) {
        if (!item.description) continue;
        let dueDate: Date | null = null;
        if (item.due_date) { const p = new Date(item.due_date); if (!isNaN(p.getTime())) dueDate = p; }
        await StorageRepository.createChatPendingItem({ chatId, chatName: contactName, description: item.description, dueDate });
      }
    }
    return c.json(digest);
  });

  // ── Pending items ───────────────────────────────────────────────────────────
  app.get('/api/pending-items', async (c) => {
    const { StorageRepository } = deps();
    const openItems = await StorageRepository.fetchOpenChatPendingItems();
    const grouped = new Map<string, any[]>();
    for (const item of openItems) {
      const list = grouped.get(item.chatId) || [];
      list.push(item);
      grouped.set(item.chatId, list);
    }
    const chats = Array.from(grouped.entries()).map(([chatId, items]) => ({
      chatId, chatName: items[0]?.chatName || chatId, openCount: items.length, items,
    }));
    chats.sort((a, b) => {
      const aDue = a.items.find((i: any) => i.dueDate)?.dueDate;
      const bDue = b.items.find((i: any) => i.dueDate)?.dueDate;
      if (aDue && bDue) return new Date(aDue).getTime() - new Date(bDue).getTime();
      if (aDue) return -1;
      if (bDue) return 1;
      return 0;
    });
    return c.json({ totalOpen: openItems.length, chats });
  });

  app.get('/api/pending-items/chat/:chatId', async (c) => {
    const { StorageRepository } = deps();
    const chatId = c.req.param('chatId');
    const items = await StorageRepository.fetchOpenChatPendingItems(chatId);
    return c.json({ chatId, items });
  });

  app.post('/api/pending-items/:id/resolve', async (c) => {
    const { StorageRepository } = deps();
    const item = await StorageRepository.resolveChatPendingItem(c.req.param('id'), 'MANUAL');
    if (!item) return c.json({ error: 'Pending item not found or already resolved' }, 404);
    broadcastLive(c, LiveEvent.PendingItems, { chatId: item.chatId });
    return c.json(item);
  });

  app.post('/api/pending-items/:id/cancel', async (c) => {
    const { StorageRepository } = deps();
    const item = await StorageRepository.cancelChatPendingItem(c.req.param('id'));
    if (!item) return c.json({ error: 'Pending item not found or already resolved' }, 404);
    broadcastLive(c, LiveEvent.PendingItems, { chatId: item.chatId });
    return c.json(item);
  });
}