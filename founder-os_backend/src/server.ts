import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { config } from './config';
import { logger } from './shared/logger';
import { SchedulerService } from './modules/scheduler/service';
import { WhatsAppService } from './modules/whatsapp/service';
import { DigestService } from './modules/digest/service';
import { processMessagesToDigests } from './automations/whatsapp-digest/process';
import { TasksService } from './modules/tasks/service';
import { StorageRepository } from './modules/storage/repository';
import { AIService } from './modules/ai/service';
import { EmailService } from './modules/email/service';
import { checkDatabaseConnection, useInMemoryDb, prisma } from './shared/prisma';
import { SalesCopilotService } from './automations/zoho-sent-analyzer/service';
import { BrainService } from './modules/brain/service';
import { GoogleSheetsService } from './modules/google_sheets/service';
import { asyncHandler } from './utils/asyncHandler';
import { errorHandler, notFoundHandler } from './utils/errorHandler';
import { isSystemGeneratedComment } from './shared/systemComment';
import { OutboundService } from './modules/whatsapp/outbound';
import { MessageQueueService } from './modules/queue/service';
import { AuditService } from './modules/audit/service';
import webhookRouter from './routes/whatsapp-webhook';
import healthRouter from './routes/health';
import whatsappMarketingRouter from './routes/whatsapp-marketing';
import pendingItemsRouter from './routes/pending-items';
import telecallersRouter from './routes/telecallers';
import { automationRouter } from './modules/automation';
import * as AuthRoutes from './modules/auth/routes';
import { PrismaAuthStore } from './modules/auth/store-prisma';
import { createAuthStore } from './modules/auth/store';
import { authEnabled, getMe } from './modules/auth/service';
import { readSessionCookie } from './modules/auth/session';
import * as ChatRoutes from './modules/chat/routes';
import { PrismaChatStore } from './modules/chat/store-prisma';
import { createChatStore } from './modules/chat/store';
import * as EnquiryRoutes from './modules/enquiries/routes';
import { PrismaEnquiryStore } from './modules/enquiries/store-prisma';
import { createEnquiryStore } from './modules/enquiries/store';
import { extractEnquiryFields, pickGroqKey, EnquiryAgentRef } from './modules/enquiries/extract';


const app = express();

// Auth store (Postgres via Prisma; in-memory fallback when DB is off) + helpers.
const authStore = useInMemoryDb ? createAuthStore({}) : new PrismaAuthStore(prisma);
const chatStore = useInMemoryDb ? createChatStore({}) : new PrismaChatStore(prisma);
const enquiryStore = useInMemoryDb ? createEnquiryStore({}) : new PrismaEnquiryStore(prisma);
function publicOriginOf(req: Request): string {
  return process.env.AUTH_PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
}
function sendAuth(res: Response, r: any) {
  if (r.setCookie) res.setHeader('Set-Cookie', r.setCookie);
  if (r.redirect) return res.redirect(r.redirect);
  return res.status(r.status).json(r.body);
}

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ error: (reason as Error)?.message, stack: (reason as Error)?.stack }, 'UNHANDLED REJECTION');
});
process.on('uncaughtException', (err) => {
  logger.error({ error: err.message, stack: err.stack }, 'UNCAUGHT EXCEPTION');
});

// Serve the static frontend files
app.use(express.static(path.join(__dirname, '../public')));

app.use(express.json({ limit: '10mb' })); // Support larger payloads (like media Base64 from WhatsApp)

// Request logger middleware
app.use((req, res, next) => {
  logger.info({ method: req.method, url: req.url }, 'Incoming API Request');
  next();
});

