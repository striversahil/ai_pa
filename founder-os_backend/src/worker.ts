import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
  SHARED_SECRET?: string;
  WA_ENGINE_API_KEY?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  ZOHO_BOOKS_SENT_URL?: string;
  ZOHO_BOOKS_AUTH_TOKEN?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  [key: string]: unknown;
};

const app = new Hono<{ Bindings: Bindings }>();
app.use('*', cors());

// ── Boot: register engines + load automations on first request ─────────────
// MUST be registered before any route so AutomationEngine is populated before
// handlers (e.g. /api/automations/:slug/data) run.
let booted = false;
let bootPromise: Promise<void> | null = null;
app.use('*', async (c, next) => {
  bootstrapEnv(c.env);
  if (!booted) {
    booted = true;
    bootPromise = (async () => {
      const { SchedulerService } = deps();
      try {
        await SchedulerService.init();
      } catch (e: any) {
        console.log('Boot automation load failed:', e?.message);
      }
    })();
  }
  await bootPromise;
  await next();
});

// ── Env bootstrap (must run before any module import is exercised) ──────────
function bootstrapEnv(env: Bindings) {
  const envObj: Record<string, any> = {
    NODE_ENV: 'production',
    LLM_API_KEY: (env.LLM_API_KEY as string) || '',
    LLM_BASE_URL: (env.LLM_BASE_URL as string) || 'http://127.0.0.1:20128/v1',
    LLM_MODEL: (env.LLM_MODEL as string) || 'groq/openai/gpt-oss-120b',
    WA_ENGINE_BASE_URL: 'https://waengine.pro/api/v1',
    WA_ENGINE_API_KEY: (env.WA_ENGINE_API_KEY as string) || '',
    ZOHO_BOOKS_SENT_URL: (env.ZOHO_BOOKS_SENT_URL as string) || '',
    ZOHO_BOOKS_AUTH_TOKEN: (env.ZOHO_BOOKS_AUTH_TOKEN as string) || '',
    GOOGLE_SERVICE_ACCOUNT_JSON: (env.GOOGLE_SERVICE_ACCOUNT_JSON as string) || '',
    DATABASE_URL: '',
  };
  (globalThis as any).__WORKER_ENV__ = envObj;
  (globalThis as any).__WORKER_LOG_LEVEL__ = 'info';
  const { initD1 } = require('./shared/prisma-d1');
  initD1(env);
}

// Lazily require modules after bootstrap so config/prisma read the right globals.
const deps = () => {
  const { prisma } = require('./shared/prisma-d1');
  const { StorageRepository } = require('./modules/storage/repository');
  const { WhatsAppService } = require('./modules/whatsapp/service');
  const { DigestService } = require('./modules/digest/service');
  const { TasksService } = require('./modules/tasks/service');
  const { AIService } = require('./modules/ai/service');
  const { BrainService } = require('./modules/brain/service');
  const { AuditService } = require('./modules/audit/service');
  const { GoogleSheetsService } = require('./modules/google_sheets/service-worker');
  const { SalesCopilotService } = require('./automations/zoho-sent-analyzer/service');
  const { OutboundService } = require('./modules/whatsapp/outbound');
  const { MessageQueueService } = require('./modules/queue/service-worker');
  const { AutomationEngine } = require('./modules/automation/engine');
  const { processMessagesToDigests } = require('./automations/whatsapp-digest/process');
  const { SchedulerService } = require('./modules/scheduler/service-worker');
  const { AutomationRegistry } = require('./modules/automation/registry-worker');
  const { isSystemGeneratedComment } = require('./shared/systemComment');
  const { WhatsAppController } = require('./modules/whatsapp/controller-worker');
  const { executeCampaign, getCampaignStats, normalizePhone } = require('./automations/whatsapp-marketing/service');
  const { broadcastWhatsAppEvent } = require('./shared/sse-worker');
  const { EngineRegistry } = require('./shared/engine');
  const { WhatsappEngine } = require('./modules/whatsapp/engine');
  const { EmailEngine } = require('./modules/email/engine');
  return {
    prisma, StorageRepository, WhatsAppService, DigestService, TasksService, AIService,
    BrainService, AuditService, GoogleSheetsService, SalesCopilotService, OutboundService,
    MessageQueueService, AutomationEngine, processMessagesToDigests, SchedulerService,
    AutomationRegistry, isSystemGeneratedComment, WhatsAppController, executeCampaign,
    getCampaignStats, normalizePhone, broadcastWhatsAppEvent, EngineRegistry, WhatsappEngine,
    EmailEngine,
  };
};

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/health', async (c) => c.text('ok'));
app.get('/api/health', async (c) => {
  const { buildHealthPayload } = require('./modules/monitoring/health');
  return c.json(await buildHealthPayload());
});
app.get('/api/health/whatsapp', async (c) => {
  const { buildHealthPayload } = require('./modules/monitoring/health');
  return c.json(await buildHealthPayload());
});