// ── Google auth login gate (Express = local/alt runtime) ────────────────────
const AUTH_EXEMPT = ['/api/auth/', '/api/runner/', '/api/trigger/', '/api/health', '/health', '/api/status', '/webhook', '/dashboard', '/api/token/', '/api/estimates/bulk-upsert', '/api/neodove/report'];
app.use((req, res, next) => {
  if (!authEnabled(config)) return next();
  const path = req.path;
  if (AUTH_EXEMPT.some((p) => path.startsWith(p))) return next();
  const me = getMe(authStore, req.headers.cookie || null);
  if (!me) {
    if ((req.headers['upgrade'] || '').toLowerCase() === 'websocket') return res.sendStatus(401);
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
});

// --- WhatsApp webhook endpoint (secured: IP allowlist + rate limit) ---
app.use('/api/whatsapp/webhook', webhookRouter);

// --- Health Endpoints ---
app.use('/health', healthRouter);
app.use('/api/health', healthRouter);

// --- Automation Framework (admin/dashboard API) ---
app.use('/api/automations', automationRouter);

// --- WhatsApp Marketing (campaign CRUD + lead upload) ---
app.use('/api/whatsapp-marketing', whatsappMarketingRouter);

// --- Pending From Me (founder "What I Owe" view) ---
app.use('/api/pending-items', pendingItemsRouter);

// --- Telecaller roster (estimate auto-assignment) ---
app.use('/api/telecallers', telecallersRouter);

// --- Google Auth (routes + root user management) ---
app.get('/api/auth/google', (req, res) => sendAuth(res, AuthRoutes.authLogin(config, publicOriginOf(req))));
app.get('/api/auth/google/callback', async (req, res) =>
  sendAuth(res, await AuthRoutes.authCallback(config, authStore, (req.query.code as string) || null, publicOriginOf(req), req.secure)),
);
app.get('/api/auth/me', async (req, res) => sendAuth(res, await AuthRoutes.authMe(authStore, req.headers.cookie || null)));
app.post('/api/auth/logout', async (req, res) => sendAuth(res, await AuthRoutes.authLogout(authStore, req.headers.cookie || null, req.secure)));
app.get('/api/auth/users', async (req, res) => sendAuth(res, await AuthRoutes.authListUsers(authStore, req.headers.cookie || null)));
app.get('/api/auth/scopes', async (req, res) => sendAuth(res, await AuthRoutes.authListScopes(authStore, req.headers.cookie || null)));
app.post('/api/auth/scopes', async (req, res) => sendAuth(res, await AuthRoutes.authCreateScope(authStore, req.headers.cookie || null, req.body || {})));
app.delete('/api/auth/scopes/:key', async (req, res) => sendAuth(res, await AuthRoutes.authDeleteScope(authStore, req.headers.cookie || null, req.params.key)));
app.put('/api/auth/users/:id/scopes', async (req, res) => sendAuth(res, await AuthRoutes.authSetUserScopes(authStore, req.headers.cookie || null, req.params.id, req.body?.keys || [])));
app.get('/api/auth/roles', async (req, res) => sendAuth(res, await AuthRoutes.authListRoles(authStore, req.headers.cookie || null)));
app.post('/api/auth/roles', async (req, res) => sendAuth(res, await AuthRoutes.authCreateRole(authStore, req.headers.cookie || null, req.body || {})));
app.delete('/api/auth/roles/:key', async (req, res) => sendAuth(res, await AuthRoutes.authDeleteRole(authStore, req.headers.cookie || null, req.params.key)));
app.put('/api/auth/users/:id/roles', async (req, res) => sendAuth(res, await AuthRoutes.authSetUserRoles(authStore, req.headers.cookie || null, req.params.id, req.body?.keys || [])));

// --- Team chat (Discord-style channels) ---
async function chatMe(req: Request) {
  return getMe(authStore, req.headers.cookie || null);
}
app.get('/api/chat/channels', async (req, res) => {
  const me = await chatMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await ChatRoutes.chatListChannels(chatStore, me);
  res.status(r.status).json(r.body);
});
app.get('/api/chat/users', async (req, res) => {
  const me = await chatMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await ChatRoutes.chatListUsers(chatStore, me);
  res.status(r.status).json(r.body);
});
app.post('/api/chat/dm', async (req, res) => {
  const me = await chatMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await ChatRoutes.chatCreateDm(chatStore, me, req.body?.userId);
  res.status(r.status).json(r.body);
});
app.post('/api/chat/channels', async (req, res) => {
  const me = await chatMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await ChatRoutes.chatCreateChannel(chatStore, me, req.body || {});
  res.status(r.status).json(r.body);
});
app.get('/api/chat/channels/:id/messages', async (req, res) => {
  const me = await chatMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await ChatRoutes.chatListMessages(chatStore, me, req.params.id, (req.query.before as string) || null, (req.query.limit as string) || null);
  res.status(r.status).json(r.body);
});
app.post('/api/chat/channels/:id/messages', async (req, res) => {
  const me = await chatMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await ChatRoutes.chatSendMessage(chatStore, me, req.params.id, req.body || {});
  res.status(r.status).json(r.body);
});
app.post('/api/chat/channels/:id/read', async (req, res) => {
  const me = await chatMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await ChatRoutes.chatMarkRead(chatStore, me, req.params.id, req.body?.lastReadId ? Number(req.body.lastReadId) : null);
  res.status(r.status).json(r.body);
});
app.get('/api/chat/channels/:id/members', async (req, res) => {
  const me = await chatMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await ChatRoutes.chatListChannelMembers(chatStore, me, req.params.id);
  res.status(r.status).json(r.body);
});
app.post('/api/chat/channels/:id/members', async (req, res) => {
  const me = await chatMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await ChatRoutes.chatAddChannelMembers(chatStore, me, req.params.id, req.body?.userIds || []);
  res.status(r.status).json(r.body);
});
app.delete('/api/chat/channels/:id/members/:userId', async (req, res) => {
  const me = await chatMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await ChatRoutes.chatRemoveChannelMember(chatStore, me, req.params.id, req.params.userId);
  res.status(r.status).json(r.body);
});
app.patch('/api/chat/messages/:id', async (req, res) => {
  const me = await chatMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await ChatRoutes.chatUpdateMessage(chatStore, me, req.params.id, req.body || {});
  res.status(r.status).json(r.body);
});
app.delete('/api/chat/messages/:id', async (req, res) => {
  const me = await chatMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await ChatRoutes.chatDeleteMessage(chatStore, me, req.params.id);
  res.status(r.status).json(r.body);
});
app.post('/api/chat/typing', async (req, res) => {
  const me = await chatMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  res.status(200).json({ ok: true });
});

// --- Enquiry tracker (live sales pipeline) ---
async function enquiryMe(req: Request) {
  return getMe(authStore, req.headers.cookie || null);
}
app.get('/api/enquiries', async (req, res) => {
  const me = await enquiryMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await EnquiryRoutes.enquiryList(enquiryStore, me);
  res.status(r.status).json(r.body);
});
app.get('/api/enquiries/agents', async (req, res) => {
  const me = await enquiryMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const users = await authStore.listUsers();
  res.json(users.filter((u: any) => u.isRoot || u.scopes.includes('enquiries')).map((u: any) => ({
    id: u.id, name: u.name, email: u.email, picture: u.picture ?? null,
  })));
});
async function runEnquiryExtraction(id: string) {
  try {
    const key = pickGroqKey(process.env as any);
    if (!key) return;
    const enquiry = await enquiryStore.getEnquiry(id);
    if (!enquiry) return;
    const users = await authStore.listUsers();
    const agents: EnquiryAgentRef[] = users
      .filter((u: any) => u.isRoot || u.scopes.includes('enquiries'))
      .map((u: any) => ({ id: u.id, name: u.name }));
    const extracted = await extractEnquiryFields(key, {
      description: enquiry.description,
      title: enquiry.title,
      company: enquiry.clientCompany,
    }, agents);
    if (!extracted) return;
    const updates: Record<string, string> = {};
    if (!enquiry.title && extracted.title) updates.title = extracted.title;
    if (!enquiry.clientCompany && extracted.company) updates.clientCompany = extracted.company;
    if (!enquiry.contactName && extracted.contactName) updates.contactName = extracted.contactName;
    if (!enquiry.contactEmail && extracted.contactEmail) updates.contactEmail = extracted.contactEmail;
    if (!enquiry.contactPhone && extracted.contactPhone) updates.contactPhone = extracted.contactPhone;
    if (!enquiry.assignedAgentId && extracted.agentId) updates.assignedAgentId = extracted.agentId;
    if (Object.keys(updates).length) await enquiryStore.updateEnquiry(id, updates);
  } catch (e: any) {
    console.error('enquiry extraction failed:', e?.message);
  }
}

app.post('/api/enquiries', async (req, res) => {
  const me = await enquiryMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await EnquiryRoutes.enquiryCreate(enquiryStore, me, req.body || {});
  if (r.body?.id) void runEnquiryExtraction(r.body.id);
  res.status(r.status).json(r.body);
});
app.patch('/api/enquiries/:id', async (req, res) => {
  const me = await enquiryMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await EnquiryRoutes.enquiryUpdate(enquiryStore, me, req.params.id, req.body || {});
  if (r.body?.id) void runEnquiryExtraction(r.body.id);
  res.status(r.status).json(r.body);
});
app.post('/api/enquiries/:id/additional-requirements', async (req, res) => {
  const me = await enquiryMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await EnquiryRoutes.enquiryAddRequirement(enquiryStore, me, req.params.id, req.body || {});
  res.status(r.status).json(r.body);
});
app.delete('/api/enquiries/:id', async (req, res) => {
  const me = await enquiryMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await EnquiryRoutes.enquiryDelete(enquiryStore, me, req.params.id);
  res.status(r.status).json(r.body);
});
app.get('/api/enquiries/:id/comments', async (req, res) => {
  const me = await enquiryMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await EnquiryRoutes.enquiryComments(enquiryStore, me, req.params.id);
  res.status(r.status).json(r.body);
});
app.post('/api/enquiries/:id/comments', async (req, res) => {
  const me = await enquiryMe(req);
  if (!me) return res.status(401).json({ error: 'Authentication required' });
  const r = await EnquiryRoutes.enquiryAddComment(enquiryStore, me, req.params.id, req.body || {});
  res.status(r.status).json(r.body);
});
// File attachments are stored in Workers KV (worker runtime only); the
// Express/alt runtime is the local/dev path without KV.
app.post('/api/chat/files', (req, res) => res.status(501).json({ error: 'File upload is only available on the Cloudflare Worker runtime' }));
app.get('/api/chat/files/:key', (req, res) => res.status(501).json({ error: 'File serving is only available on the Cloudflare Worker runtime' }));

// --- REST API Endpoints ---

/**
 * GET /api/status
 * Returns connection diagnostic status (Supabase active / LLM API key status)
 */
app.get('/api/status', asyncHandler(async (req, res) => {
  const isMockLLM = !config.LLM_API_KEY || config.LLM_API_KEY === 'your_api_key_here';
  res.status(200).json({
    success: true,
    useInMemoryDb,
    isMockLLM,
  });
}));

/**
 * GET /api/brief/latest
 * Retrieve the latest generated founder briefing or EOD summary
 */
app.get('/api/brief/latest', asyncHandler(async (req, res) => {
  const brief = await StorageRepository.fetchLatestFounderNote();
  if (!brief) {
    res.status(404).json({ error: 'No briefings found.' });
    return;
  }
  res.status(200).json(brief);
}));

/**
 * GET /api/digests
 * Fetch conversation digests
 */
app.get('/api/digests', asyncHandler(async (req, res) => {
  let digests = await DigestService.fetchAllDigests();
  if (digests.length === 0) {
    logger.info('GET /api/digests: Digests list is empty. Triggering message digests compilation...');
    await processMessagesToDigests();
    digests = await DigestService.fetchAllDigests();
  }
  res.status(200).json(digests);
}));

/**
 * GET /api/tasks
 * Fetch extracted action items
 */
app.get('/api/tasks', asyncHandler(async (req, res) => {
  const tasks = await TasksService.fetchTasks();
  res.status(200).json(tasks);
}));

/**
 * GET /api/messages/:chatId
 * Fetch raw messages from a specific WhatsApp chat
 */
app.get('/api/messages/:chatId', asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const chatIdStr = Array.isArray(chatId) ? chatId[0] : chatId;
  const messages = await WhatsAppService.fetchMessagesByChatId(chatIdStr);
  res.status(200).json(messages);
}));

/**
 * GET /api/sheet-data
 * Fetch and parse data from a Google Sheet.
 * Query params: spreadsheetId, range
 */
app.get('/api/sheet-data', asyncHandler(async (req, res) => {
  const spreadsheetIdRaw = req.query.spreadsheetId as unknown;
  let spreadsheetId: string;
  if (Array.isArray(spreadsheetIdRaw)) {
    spreadsheetId = spreadsheetIdRaw[0] as string;
  } else if (typeof spreadsheetIdRaw === 'string') {
    spreadsheetId = spreadsheetIdRaw;
  } else if (spreadsheetIdRaw && typeof spreadsheetIdRaw === 'object') {
    spreadsheetId = '1OsQevXQpPT1x2iJgcg0lgUcOInxjZh3tvfNjxAbcENs';
  } else {
    spreadsheetId = '1OsQevXQpPT1x2iJgcg0lgUcOInxjZh3tvfNjxAbcENs';
  }
  
  const rangeRaw = req.query.range as unknown;
  let range: string;
  if (Array.isArray(rangeRaw)) {
    range = rangeRaw[0] as string;
  } else if (typeof rangeRaw === 'string') {
    range = rangeRaw;
  } else if (rangeRaw && typeof rangeRaw === 'object') {
    range = 'A1:Z1000';
  } else {
    range = 'A1:Z1000';
  }
  const data = await GoogleSheetsService.getSpreadsheetData(spreadsheetId, range);
  res.status(200).json(data);
}));