// ── waba-worker merged endpoints (kept for local-runner + dashboard compat) ─
app.get('/webhook', (c) => {
  const challenge = c.req.query('hub.challenge') || c.req.query('challenge');
  return c.text(challenge || 'ok', 200);
});

app.post('/webhook', async (c) => {
  const env = c.env;
  const raw = await c.req.text();
  try {
    const payload = JSON.parse(raw);
    const provided = c.req.header('X-Api-Key') || '';
    if (env.WA_ENGINE_API_KEY && provided && provided !== env.WA_ENGINE_API_KEY) {
      return c.text('Forbidden', 403);
    }
    const event = payload.event || '';
    if (event === 'message.received' || event === 'message.status') {
      const direction = event === 'message.received' ? 'inbound' : 'outbound';
      const d = payload.data || {};
      const message = d.message || { id: d.wa_message_id, text: { body: d.text || '' }, type: d.type || 'text' };
      const wabaId = message?.id || message?.message_id || message?.wa_id ||
        d.wa_message_id ||
        `${d.phone || d.recipient || 'unknown'}:${message?.timestamp || payload.timestamp || Date.now()}`;
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO waba_payloads (whatsapp_id, payload, direction, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(whatsapp_id) DO UPDATE SET payload = excluded.payload, direction = excluded.direction`
      ).bind(wabaId, raw, direction, now).run();
    }
    return c.text('EVENT_RECEIVED', 200);
  } catch (err) {
    return c.text('Internal Processing Error', 500);
  }
});

function isAuthorized(c: any): boolean {
  const auth = c.req.header('Authorization') || '';
  return auth === `Bearer ${c.env.SHARED_SECRET}`;
}

app.get('/api/logs', async (c) => {
  if (!isAuthorized(c)) return c.text('Unauthorized', 401);
  const mode = c.req.query('mode');
  const chatId = c.req.query('chat');
  let query: string;
  const params: unknown[] = [];
  if (mode === 'cron') {
    query = "SELECT id, whatsapp_id, direction, payload FROM waba_payloads WHERE processed = 0 ORDER BY id ASC LIMIT 5";
  } else if (chatId) {
    query = "SELECT * FROM waba_payloads WHERE payload LIKE ? ORDER BY created_at DESC, id DESC LIMIT 100";
    params.push(`%${chatId}%`);
  } else {
    query = "SELECT * FROM waba_payloads ORDER BY created_at DESC, id DESC LIMIT 100";
  }
  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json(results);
});

app.post('/api/update', async (c) => {
  if (!isAuthorized(c)) return c.text('Unauthorized', 401);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.id !== 'number') return c.text('Bad Request', 400);
  await c.env.DB.prepare(
    "UPDATE waba_payloads SET processed = 1, ai_result = ?, processed_at = ? WHERE id = ?"
  ).bind(body.ai_result ?? null, new Date().toISOString(), body.id).run();
  return c.text('Success', 200);
});

app.get('/dashboard', (c) => {
  const html = `<!DOCTYPE html><html><head><title>WhatsApp Processing Dashboard</title></head><body><h1>Merged into founder-os worker — see /api/logs</h1></body></html>`;
  return c.html(html);
});

// ── WhatsApp webhook (founder-os ingest path) ───────────────────────────────
app.post('/api/whatsapp/webhook', async (c) => {
  const { WhatsAppController } = deps();
  const body = await c.req.json().catch(() => ({}));
  await WhatsAppController.handleWebhook(body);
  return c.json({ success: true });
});

// ── Status ──────────────────────────────────────────────────────────────────
app.get('/api/status', (c) => {
  return c.json({ success: true, useInMemoryDb: false, isMockLLM: false });
});

// ── Brief ───────────────────────────────────────────────────────────────────
app.get('/api/brief/latest', async (c) => {
  const { StorageRepository } = deps();
  const brief = await StorageRepository.fetchLatestFounderNote();
  if (!brief) return c.json({ error: 'No briefings found.' }, 404);
  return c.json(brief);
});

// ── Digests ─────────────────────────────────────────────────────────────────
app.get('/api/digests', async (c) => {
  const { DigestService, processMessagesToDigests } = deps();
  let digests = await DigestService.fetchAllDigests();
  if (digests.length === 0) {
    await processMessagesToDigests();
    digests = await DigestService.fetchAllDigests();
  }
  return c.json(digests);
});

// ── Tasks ───────────────────────────────────────────────────────────────────
app.get('/api/tasks', async (c) => {
  const { TasksService } = deps();
  return c.json(await TasksService.fetchTasks());
});

// ── Messages ────────────────────────────────────────────────────────────────
app.get('/api/messages/:chatId', async (c) => {
  const { WhatsAppService } = deps();
  const chatId = c.req.param('chatId');
  return c.json(await WhatsAppService.fetchMessagesByChatId(chatId));
});

// ── Sheet data ──────────────────────────────────────────────────────────────
app.get('/api/sheet-data', async (c) => {
  const { GoogleSheetsService } = deps();
  const spreadsheetId = c.req.query('spreadsheetId') || '1OsQevXQpPT1x2iJgcg0lgUcOInxjZh3tvfNjxAbcENs';
  const range = c.req.query('range') || 'A1:Z1000';
  return c.json(await GoogleSheetsService.getSpreadsheetData(spreadsheetId, range));
});

// ── Brain ───────────────────────────────────────────────────────────────────
app.post('/api/brain/query', async (c) => {
  const { BrainService } = deps();
  const body = await c.req.json().catch(() => ({}));
  const question = body.question;
  if (!question) return c.json({ error: 'Missing question in request body' }, 400);
  const result = await BrainService.query(question, body.entityFilter);
  return c.json(result);
});
app.post('/api/ask-founder-ai', async (c) => {
  const { BrainService } = deps();
  const body = await c.req.json().catch(() => ({}));
  const question = body.question;
  if (!question) return c.json({ error: 'Missing question in request body' }, 400);
  const result = await BrainService.query(question, body.entityFilter);
  return c.json({ question, answer: result.answer, brainMeta: { sourcesUsed: result.sourcesUsed, contextCount: result.contextCount } });
});
app.get('/api/brain/stats', async (c) => {
  const { BrainService } = deps();
  return c.json(await BrainService.getStats());
});

// ── Estimates ───────────────────────────────────────────────────────────────
app.get('/api/estimates', async (c) => {
  const { prisma, isSystemGeneratedComment } = deps();
  const [estimates, lastCompleteSync] = await Promise.all([
    prisma.estimate.findMany({
      where: { OR: [{ status: 'sent' }, { status: 'accepted' }, { status: 'declined' }, { status: 'confirmed' }] },
      include: { classification: true, comments: { orderBy: { commentId: 'desc' } } },
    }),
    prisma.setting.findUnique({ where: { key: 'sales_copilot:last_complete_sync_at' } }),
  ]);
  const estimatesWithRealComments = estimates.map((e: any) => ({
    ...e,
    comments: (e.comments || []).filter((cm: any) => !isSystemGeneratedComment(cm.description, cm.commentedBy)),
  }));
  return c.json({ estimates: estimatesWithRealComments, lastCompleteSyncAt: lastCompleteSync?.value ? lastCompleteSync.value : null });
});

// ── Audit ───────────────────────────────────────────────────────────────────
app.get('/api/audit', async (c) => {
  const { AuditService } = deps();
  const action = c.req.query('action') || undefined;
  const entityType = c.req.query('entityType') || undefined;
  const limit = Number(c.req.query('limit') || 100);
  const since = c.req.query('since') ? new Date(c.req.query('since')!) : undefined;
  return c.json(await AuditService.query({ action, entityType, limit, since }));
});
app.get('/api/audit/pending', async (c) => {
  const { AuditService } = deps();
  const since = c.req.query('since') ? new Date(c.req.query('since')!) : undefined;
  return c.json(await AuditService.getPendingItems({ since }));
});
app.get('/api/audit/sla-breaches', async (c) => {
  const { AuditService } = deps();
  const since = c.req.query('since') ? new Date(c.req.query('since')!) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  return c.json(await AuditService.getSLABreaches(since));
});

// ── WhatsApp API ────────────────────────────────────────────────────────────
function validateChatId(chatId: string): string | null {
  const trimmed = chatId.trim();
  if (trimmed.endsWith('@g.us')) return null;
  if (!trimmed.endsWith('@c.us')) return 'chatId must end with @c.us for individual chats';
  if (/\+/.test(trimmed)) return 'chatId must not contain + sign (use e.g. 919876543210@c.us)';
  const match = trimmed.match(/^(\d+)@c\.us$/);
  if (!match) return 'chatId must be digits followed by @c.us (e.g. 919876543210@c.us)';
  const digits = match[1];
  const localNumber = digits.slice(-10);
  const countryCode = digits.slice(0, -10);
  if (!countryCode || !/^\d+$/.test(countryCode)) return 'chatId must include a numeric country code (e.g. 919876543210@c.us)';
  if (!/^\d{10}$/.test(localNumber)) return 'chatId must contain exactly 10 digits after the country code (e.g. 919876543210@c.us)';
  return null;
}

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

app.get('/api/whatsapp/contacts', async (c) => {
  const { StorageRepository } = deps();
  const dbContacts = await StorageRepository.fetchContacts();
  const contacts = dbContacts.map((cc: any) => ({
    uid: cc.chatId, name: cc.name, phone_number: cc.phoneNumber, pushName: cc.pushName,
    isGroup: cc.isGroup, lastMessageAt: cc.lastMessageAt, lastMessageBody: cc.lastMessageBody, unreadCount: cc.unreadCount,
  }));
  return c.json({ contacts });
});

app.get('/api/whatsapp/contacts/:contactUid/messages', async (c) => {
  const { WhatsAppService } = deps();
  const chatId = c.req.param('contactUid');
  const messages = await WhatsAppService.fetchMessagesByChatId(chatId);
  return c.json(messages.sort((a: any, b: any) => a.timestamp.getTime() - b.timestamp.getTime()));
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

// SSE
app.get('/api/whatsapp/events', (c) => {
  const { stream } = require('./shared/sse-worker').handleSSEConnection();
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
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
  return c.json(item);
});

app.post('/api/pending-items/:id/cancel', async (c) => {
  const { StorageRepository } = deps();
  const item = await StorageRepository.cancelChatPendingItem(c.req.param('id'));
  if (!item) return c.json({ error: 'Pending item not found or already resolved' }, 404);
  return c.json(item);
});

// ── Trigger endpoints (GitHub Actions cron calls these) ─────────────────────
function requireSecret(c: any): boolean {
  const auth = c.req.header('Authorization') || '';
  const provided = auth.replace(/^Bearer\s+/i, '');
  const expected = c.env.SHARED_SECRET;
  if (!expected) return true; // secret not set → open (dev)
  return provided === expected;
}

app.post('/api/trigger/digest', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { processMessagesToDigests } = deps();
  const result = await processMessagesToDigests();
  return c.json({ message: 'Digest job triggered successfully', result });
});

app.post('/api/trigger/email-sync', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { EmailEngine } = deps();
  const count = await new EmailEngine().runSync();
  return c.json({ message: 'Email sync job completed', emailsSynced: count });
});

app.post('/api/trigger/briefing', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { SchedulerService } = deps();
  const brief = await SchedulerService.generateAndSaveMorningBrief();
  return c.json({ message: 'Morning briefing generated and saved', brief });
});

app.post('/api/trigger/summary', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { SchedulerService } = deps();
  const summary = await SchedulerService.generateAndSaveEveningSummary();
  return c.json({ message: 'Evening summary generated and saved', summary });
});

app.post('/api/trigger/brain-index', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { BrainService } = deps();
  const brain = new BrainService();
  const result = await brain.runSync();
  return c.json({ message: 'Company Brain re-index complete', result });
});

app.get('/api/trigger/sales-sync/status', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { SalesCopilotService } = deps();
  return c.json({
    running: SalesCopilotService.isSyncRunning,
    lastCompletedAt: (globalThis as any).__salesSyncLastCompletedAt ?? null,
    lastError: (globalThis as any).__salesSyncLastError ?? null,
  });
});

app.post('/api/trigger/sales-sync', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { SalesCopilotService } = deps();
  if (SalesCopilotService.isSyncRunning) return c.json({ error: 'Sync job is already processing. Please wait.' }, 409);
  const force = c.req.query('force') === 'true' || (await c.req.json().catch(() => ({}))).force === true;
  c.status(202);
  c.json({ message: 'Sales Copilot analysis started', status: 'started' });
  (async () => {
    try {
      await new SalesCopilotService().runSync(force);
      (globalThis as any).__salesSyncLastCompletedAt = new Date();
      (globalThis as any).__salesSyncLastError = null;
    } catch (err: any) {
      (globalThis as any).__salesSyncLastError = err.message;
    }
  })();
});

// Generic automation trigger by slug: /api/trigger/:slug → AutomationEngine.scan
app.post('/api/trigger/:slug', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { AutomationEngine } = deps();
  const slug = c.req.param('slug');
  const entry = AutomationEngine.get(slug);
  if (!entry) return c.json({ error: `automation '${slug}' not loaded` }, 404);
  await AutomationEngine.scan(slug);
  return c.json({ message: `Automation '${slug}' triggered`, ok: true });
});

// ── Automation admin API ────────────────────────────────────────────────────
function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

app.get('/api/automations', async (c) => {
  const { prisma, AutomationEngine } = deps();
  const rows = await prisma.automation.findMany({ orderBy: { createdAt: 'asc' } });
  const withDashboard = new Set(
    AutomationEngine.all().filter((e: any) => typeof e.module?.data === 'function').map((e: any) => e.def.id),
  );
  return c.json(rows.map((r: any) => ({
    id: r.id, slug: r.slug, name: r.name, description: r.description, type: r.type,
    enabled: r.enabled, cooldownMs: r.cooldownMs, lastRunAt: r.lastRunAt, runCount: r.runCount,
    hasDashboard: withDashboard.has(r.slug),
    trigger: parseJson(r.triggerJson), condition: parseJson(r.conditionJson),
    actions: parseJson(r.actionsJson), config: parseJson(r.configJson),
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  })));
});

app.get('/api/automations/:slug', async (c) => {
  const { prisma } = deps();
  const row = await prisma.automation.findUnique({
    where: { slug: c.req.param('slug') },
    include: { runs: { orderBy: { createdAt: 'desc' }, take: 20 } },
  });
  if (!row) return c.json({ error: 'automation not found' }, 404);
  return c.json({
    ...row,
    trigger: parseJson(row.triggerJson), condition: parseJson(row.conditionJson),
    actions: parseJson(row.actionsJson), config: parseJson(row.configJson),
  });
});

app.patch('/api/automations/:slug', async (c) => {
  const { prisma, AutomationEngine } = deps();
  const body = await c.req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.enabled === 'boolean') { data.enabled = body.enabled; AutomationEngine.setEnabled(c.req.param('slug'), body.enabled); }
  if (typeof body.cooldownMs === 'number') { data.cooldownMs = Math.max(0, Math.floor(body.cooldownMs)); }
  if (Object.keys(data).length === 0) return c.json({ error: 'nothing to update (use enabled or cooldownMs)' }, 400);
  const row = await prisma.automation.update({ where: { slug: c.req.param('slug') }, data });
  return c.json(row);
});

app.get('/api/automations/:slug/data', async (c) => {
  const { AutomationEngine } = deps();
  try {
    const data = await AutomationEngine.getData(c.req.param('slug'), c.req.query());
    return c.json(data);
  } catch (e: any) {
    return c.json({ error: e?.message ?? 'no data provider' }, 404);
  }
});

// ── WhatsApp Marketing (port of routes/whatsapp-marketing.ts) ───────────────
app.get('/api/whatsapp-marketing/campaigns', async (c) => {
  const { prisma, getCampaignStats } = deps();
  const campaigns = await prisma.marketingCampaign.findMany({ orderBy: { createdAt: 'desc' } });
  const rows = await Promise.all(campaigns.map(async (cc: any) => ({
    ...cc,
    stats: cc.statsJson ? JSON.parse(cc.statsJson) : await getCampaignStats(cc.id),
  })));
  return c.json(rows);
});

app.post('/api/whatsapp-marketing/campaigns', async (c) => {
  const { prisma } = deps();
  const body = await c.req.json().catch(() => ({}));
  const data = buildCampaignData(body);
  if (!data.name) return c.json({ error: 'name is required' }, 400);
  const campaign = await prisma.marketingCampaign.create({ data });
  return c.json(campaign, 201);
});

app.get('/api/whatsapp-marketing/campaigns/:id', async (c) => {
  const { prisma, getCampaignStats } = deps();
  const id = c.req.param('id');
  const campaign = await prisma.marketingCampaign.findUnique({
    where: { id },
    include: { runs: { orderBy: { startedAt: 'desc' }, take: 20 } },
  });
  if (!campaign) return c.json({ error: 'campaign not found' }, 404);
  const leads = await prisma.marketingLead.findMany({ where: { campaignId: campaign.id }, orderBy: { createdAt: 'desc' }, take: 200 });
  return c.json({ campaign, stats: await getCampaignStats(campaign.id), leads });
});

app.patch('/api/whatsapp-marketing/campaigns/:id', async (c) => {
  const { prisma } = deps();
  const id = c.req.param('id');
  const existing = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!existing) return c.json({ error: 'campaign not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const campaign = await prisma.marketingCampaign.update({ where: { id }, data: buildCampaignData(body) });
  return c.json(campaign);
});

app.delete('/api/whatsapp-marketing/campaigns/:id', async (c) => {
  const { prisma } = deps();
  await prisma.marketingCampaign.delete({ where: { id: c.req.param('id') } });
  return c.json({ ok: true });
});

function buildCampaignData(body: any): Record<string, any> {
  const data: Record<string, any> = {};
  if (body.name !== undefined) data.name = String(body.name);
  if (body.description !== undefined) data.description = body.description ? String(body.description) : null;
  if (body.type !== undefined) data.type = String(body.type);
  if (body.provider !== undefined) data.provider = String(body.provider);
  if (body.status !== undefined) data.status = String(body.status);
  if (body.scheduleType !== undefined) data.scheduleType = String(body.scheduleType);
  if (body.scheduledAt !== undefined) data.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  if (body.cron !== undefined) data.cron = body.cron ? String(body.cron) : null;
  if (body.timezone !== undefined) data.timezone = String(body.timezone);
  if (body.templateName !== undefined) data.templateName = body.templateName ? String(body.templateName) : null;
  if (body.templateLanguage !== undefined) data.templateLanguage = String(body.templateLanguage);
  if (body.templateParams !== undefined) data.templateParams = typeof body.templateParams === 'string' ? body.templateParams : JSON.stringify(body.templateParams ?? []);
  if (body.messageBody !== undefined) data.messageBody = body.messageBody ? String(body.messageBody) : null;
  if (body.mediaUrl !== undefined) data.mediaUrl = body.mediaUrl ? String(body.mediaUrl) : null;
  if (body.mediaFilename !== undefined) data.mediaFilename = body.mediaFilename ? String(body.mediaFilename) : null;
  if (body.senderPhoneNumberId !== undefined) data.senderPhoneNumberId = body.senderPhoneNumberId ? String(body.senderPhoneNumberId) : null;
  if (body.aisensyCampaignName !== undefined) data.aisensyCampaignName = body.aisensyCampaignName ? String(body.aisensyCampaignName) : null;
  if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);
  return data;
}

const PHONE_ALIASES = ['phone', 'phoneno', 'phonenumber', 'mobile', 'mobileno', 'number', 'whatsapp', 'whatsappno', 'contact', 'contactno', 'cell', 'cellno', 'telephone'];
const NAME_ALIASES = ['name', 'customername', 'companyname', 'company', 'clientname', 'client', 'leadname', 'contactname', 'businessname'];

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of lines[i]) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
      else current += ch;
    }
    values.push(current.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] ?? '').replace(/^"|"$/g, ''); });
    rows.push(row);
  }
  return rows;
}

function classifyLeadItem(item: Record<string, any>): { phone: string; name: string; attributes: Record<string, string> } {
  let phone = '';
  let name = '';
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(item)) {
    const nk = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
    const val = (typeof v === 'string' || typeof v === 'number') ? String(v) : '';
    if (!phone && PHONE_ALIASES.includes(nk) && val) { phone = val; continue; }
    if (!name && NAME_ALIASES.includes(nk) && val) { name = val; continue; }
    if (val) attributes[k] = val;
  }
  return { phone, name, attributes };
}

function extractLeads(input: string): { phoneNumber: string; name?: string; attributes?: Record<string, string> }[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const leads: { phoneNumber: string; name?: string; attributes?: Record<string, string> }[] = [];
  const { normalizePhone } = deps();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: any;
    try { parsed = JSON.parse(trimmed); } catch { return []; }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of arr) {
      if (typeof item !== 'object' || item === null) continue;
      const cl = classifyLeadItem(item);
      const phone = normalizePhone(cl.phone);
      if (!phone) continue;
      leads.push({ phoneNumber: phone, name: cl.name || undefined, attributes: Object.keys(cl.attributes).length ? cl.attributes : undefined });
    }
    return leads;
  }
  for (const row of parseCsv(trimmed)) {
    const cl = classifyLeadItem(row);
    const phone = normalizePhone(cl.phone);
    if (!phone) continue;
    leads.push({ phoneNumber: phone, name: cl.name || undefined, attributes: Object.keys(cl.attributes).length ? cl.attributes : undefined });
  }
  return leads;
}

app.post('/api/whatsapp-marketing/campaigns/:id/leads', async (c) => {
  const { prisma } = deps();
  const id = c.req.param('id');
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!campaign) return c.json({ error: 'campaign not found' }, 404);
  const contentType = c.req.header('content-type') || '';
  const raw = contentType.includes('text/plain') || contentType.includes('text/csv')
    ? await c.req.text()
    : JSON.stringify(await c.req.json().catch(() => ''));
  const leads = extractLeads(raw);
  if (!leads.length) return c.json({ error: 'no valid leads found (need phone column)' }, 400);
  let created = 0;
  let skipped = 0;
  for (const lead of leads) {
    try {
      await prisma.marketingLead.upsert({
        where: { campaignId_phoneNumber: { campaignId: campaign.id, phoneNumber: lead.phoneNumber } },
        update: { name: lead.name ?? undefined, attributes: lead.attributes ? JSON.stringify(lead.attributes) : undefined, status: 'pending', error: null, sentAt: null, deliveredAt: null, readAt: null },
        create: { campaignId: campaign.id, phoneNumber: lead.phoneNumber, name: lead.name, attributes: lead.attributes ? JSON.stringify(lead.attributes) : undefined },
      });
      created++;
    } catch (e: any) { skipped++; }
  }
  return c.json({ created, skipped, total: leads.length }, 201);
});

app.post('/api/whatsapp-marketing/campaigns/:id/run', async (c) => {
  const { prisma, executeCampaign } = deps();
  const id = c.req.param('id');
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!campaign) return c.json({ error: 'campaign not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const limit = body?.leadLimit ? Number(body.leadLimit) : 100;
  const result = await executeCampaign(campaign.id, { leadLimit: limit });
  return c.json({ ok: result.status !== 'failed', result });
});

app.get('/api/whatsapp-marketing/leads/:campaignId', async (c) => {
  const { prisma } = deps();
  const campaignId = c.req.param('campaignId');
  const status = c.req.query('status') || undefined;
  const take = Math.min(Number(c.req.query('limit')) || 100, 500);
  const skip = Number(c.req.query('offset')) || 0;
  const leads = await prisma.marketingLead.findMany({ where: { campaignId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take, skip });
  const total = await prisma.marketingLead.count({ where: { campaignId, ...(status ? { status } : {}) } });
  return c.json({ leads, total, offset: skip, limit: take });
});

export default app;