/**
 * POST /api/ask-founder-ai
 * Company Brain powered Q&A — searches all indexed company context and synthesizes an answer.
 * This is the primary chat endpoint used by the Founder Assistant UI.
 * Body: { question: string, entityFilter?: string }
 */
app.post('/api/ask-founder-ai', asyncHandler(async (req, res) => {
  let question = '';
  const { entityFilter } = req.body;
  question = req.body.question;
  if (!question) {
    res.status(400).json({ error: 'Missing question in request body' });
    return;
  }

  // Route through the Company Brain (Pillar 1) for cross-source context search
  const result = await BrainService.query(question, entityFilter);
  res.status(200).json({ question, answer: result.answer, brainMeta: {
    sourcesUsed: result.sourcesUsed,
    contextCount: result.contextCount,
  }});
}));

// --- Manual Test Trigger Endpoints ---

/**
 * POST /api/trigger/digest
 * Force trigger WhatsApp messages digestion
 */
app.post('/api/trigger/digest', asyncHandler(async (req, res) => {
  const result = await processMessagesToDigests();
  res.status(200).json({ message: 'Digest job triggered successfully', result });
}));

/**
 * POST /api/trigger/email-sync
 * Force sync unread emails
 */
app.post('/api/trigger/email-sync', asyncHandler(async (req, res) => {
  const count = await EmailService.syncEmails();
  res.status(200).json({ message: 'Email sync job completed', emailsSynced: count });
}));

/**
 * POST /api/trigger/briefing
 * Force generate morning briefing
 */
app.post('/api/trigger/briefing', asyncHandler(async (req, res) => {
  const brief = await SchedulerService.generateAndSaveMorningBrief();
  res.status(200).json({ message: 'Morning briefing generated and saved', brief });
}));

/**
 * POST /api/trigger/summary
 * Force generate daily evening summary
 */
app.post('/api/trigger/summary', asyncHandler(async (req, res) => {
  const summary = await SchedulerService.generateAndSaveEveningSummary();
  res.status(200).json({ message: 'Evening summary generated and saved', summary });
}));

/**
 * GET /api/estimates
 * Fetches active sent estimates and classifications
 */
app.get('/api/estimates', asyncHandler(async (req, res) => {
  const [estimates, lastCompleteSync] = await Promise.all([
    prisma.estimate.findMany({
      where: {
        OR: [
          { status: 'sent' },
          { status: 'accepted' },
          { status: 'declined' },
          { status: 'confirmed' }
        ]
      },
      include: {
        classification: true,
        comments: {
          orderBy: { commentId: 'desc' }
        }
      }
    }),
    prisma.setting.findUnique({ where: { key: 'sales_copilot:last_complete_sync_at' } }),
  ]);
  // Zoho auto-logged comments ("Quote marked as sent", "Quote updated. Amount
  // changed ...") carry no sales intent and must not reach the UI timeline or
  // comment counts, nor the LLM prompt. Filter them out of the payload.
  const estimatesWithRealComments = estimates.map(e => ({
    ...e,
    comments: (e.comments || []).filter(c => !isSystemGeneratedComment(c.description, c.commentedBy))
  }));
  res.status(200).json({
    estimates: estimatesWithRealComments,
    lastCompleteSyncAt: lastCompleteSync?.value ? lastCompleteSync.value : null
  });
}));

let salesSyncLastCompletedAt: Date | null = null;
let salesSyncLastError: string | null = null;

/**
 * GET /api/trigger/sales-sync/status
 * Returns the current state of the Sales Copilot sync job so the UI can poll
 * instead of holding a long-lived HTTP connection open.
 */
app.get('/api/trigger/sales-sync/status', asyncHandler(async (req, res) => {
  res.status(200).json({
    running: SalesCopilotService.isSyncRunning,
    lastCompletedAt: salesSyncLastCompletedAt,
    lastError: salesSyncLastError
  });
}));

/**
 * POST /api/trigger/sales-sync
 * Force sync and analyze Zoho Estimates (Sales Copilot).
 * Runs the job in the background and responds immediately, because a full sync
 * (fetching comments + AI classification for every estimate) can take minutes —
 * holding the HTTP request open causes proxy timeouts ("socket hang up").
 */
app.post('/api/trigger/sales-sync', asyncHandler(async (req, res) => {
  if (SalesCopilotService.isSyncRunning) {
    logger.warn('API: Sales sync trigger received while a job is already running. Rejecting request.');
    res.status(409).json({ error: 'Sync job is already processing. Please wait.' });
    return;
  }

  const force = Array.isArray(req.query.force) 
    ? req.query.force[0] === 'true' 
    : (req.query.force as string) === 'true' || req.body?.force === true;

  res.status(202).json({ message: 'Sales Copilot analysis started', status: 'started' });

  (async () => {
    try {
      await new SalesCopilotService().runSync(force);
      salesSyncLastCompletedAt = new Date();
      salesSyncLastError = null;
      logger.info('API: Sales Copilot background sync completed');
    } catch (err: any) {
      salesSyncLastError = err.message;
      logger.error({ error: err.message, stack: err.stack }, 'API: Sales Copilot background sync failed');
    }
  })();
}));

/**
 * POST /api/brain/query
 * The Company Brain — natural language search across all indexed company context
 * Body: { question: string, entityFilter?: string }
 */
app.post('/api/brain/query', asyncHandler(async (req, res) => {
  let question = '';
  const { entityFilter } = req.body;
  question = req.body.question;
  if (!question) {
    res.status(400).json({ error: 'Missing question in request body' });
    return;
  }
  const result = await BrainService.query(question, entityFilter);
  res.status(200).json(result);
}));

/**
 * GET /api/brain/stats
 * Returns current brain indexing statistics
 */
app.get('/api/brain/stats', asyncHandler(async (req, res) => {
  const stats = await BrainService.getStats();
  res.status(200).json(stats);
}));

/**
 * POST /api/trigger/brain-index
 * Force re-index all data sources into the Company Brain
 */
app.post('/api/trigger/brain-index', asyncHandler(async (req, res) => {
  const brain = new BrainService();
  const result = await brain.runSync();
  res.status(200).json({ message: 'Company Brain re-index complete', result });
}));

// --- Audit Endpoints ---

/**
 * GET /api/audit
 * Query audit log entries
 */
app.get('/api/audit', asyncHandler(async (req, res) => {
  const action = req.query.action as string | undefined;
  const entityType = req.query.entityType as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
  const since = req.query.since ? new Date(req.query.since as string) : undefined;
  const entries = await AuditService.query({ action, entityType, limit, since });
  res.status(200).json(entries);
}));

/**
 * GET /api/audit/pending
 * Get current pending items requiring founder attention
 */
app.get('/api/audit/pending', asyncHandler(async (req, res) => {
  const since = req.query.since ? new Date(req.query.since as string) : undefined;
  const items = await AuditService.getPendingItems({ since });
  res.status(200).json(items);
}));

/**
 * GET /api/audit/sla-breaches
 * Get SLA breaches since a given date
 */
app.get('/api/audit/sla-breaches', asyncHandler(async (req, res) => {
  const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const breaches = await AuditService.getSLABreaches(since);
  res.status(200).json(breaches);
}));

// --- WhatsApp API Endpoints (DB only — no WA Engine) ---

/**
 * POST /api/whatsapp/send
 * Dispatches a WhatsApp text message via WAHA with ban-proof jitter
 */
app.post('/api/whatsapp/send', asyncHandler(async (req, res) => {
  const { chatId, message_body } = req.body;
  if (!chatId || !message_body) {
    return res.status(400).json({ error: 'Missing chatId or message_body' });
  }
  let trimmed = chatId.trim();
  if (!trimmed.includes('@')) {
    trimmed = trimmed + '@c.us';
  }
  const suffix = trimmed.split('@').pop() || '';
  if (suffix !== 'g.us' && suffix !== 'c.us' && suffix !== 'lid') {
    return res.status(400).json({ error: 'chatId must end with @c.us, @g.us, or @lid' });
  }
  if (suffix === 'c.us') {
    if (/\+/.test(trimmed)) {
      return res.status(400).json({ error: 'chatId must not contain + sign (use e.g. 919876543210@c.us)' });
    }
    const match = trimmed.match(/^(\d+)@c\.us$/);
    if (!match) {
      return res.status(400).json({ error: 'chatId must be digits followed by @c.us (e.g. 919876543210@c.us)' });
    }
    const digits = match[1];
    const localNumber = digits.slice(-10);
    const countryCode = digits.slice(0, -10);
    if (!countryCode || !/^\d+$/.test(countryCode)) {
      return res.status(400).json({ error: 'chatId must include a numeric country code (e.g. 919876543210@c.us)' });
    }
    if (!/^\d{10}$/.test(localNumber)) {
      return res.status(400).json({ error: 'chatId must contain exactly 10 digits after the country code (e.g. 919876543210@c.us)' });
    }
  }

  // Allowlist gate: only contacts who have messaged us in the past can receive
  // outbound messages. Everything else is rejected upfront — no cold outreach.
  const allowlisted = await StorageRepository.hasInboundMessages(trimmed);
  if (!allowlisted) {
    logger.warn({ chatId: trimmed }, 'Send rejected: chat is not allowlisted (never messaged us)');
    return res.status(403).json({ success: false, error: 'chatId is not allowlisted: only contacts who have messaged you in the past can receive messages' });
  }

  await WhatsAppService.saveMessage({
    chatId: trimmed,
    sender: 'You',
    body: message_body,
    timestamp: new Date()
  });

  const result = await OutboundService.sendWithJitter(trimmed, message_body);
  if (result === 'rate_limited' || result === 'failed') {
    // Account/burst cap reached or WAHA rejected the send: defer instead of
    // dropping, and never fire in bulk.
    await MessageQueueService.enqueueDelayedMorning(trimmed, message_body, 30 * 60 * 1000 + Math.floor(Math.random() * 30 * 60 * 1000));
    logger.warn({ chatId: trimmed, result }, 'Send not delivered now: deferred to retry queue');
  } else if (result === 'outside_hours') {
    // Outside business hours: schedule for the next 8 AM IST window.
    await MessageQueueService.enqueueDelayedMorning(trimmed, message_body);
    logger.info({ chatId: trimmed }, 'Send deferred to next working-hours window');
  }
  return res.status(200).json({ success: true, result });
}));

/**
 * GET /api/whatsapp/contacts
 * Fetch all contacts from the local database
 */
app.get('/api/whatsapp/contacts', asyncHandler(async (req, res) => {
  const dbContacts = await StorageRepository.fetchContacts();
  const contacts = dbContacts.map(c => ({
    uid: c.chatId,
    name: c.name,
    phone_number: c.phoneNumber,
    pushName: c.pushName,
    isGroup: c.isGroup,
    lastMessageAt: c.lastMessageAt,
    lastMessageBody: c.lastMessageBody,
    unreadCount: c.unreadCount,
  }));
  return res.status(200).json({ contacts });
}));

/**
 * GET /api/whatsapp/contacts/:contactUid/messages
 * Fetch messages from the local database only
 */
app.get('/api/whatsapp/contacts/:contactUid/messages', asyncHandler(async (req, res) => {
  const chatId = String(req.params.contactUid);
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
  const before = req.query.before ? new Date(String(req.query.before)) : null;
  const messages = await WhatsAppService.fetchMessagesByChatId(chatId, limit, before);
  const sorted = messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return res.status(200).json(sorted);
}));

app.put('/api/whatsapp/contacts/:contactUid/picture', asyncHandler(async (req, res) => {
  const chatId = String(req.params.contactUid);
  const picture = String(req.body?.picture ?? '').trim() || null;
  await StorageRepository.updateContactPicture(chatId, picture);
  return res.status(200).json({ ok: true, chatId, picture });
}));

/**
 * GET /api/whatsapp/contacts/:contactUid/note
 * Private per-chat note (Personal Context). One note per chat/group, visible
 * only to the founder.
 */
app.get('/api/whatsapp/contacts/:contactUid/note', asyncHandler(async (req, res) => {
  const chatId = String(req.params.contactUid);
  const note = await StorageRepository.getChatNote(chatId);
  return res.status(200).json({ chatId, content: note?.content || '' });
}));

/**
 * PUT /api/whatsapp/contacts/:contactUid/note
 * Upsert the private per-chat note.
 */
app.put('/api/whatsapp/contacts/:contactUid/note', asyncHandler(async (req, res) => {
  const chatId = String(req.params.contactUid);
  const content = String(req.body?.content ?? '').trim();
  const note = await StorageRepository.upsertChatNote(chatId, content);
  return res.status(200).json({ chatId, content: note.content });
}));

/**
 * GET /api/whatsapp/contacts/:contactUid/summarize
 * Generate a conversation summary from local DB messages only
 */
app.get('/api/whatsapp/contacts/:contactUid/summarize', asyncHandler(async (req, res) => {
  const chatId = String(req.params.contactUid);
  const contact = await StorageRepository.fetchContactByChatId(chatId);
  const contactName = contact?.name || chatId.split('@')[0];

  const founderNote = await StorageRepository.getChatNote(chatId);
  const localMsgs = await WhatsAppService.fetchMessagesByChatId(chatId);
  if (localMsgs.length === 0) {
    return res.status(200).json({
      id: chatId,
      chatId,
      chatName: contactName,
      summary: 'No message history available to summarize.',
      priority: 'low',
      category: 'General',
      sentiment: 'neutral',
      requiresFounder: false,
      createdAt: new Date().toISOString()
    });
  }

  const messagesInput = localMsgs
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .map(m => ({
      sender: m.sender === 'You' || m.sender === 'Founder' ? 'You' : m.sender,
      body: m.body,
      timestamp: m.timestamp,
    }));

  const summaryResult = await AIService.summarizeConversation(contactName, messagesInput, founderNote?.content || '');

  const digest = await prisma.digest.upsert({
    where: { id: chatId },
    update: {
      chatId,
      chatName: contactName,
      summary: summaryResult.summary,
      priority: (summaryResult.priority || 'medium') as any,
      category: summaryResult.category || 'General',
      sentiment: summaryResult.sentiment || 'neutral',
      requiresFounder: !!summaryResult.requires_founder,
      suggestedReply: summaryResult.suggested_reply || null,
      createdAt: new Date()
    },
    create: {
      id: chatId,
      chatId,
      chatName: contactName,
      summary: summaryResult.summary,
      priority: (summaryResult.priority || 'medium') as any,
      category: summaryResult.category || 'General',
      sentiment: summaryResult.sentiment || 'neutral',
      requiresFounder: !!summaryResult.requires_founder,
      suggestedReply: summaryResult.suggested_reply || null,
      createdAt: new Date()
    }
  });

  return res.status(200).json(digest);
}));

// --- Server-Sent Events (SSE) for Real-Time UI updates ---
export let sseClients: any[] = [];

app.get('/api/whatsapp/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);
  logger.info({ clientCount: sseClients.length }, 'New SSE client connected');

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
    logger.info({ clientCount: sseClients.length }, 'SSE client disconnected');
  });
});

export function broadcastWhatsAppEvent(event: string, data: any) {
  const payload = `data: ${JSON.stringify({ event, data })}\n\n`;
  sseClients.forEach(client => {
    try {
      client.write(payload);
    } catch (e: any) {
      logger.error('Failed to write to SSE client connection');
    }
  });
}

// 404 handler - must be before error handler
app.use(notFoundHandler);

// Error handler - must be last
app.use(errorHandler);

// --- Boot Server & Start Cron Scheduler ---
/**
 * Blocks the background services (scheduler, workers) until WA Engine Pro's API
 * key verifies via GET /me. Cold-booting alongside a network that can't reach
 * waengine.pro would otherwise fire crons against an unauthenticated provider.
 */
async function waitForWaEngine(timeoutMs = 60_000): Promise<boolean> {
  const url = `${config.WA_ENGINE_BASE_URL}/me`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        headers: { 'X-API-Key': config.WA_ENGINE_API_KEY },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        logger.info('WA Engine Pro API reachable — starting background services');
        return true;
      }
    } catch {
      // WA Engine not reachable yet — keep polling.
    }
    logger.info('Waiting for WA Engine Pro API to become reachable...');
    await new Promise(r => setTimeout(r, 3000));
  }
  logger.warn('Timed out waiting for WA Engine Pro API; starting background services anyway');
  return false;
}

// ── SPA fallback (clean frontend paths) ──────────────────────────────────────
// Registered AFTER every /api route: any non-API GET serves the app shell so
// deep links like /enquiries or /briefing resolve without hash routing.
app.get(/^(?!\/api(\/|$)).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

async function startServer() {
  // Test connection to PostgreSQL at boot
  await checkDatabaseConnection();

  const port = config.PORT;
  app.listen(port, '0.0.0.0', async () => {
    logger.info(`🚀 Founder Assistant OS Server is running on http://localhost:${port} in ${config.NODE_ENV} mode`);

    // Cold-boot gate: wait for WA Engine Pro to be reachable before any cron/worker
    // touches it. The HTTP API is already listening, so health checks pass.
    await waitForWaEngine();

    // Start Background Scheduler (registers engines + discovers/schedules
    // every automation in src/automations/)
    await SchedulerService.init();

    // Start the BullMQ classification worker for real-time message classification.
    // The morning queue is drained by the 1-minute scheduler cron — keeping two
    // consumers on the same queue caused duplicate deliveries.
    MessageQueueService.startWorker();
  });
}

startServer().catch((err) => {
  logger.fatal({ error: err.message }, 'Failed to start Express server');
  process.exit(1);
});

export default app;