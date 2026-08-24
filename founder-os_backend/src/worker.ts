import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { EventHub } from './durable/event-hub';
import { AsyncTaskRunner } from './durable/async-task-runner';
import { broadcastLive, LiveEvent } from './live';
import * as AuthRoutes from './modules/auth/routes';
import { createAuthStore } from './modules/auth/store';
import { authEnabled, getMe } from './modules/auth/service';
import { readSessionCookie } from './modules/auth/session';
import { refreshNeodoveReport, istDateStr as neodoveTodayIst } from './automations/neodove-refresh';

type Bindings = {
  DB: D1Database;
  EVENT_HUB?: DurableObjectNamespace;
  ASYNC_RUNNER?: DurableObjectNamespace;
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
// Only automation-management routes wait for full boot; every other endpoint
// (estimates, token store, runner reads/writes…) proceeds immediately, which
// removes the cold-start automation-sync tax from hot public paths.
//
// Root-cause hardening (recurring daily dashboards-down episodes): previously a
// failed or hung SchedulerService.init() was swallowed ONCE and `booted` stayed
// true — the isolate kept an EMPTY AutomationEngine for hours (404s on all
// /api/automations/*) until Cloudflare happened to recycle it. Now:
//   - init races an 8s timeout so a hung D1 cannot stall requests forever,
//   - a failed/timed-out boot becomes RETRYABLE by the next request
//     (capped at BOOT_MAX_ATTEMPTS consecutive failures),
//   - automation routes self-heal: if the registry is still empty they force
//     another attempt instead of serving 404s indefinitely.
const BOOT_PATH_RE = /^\/api\/(trigger|automations)(\/|$)/;
const BOOT_TIMEOUT_MS = 8000;
const BOOT_WAIT_MS = 5000;
const BOOT_MAX_ATTEMPTS = 5;
let bootAttempts = 0;
let bootSucceeded = false;
let bootPromise: Promise<void> | null = null;

function ensureBoot(): Promise<void> {
  if (bootPromise) return bootPromise;
  const attempt = ++bootAttempts;
  bootPromise = (async () => {
    const { SchedulerService } = deps();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`boot timeout after ${BOOT_TIMEOUT_MS}ms`)), BOOT_TIMEOUT_MS);
      });
      await Promise.race([SchedulerService.init(), timeout]);
      bootSucceeded = true;
    } catch (e: any) {
      console.log(`Boot automation load failed (attempt ${attempt}):`, e?.message);
      bootPromise = null; // retryable — next automations request re-kicks boot
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  return bootPromise;
}

app.use('*', async (c, next) => {
  bootstrapEnv(c.env);
  if (BOOT_PATH_RE.test(new URL(c.req.url).pathname)) {
    if (!bootPromise && bootAttempts >= BOOT_MAX_ATTEMPTS) {
      try {
        if ((deps().AutomationEngine.all() as unknown[]).length === 0) bootAttempts = 0;
      } catch { /* deps not ready yet */ }
    }
    if (!bootPromise && bootAttempts < BOOT_MAX_ATTEMPTS) void ensureBoot();
    if (bootPromise) await Promise.race([bootPromise, new Promise((r) => setTimeout(r, BOOT_WAIT_MS))]);
  } else if (!bootPromise && bootAttempts < BOOT_MAX_ATTEMPTS) {
    void ensureBoot(); // opportunistic warm-up on any other request
  }
  await next();
});

// ── Google auth: routes + login gate (Worker = live runtime) ─────────────────
function authStore(c: any) {
  return createAuthStore(c.env);
}
function publicOrigin(c: any): string {
  return (c.env.AUTH_PUBLIC_ORIGIN as string) || new URL(c.req.url).origin;
}
function isSecure(c: any): boolean {
  return new URL(c.req.url).protocol === 'https:';
}
const AUTH_EXEMPT = [
  '/api/auth/',
  '/api/runner/',
  '/api/trigger/',
  '/api/health',
  '/health',
  '/api/status',
  '/webhook',
  '/dashboard',
  // Team-performance dashboards are safe to view without a session (the login
  // cookie is host-scoped, so preview subdomains would otherwise see 401).
  '/api/automations/telecalling/data',
  '/api/automations/neodove-telecaller-report/data',
  // GH Actions runners authenticate with SHARED_SECRET, not a session cookie.
  // These endpoints already enforce requireSecret() in their handlers, so the
  // OAuth gate must skip them or every runner→worker call 401s.
  '/api/token/',
  '/api/estimates/bulk-upsert',
  '/api/neodove/report',
];
function isAuthExempt(path: string): boolean {
  return AUTH_EXEMPT.some((p) => path.startsWith(p));
}

app.use('*', async (c, next) => {
  if (!authEnabled(c.env)) return next();
  const path = new URL(c.req.url).pathname;
  if (isAuthExempt(path)) return next();
  const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
  if (!me) {
    if (c.req.header('upgrade')?.toLowerCase() === 'websocket') return c.body(null, 401);
    return c.json({ error: 'Authentication required' }, 401);
  }
  await next();
});

app.get('/api/auth/google', async (c) => {
  const r = await AuthRoutes.authLogin(c.env, publicOrigin(c));
  if (r.redirect) return c.redirect(r.redirect);
  return c.json(r.body, r.status as any);
});
app.get('/api/auth/google/callback', async (c) => {
  const r = await AuthRoutes.authCallback(c.env, authStore(c), c.req.query('code') ?? null, publicOrigin(c), isSecure(c));
  if (r.setCookie) c.header('Set-Cookie', r.setCookie);
  if (r.redirect) return c.redirect(r.redirect);
  return c.json(r.body, r.status as any);
});
app.get('/api/auth/me', async (c) => {
  const r = await AuthRoutes.authMe(authStore(c), c.req.header('cookie') ?? null);
  return c.json(r.body, r.status as any);
});
app.post('/api/auth/logout', async (c) => {
  const r = await AuthRoutes.authLogout(authStore(c), c.req.header('cookie') ?? null, isSecure(c));
  if (r.setCookie) c.header('Set-Cookie', r.setCookie);
  return c.json(r.body, r.status as any);
});
app.get('/api/auth/users', async (c) => {
  const r = await AuthRoutes.authListUsers(authStore(c), c.req.header('cookie') ?? null);
  return c.json(r.body, r.status as any);
});
app.get('/api/auth/scopes', async (c) => {
  const r = await AuthRoutes.authListScopes(authStore(c), c.req.header('cookie') ?? null);
  return c.json(r.body, r.status as any);
});
app.post('/api/auth/scopes', async (c) => {
  const r = await AuthRoutes.authCreateScope(authStore(c), c.req.header('cookie') ?? null, await c.req.json().catch(() => ({})));
  return c.json(r.body, r.status as any);
});
app.delete('/api/auth/scopes/:key', async (c) => {
  const r = await AuthRoutes.authDeleteScope(authStore(c), c.req.header('cookie') ?? null, c.req.param('key') ?? null);
  return c.json(r.body, r.status as any);
});
app.put('/api/auth/users/:id/scopes', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const r = await AuthRoutes.authSetUserScopes(authStore(c), c.req.header('cookie') ?? null, c.req.param('id') ?? null, body.keys || []);
  return c.json(r.body, r.status as any);
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
    ZOHO_CURL_CONTENT: (env.ZOHO_CURL_CONTENT as string) || '',
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

      // Also feed the founder-os pipeline (Message/Contact/Digest tables) so the
      // founder-os dashboard reflects real inbound traffic, not just the raw
      // waba_payloads store. Runs in the background; the raw store above still
      // serves the local-runner AI queue.
      if (event === 'message.received') {
        const { WhatsAppController } = deps();
        // waengine.pro flat shape: { event, timestamp, data: { phone, type, text, message_id? } }.
        // Real payloads carry NO message_id (only conversation_id/contact_id) and an
        // ISO-8601 timestamp, while the pipeline expects a message id plus epoch
        // SECONDS. Normalize both or the Message insert dies on "Invalid time value".
        let normalized = payload;
        if (!d.message) {
          const epochSec = Math.floor(new Date(payload.timestamp || Date.now()).getTime() / 1000) || Math.floor(Date.now() / 1000);
          const messageId = d.message_id || d.id || `${d.phone || 'unknown'}-${payload.timestamp || Date.now()}`;
          const message: any = { id: messageId, phone: d.phone, type: d.type || 'text', timestamp: epochSec };
          // Only attach text when present — an empty text object would bypass
          // extractMessageBody's [Image]/[Video] type-label fallback.
          if (d.text) message.text = { body: String(d.text) };
          normalized = {
            event,
            timestamp: payload.timestamp,
            // keep waengine ids on data — media enrichment matches via
            // conversation_id against GET /messages.
            data: { ...d, message, contact: { phone_number: d.phone } },
          };
        }
        void c.executionCtx.waitUntil((async () => {
          try {
            await enrichWaEngineMedia(normalized, c.env);
          } catch (err: any) {
            console.log('waengine media enrichment failed:', err?.message);
          }
          await WhatsAppController.handleWebhook(normalized);
        })().catch((err: any) => {
          console.log('Founder-os pipeline webhook processing failed:', err?.message);
        }));
      }
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

// ── waengine.pro media enrichment ────────────────────────────────────────────
// Inbound webhooks carry only { phone, type, text } — no media URL, caption or
// filename. Those live behind GET /messages?conversation_id=… (media.url etc).
// For media messages we fetch the recent conversation once (60s in-isolate
// cache absorbs bursts), match the webhook to the API row by type + nearest
// createdAt, and attach media info so the pipeline stores it on the Message.
const MEDIA_ENRICH_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);
const MEDIA_MATCH_TOLERANCE_MS = 10 * 60 * 1000;
const convCache = new Map<string, { msgs: any[]; at: number }>();

async function enrichWaEngineMedia(normalized: any, env: any): Promise<void> {
  const d = normalized?.data;
  const msg = d?.message;
  if (!msg || !MEDIA_ENRICH_TYPES.has(String(d.type)) || msg.media?.url) return;
  if (!d.conversation_id || !env.WA_ENGINE_API_KEY) return;

  let entry = convCache.get(d.conversation_id);
  if (!entry || Date.now() - entry.at > 60_000) {
    const base = String(env.WA_ENGINE_BASE_URL || 'https://waengine.pro/api/v1').replace(/\/$/, '');
    const res = await fetch(`${base}/messages?conversation_id=${encodeURIComponent(d.conversation_id)}&limit=50`, {
      headers: { 'X-API-Key': env.WA_ENGINE_API_KEY },
    });
    if (!res.ok) throw new Error(`waengine /messages ${res.status}`);
    const json: any = await res.json();
    entry = { msgs: Array.isArray(json.data) ? json.data : [], at: Date.now() };
    convCache.set(d.conversation_id, entry);
  }

  const target = new Date(normalized.timestamp || Date.now()).getTime();
  let best: any = null;
  let bestDelta = Infinity;
  for (const m of entry.msgs) {
    if (m.direction !== 'inbound' || m.type !== d.type) continue;
    const delta = Math.abs(new Date(m.createdAt).getTime() - target);
    if (delta < bestDelta) { bestDelta = delta; best = m; }
  }
  if (!best || bestDelta > MEDIA_MATCH_TOLERANCE_MS) return;

  const media = best.media || {};
  msg.media = {
    url: media.url || null,
    mimeType: media.mimeType || null,
    caption: media.caption || null,
    filename: media.filename || null,
  };
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
  broadcastLive(c, LiveEvent.Messages);
  broadcastLive(c, LiveEvent.Contacts);
  broadcastLive(c, LiveEvent.Digests);
  broadcastLive(c, LiveEvent.PendingItems);
  return c.json({ success: true });
});

// ── Token webhook (external services POST new tokens here) ──────────────────
// Expects: { source: "neodove", token: <any JSON>, metadata?: { expires_at?: string, ... } }
// Protected by SHARED_SECRET via Authorization: Bearer <secret>
// Upserts by source — repeated POSTs overwrite the token.
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

// GET /api/token/:source — retrieve a stored token (for runners/reports)
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

// List all stored token sources (for debugging)
app.get('/api/token', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const rows = await prisma.token.findMany({ select: { source: true, metadata: true, createdAt: true, updatedAt: true } });
  return c.json(rows.map((r: any) => ({ source: r.source, metadata: r.metadata ? JSON.parse(r.metadata) : null, createdAt: r.createdAt, updatedAt: r.updatedAt })));
});

// ── Status ──────────────────────────────────────────────────────────────────
app.get('/api/status', (c) => {
  let boot: Record<string, unknown>;
  try {
    const loaded = bootPromise ? (deps().AutomationEngine.all() as unknown[]).length : 0;
    boot = { attempts: bootAttempts, automationsLoaded: loaded, healthy: bootSucceeded && loaded > 0 };
  } catch {
    boot = { attempts: bootAttempts, automationsLoaded: 0, healthy: false };
  }
  return c.json({ success: true, useInMemoryDb: false, isMockLLM: false, boot });
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
  const { DigestService } = deps();
  return c.json(await DigestService.fetchAllDigests());
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

// ── Telecaller roster (estimate auto-assignment) ──────────────────────────────
app.get('/api/telecallers', async (c) => {
  const { prisma } = deps();
  const tcs = await prisma.telecaller.findMany({ orderBy: { order: 'asc' } });
  const withCounts = await Promise.all(
    tcs.map(async (t: any) => {
      const [totalAssigned, activeAssigned] = await Promise.all([
        prisma.estimateAssignment.count({ where: { telecallerId: t.id } }),
        prisma.estimateAssignment.count({ where: { telecallerId: t.id, status: 'assigned' } }),
      ]);
      return { ...t, totalAssigned, activeAssigned };
    }),
  );
  return c.json({ telecallers: withCounts });
});

app.post('/api/telecallers', async (c) => {
  const { prisma } = deps();
  const body = await c.req.json().catch(() => ({}));
  if (!body?.name) return c.json({ error: 'name required' }, 400);
  const tc = await prisma.telecaller.create({
    data: {
      name: String(body.name).trim(),
      email: body.email ?? null,
      active: body.active ?? true,
      order: body.order ?? 0,
      neodoveUserId: body.neodoveUserId ?? null,
      neodoveUserName: body.neodoveUserName ?? null,
    },
  });
  return c.json(tc, 201);
});

app.put('/api/telecallers/:id', async (c) => {
  const { prisma } = deps();
  const body = await c.req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.email !== undefined) data.email = body.email;
  if (body.active !== undefined) data.active = body.active;
  if (body.order !== undefined) data.order = body.order;
  if (body.neodoveUserId !== undefined) data.neodoveUserId = body.neodoveUserId;
  if (body.neodoveUserName !== undefined) data.neodoveUserName = body.neodoveUserName;
  const tc = await prisma.telecaller.update({ where: { id: c.req.param('id') }, data });
  return c.json(tc);
});

app.delete('/api/telecallers/:id', async (c) => {
  const { prisma } = deps();
  await prisma.telecaller.delete({ where: { id: c.req.param('id') } });
  return c.json({ ok: true });
});

// ── Baseline snapshot (shared across all viewers, frozen daily at 1 AM IST) ──
function kolkataDateStr(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now).slice(0, 10);
}

// POST → server-side NeoDove USER_REPORT refresh (today, IST).
// Runs inside the Worker because GitHub Actions egress IPs are blocked by
// connect.neodove.com (the 10-min GH workflow failed ~90% of runs). Also
// invoked natively every 10 min via the [triggers] cron in wrangler.toml.
app.post('/api/runner/neodove-refresh', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  try {
    const body = await c.req.json().catch(() => ({}));
    const result = await refreshNeodoveReport(typeof body?.date === 'string' ? body.date : undefined);
    return c.json(result, result.ok ? 200 : 502);
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

// POST (GH Actions daily job at 1 AM IST) → captures the baseline for today.
app.post('/api/runner/estimates/baseline', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const estimates = await prisma.estimate.findMany({
    where: { status: 'sent' },
    include: { comments: { orderBy: { commentId: 'desc' } } },
  });
  const baseline = estimates.map((e: any) => ({
    estimateId: e.estimateId,
    estimateNumber: e.estimateNumber,
    customerName: e.customerName,
    total: e.total,
    status: e.status,
  }));
  const key = `zoho_baseline:${kolkataDateStr()}`;
  await prisma.setting.upsert({
    where: { key },
    update: { value: JSON.stringify(baseline) },
    create: { key, value: JSON.stringify(baseline) },
  });
  notifyLive(c, { type: 'baseline', date: key.slice('zoho_baseline:'.length) });
  return c.json({ ok: true, key, count: baseline.length });
});

// GET → returns TODAY's frozen baseline; before the 01:00 AM IST freeze has run,
// falls back to the most recent snapshot flagged `isStale` so viewers can show a
// clean "day not started" state instead of yesterday's movement.
app.get('/api/estimates/baseline', async (c) => {
  const { prisma } = deps();
  const prefix = 'zoho_baseline:';
  const todayKey = `${prefix}${kolkataDateStr()}`;
  let row = await prisma.setting.findUnique({ where: { key: todayKey } });
  let isStale = false;
  if (!row?.value) {
    row = await prisma.setting.findFirst({
      where: { key: { startsWith: prefix } },
      orderBy: { key: 'desc' },
    });
    isStale = true;
  }
  const date = row?.key.slice(prefix.length) ?? null;
  try {
    return c.json({ date, isStale, baseline: row?.value ? JSON.parse(row.value) : null });
  } catch {
    return c.json({ date, isStale: true, baseline: null });
  }
});

// ── NeoDove daily user/call report (GH Actions runner stores it here) ────────
// POST body: { reportDate: 'YYYY-MM-DD', report: { rows: [...] } }
app.post('/api/runner/neodove/report', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const body = await c.req.json().catch(() => ({}));
  const reportDate = String(body?.reportDate || kolkataDateStr());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return c.json({ error: 'reportDate must be YYYY-MM-DD' }, 400);
  const rows = body?.report?.rows;
  if (!Array.isArray(rows)) return c.json({ error: 'report.rows[] required' }, 400);
  const key = `neodove_user_report:${reportDate}`;
  const value = JSON.stringify({ reportDate, fetchedAt: new Date().toISOString(), rows });
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  notifyLive(c, { type: 'neodove', date: reportDate });
  return c.json({ ok: true, key, count: rows.length });
});

// GET /api/neodove/report?date=YYYY-MM-DD — public read for dashboards (default: latest)
app.get('/api/neodove/report', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const dateParam = c.req.query('date');
  let row: any;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    row = await prisma.setting.findUnique({ where: { key: `neodove_user_report:${dateParam}` } });
  } else {
    const rows = await prisma.setting.findMany({
      where: { key: { startsWith: 'neodove_user_report:' } },
      orderBy: { key: 'desc' },
      take: 1,
    });
    row = rows[0];
  }
  if (!row?.value) return c.json({ error: 'no neodove report found' }, 404);
  try {
    return c.json(JSON.parse(row.value));
  } catch {
    return c.json({ error: 'corrupt report row' }, 500);
  }
});

// ── Zoho Estimate AI Classification (GitHub Actions) ──────────────────────────
app.post('/api/estimates/classify', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const body = await c.req.json();
  const { estimateId, badgeResult, journeyResult } = body;
  if (!estimateId || !badgeResult) return c.json({ error: 'estimateId + badgeResult required' }, 400);

  await prisma.classification.upsert({
    where: { estimateId },
    update: {
      meaningfulUpdate: !!badgeResult.meaningful_update,
      notAnswering: badgeResult.not_answering ? 'Yes' : 'No',
      movingSlow: 'No',
      underDiscussion: badgeResult.under_discussion ? 'Yes' : 'No',
      confirm: badgeResult.confirm ? 'Yes' : 'No',
      intentScore: journeyResult?.intent_score ?? 2,
      reasoning: badgeResult.reasoning || 'AI classification',
      summary: journeyResult?.summary || '',
      processedAt: new Date(),
    },
    create: {
      estimateId,
      meaningfulUpdate: !!badgeResult.meaningful_update,
      notAnswering: badgeResult.not_answering ? 'Yes' : 'No',
      movingSlow: 'No',
      underDiscussion: badgeResult.under_discussion ? 'Yes' : 'No',
      confirm: badgeResult.confirm ? 'Yes' : 'No',
      intentScore: journeyResult?.intent_score ?? 2,
      reasoning: badgeResult.reasoning || 'AI classification',
      summary: journeyResult?.summary || '',
      processedAt: new Date(),
    },
  });
  await prisma.estimate.update({ where: { estimateId }, data: { lastSyncTime: new Date() } });
  notifyLive(c, { type: 'estimates' });
  return c.json({ ok: true });
});

app.post('/api/estimates/bulk-upsert', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const body = await c.req.json();
  const { estimates, lastSyncAt } = body;
  let upserted = 0;
  if (estimates && Array.isArray(estimates)) {
    for (const est of estimates) {
      await prisma.estimate.upsert({
        where: { estimateId: est.estimateId },
        update: {
          estimateNumber: est.estimateNumber,
          customerName: est.customerName,
          total: est.total,
          date: est.date,
          status: est.status,
          skipMatching: est.skipMatching || 0,
        },
        create: {
          estimateId: est.estimateId,
          estimateNumber: est.estimateNumber,
          customerName: est.customerName,
          total: est.total,
          date: est.date,
          status: est.status,
          skipMatching: est.skipMatching || 0,
          lastSyncTime: new Date(),
        },
      });
      upserted++;
    }
  }
  if (lastSyncAt) {
    await prisma.setting.upsert({
      where: { key: 'sales_copilot:last_complete_sync_at' },
      update: { value: lastSyncAt },
      create: { key: 'sales_copilot:last_complete_sync_at', value: lastSyncAt },
    });
  }
  notifyLive(c, { type: 'estimates' });
  return c.json({ ok: true, count: upserted });
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

// ── Trigger endpoints (GitHub Actions cron calls these) ─────────────────────
function requireSecret(c: any): boolean {
  const auth = c.req.header('Authorization') || '';
  const provided = auth.replace(/^Bearer\s+/i, '');
  const expected = c.env.SHARED_SECRET;
  if (!expected) return true; // secret not set → open (dev)
  return provided === expected;
}

app.post('/api/trigger/:slug', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { AutomationEngine } = deps();
  const slug = c.req.param('slug');
  const entry = AutomationEngine.get(slug);
  if (!entry) return c.json({ error: `automation '${slug}' not loaded` }, 404);
  // Async mode (?async=1): schedule the scan on a Durable Object alarm so the
  // caller (GitHub Actions) returns immediately while the (possibly long) scan
  // runs to completion server-side. The live event still fires when it's done.
  if (c.req.query('async') === '1' && c.env.ASYNC_RUNNER) {
    const origin = new URL(c.req.url).origin;
    const stub = c.env.ASYNC_RUNNER.get(c.env.ASYNC_RUNNER.idFromName(slug));
    c.executionCtx.waitUntil(
      stub.fetch(new Request(`https://do/schedule?slug=${encodeURIComponent(slug)}&origin=${encodeURIComponent(origin)}`)).catch(() => {})
    );
    return c.json({ ok: true, async: true, message: `Automation '${slug}' scheduled` });
  }
  await AutomationEngine.scan(slug);
  notifyLive(c, { type: 'automation', slug });
  return c.json({ message: `Automation '${slug}' triggered`, ok: true });
});

// Internal: runs an automation scan synchronously (called by AsyncTaskRunner's
// alarm). The request stays open for the full scan duration. Notifies on
// completion so dashboards refresh live.
app.post('/api/internal/run-automation', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { AutomationEngine } = deps();
  const slug = c.req.query('slug') || '';
  const entry = AutomationEngine.get(slug);
  if (!entry) return c.json({ error: `automation '${slug}' not loaded` }, 404);
  await AutomationEngine.scan(slug);
  notifyLive(c, { type: 'automation', slug });
  return c.json({ ok: true });
});

// ── Runner API (GitHub Actions heavy processing) ──────────────────────────────
// Instant D1 data-read + result-write endpoints for the GH Actions runner
// scripts (scripts/*.js). Heavy AI / cron / Zoho crawling runs on the runner;
// this worker only fetches raw rows and persists results. All endpoints are
// SHARED_SECRET gated and stay well under the 30s CPU limit.

// ── whatsapp-digest runner ───────────────────────────────────────────────────
app.get('/api/runner/messages/unprocessed', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { StorageRepository } = deps();
  const messages = await StorageRepository.fetchUnprocessedMessages();
  return c.json(messages.map((m: any) => ({
    id: m.id, chatId: m.chatId, sender: m.sender, body: m.body,
    timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
  })));
});

app.get('/api/runner/digests/latest', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { StorageRepository } = deps();
  const chatId = c.req.query('chatId') || '';
  if (!chatId) return c.json({ error: 'chatId query required' }, 400);
  const digest = await StorageRepository.fetchLatestDigestByChatId(chatId);
  if (!digest) return c.json({ digest: null });
  return c.json({ digest: { summary: digest.summary, priority: digest.priority, suggestedReply: digest.suggestedReply } });
});

app.get('/api/runner/chat-notes', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { StorageRepository } = deps();
  const chatId = c.req.query('chatId') || '';
  if (!chatId) return c.json({ error: 'chatId query required' }, 400);
  const note = await StorageRepository.getChatNote(chatId);
  return c.json({ content: note?.content || '' });
});

app.post('/api/runner/digests', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { StorageRepository } = deps();
  const body = await c.req.json().catch(() => ({}));
  if (!body.chatId || !body.summary) return c.json({ error: 'chatId + summary required' }, 400);
  const digest = await StorageRepository.saveDigest({
    chatId: body.chatId,
    chatName: body.chatName || body.chatId,
    summary: body.summary,
    priority: body.priority || 'medium',
    category: body.category || 'General',
    sentiment: body.sentiment || 'neutral',
    requiresFounder: !!body.requiresFounder,
    suggestedReply: body.suggestedReply || undefined,
  });
  broadcastLive(c, LiveEvent.Digests, { chatId: body.chatId });
  return c.json({ ok: true, id: digest.id });
});

app.post('/api/runner/tasks', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { StorageRepository } = deps();
  const body = await c.req.json().catch(() => ({}));
  if (!body.title) return c.json({ error: 'title required' }, 400);
  let deadline: Date | null = null;
  if (body.deadline) { const d = new Date(body.deadline); if (!isNaN(d.getTime())) deadline = d; }
  const task = await StorageRepository.createTask({
    title: body.title,
    owner: body.owner || 'Founder',
    status: body.status || 'PENDING',
    deadline,
    source: body.source || 'WHATSAPP',
    sourceId: body.sourceId || null,
  });
  broadcastLive(c, LiveEvent.Tasks);
  return c.json({ ok: true, id: task.id });
});

app.post('/api/runner/pending-items', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { StorageRepository } = deps();
  const body = await c.req.json().catch(() => ({}));
  if (!body.chatId || !body.description) return c.json({ error: 'chatId + description required' }, 400);
  let dueDate: Date | null = null;
  if (body.dueDate) { const d = new Date(body.dueDate); if (!isNaN(d.getTime())) dueDate = d; }
  const item = await StorageRepository.createChatPendingItem({
    chatId: body.chatId,
    chatName: body.chatName || body.chatId,
    description: body.description,
    dueDate,
  });
  broadcastLive(c, LiveEvent.PendingItems, { chatId: body.chatId });
  return c.json({ ok: true, id: item.id });
});

app.post('/api/runner/messages/mark-processed', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { StorageRepository } = deps();
  const body = await c.req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  if (!ids.length) return c.json({ ok: true, count: 0 });
  await StorageRepository.markMessagesProcessed(ids);
  broadcastLive(c, LiveEvent.Messages, { count: ids.length });
  return c.json({ ok: true, count: ids.length });
});

// ── morning-brief / eod-summary runner ───────────────────────────────────────
app.get('/api/runner/brief-data', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { StorageRepository, prisma } = deps();
  const [digests, tasks, pendingItems, emails, estimates] = await Promise.all([
    StorageRepository.fetchDigests(15),
    StorageRepository.fetchTasks(),
    StorageRepository.fetchOpenChatPendingItems(),
    StorageRepository.fetchUnprocessedEmails(),
    prisma.estimate.findMany({ where: { status: 'sent' }, include: { classification: true } }),
  ]);
  return c.json({ digests, tasks, pendingItems, emails, estimates });
});

app.post('/api/runner/founder-notes', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { StorageRepository } = deps();
  const body = await c.req.json().catch(() => ({}));
  if (!body.content) return c.json({ error: 'content required' }, 400);
  const note = await StorageRepository.saveFounderNote(String(body.content));
  broadcastLive(c, LiveEvent.FounderNotes);
  return c.json({ ok: true, id: note.id, createdAt: note.createdAt });
});

// ── zoho-sent-analyzer runner ────────────────────────────────────────────────
app.get('/api/runner/zoho/state', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const [estimates, maxComments, lastCompleteSync] = await Promise.all([
    prisma.estimate.findMany({ include: { classification: true } }),
    prisma.comment.groupBy({ by: ['estimateId'], _max: { commentId: true } }),
    prisma.setting.findUnique({ where: { key: 'sales_copilot:last_complete_sync_at' } }),
  ]);
  const maxCommentIdByEstimate: Record<string, string> = {};
  for (const row of maxComments) {
    maxCommentIdByEstimate[row.estimateId] = (row._max.commentId as string) || '';
  }
  return c.json({
    estimates,
    maxCommentIdByEstimate,
    lastCompleteSyncAt: lastCompleteSync?.value || null,
  });
});

app.post('/api/runner/zoho/comments', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const body = await c.req.json().catch(() => ({}));
  const comments = Array.isArray(body.comments) ? body.comments : [];
  let upserted = 0;
  for (const cm of comments) {
    if (!cm.commentId) continue;
    await prisma.comment.upsert({
      where: { commentId: cm.commentId },
      update: {
        estimateId: cm.estimateId,
        description: cm.description || '',
        commentedBy: cm.commentedBy || '',
        date: cm.date || '',
        dateDescription: cm.dateDescription || '',
        dateFormatted: cm.dateFormatted || null,
      },
      create: {
        commentId: cm.commentId,
        estimateId: cm.estimateId,
        description: cm.description || '',
        commentedBy: cm.commentedBy || '',
        date: cm.date || '',
        dateDescription: cm.dateDescription || '',
        dateFormatted: cm.dateFormatted || null,
      },
    });
    upserted++;
  }
  notifyLive(c, { type: 'estimates' });
  return c.json({ ok: true, count: upserted });
});

app.post('/api/runner/zoho/status', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const body = await c.req.json().catch(() => ({}));
  const updates = Array.isArray(body.updates) ? body.updates : [];
  let updated = 0;
  for (const u of updates) {
    if (!u.estimateId || !u.status) continue;
    await prisma.estimate.update({
      where: { estimateId: u.estimateId },
      data: { status: u.status, lastSyncTime: new Date() },
    });
    updated++;
  }
  notifyLive(c, { type: 'estimates' });
  return c.json({ ok: true, count: updated });
});

app.post('/api/runner/zoho/classification', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const body = await c.req.json().catch(() => ({}));
  const { estimateId, classification } = body;
  if (!estimateId || !classification) return c.json({ error: 'estimateId + classification required' }, 400);
  const now = new Date();
  const toYN = (v: unknown) => (v === 'Yes' || v === 'yes' || v === true ? 'Yes' : 'No');
  await prisma.classification.upsert({
    where: { estimateId },
    update: {
      meaningfulUpdate: !!classification.meaningfulUpdate,
      notAnswering: toYN(classification.notAnswering),
      movingSlow: toYN(classification.movingSlow),
      underDiscussion: toYN(classification.underDiscussion),
      confirm: toYN(classification.confirm),
      intentScore: classification.intentScore ?? 2,
      reasoning: classification.reasoning || '',
      summary: classification.summary || '',
      salesAgent: (classification.salesAgent || 'Unassigned').trim(),
      processedAt: now,
    },
    create: {
      estimateId,
      meaningfulUpdate: !!classification.meaningfulUpdate,
      notAnswering: toYN(classification.notAnswering),
      movingSlow: toYN(classification.movingSlow),
      underDiscussion: toYN(classification.underDiscussion),
      confirm: toYN(classification.confirm),
      intentScore: classification.intentScore ?? 2,
      reasoning: classification.reasoning || '',
      summary: classification.summary || '',
      salesAgent: (classification.salesAgent || 'Unassigned').trim(),
      processedAt: now,
    },
  });
  await prisma.estimate.update({ where: { estimateId }, data: { lastSyncTime: now } });
  notifyLive(c, { type: 'estimates' });
  return c.json({ ok: true });
});

// ── email-brain-index runner ─────────────────────────────────────────────────
app.post('/api/runner/emails', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { StorageRepository } = deps();
  const body = await c.req.json().catch(() => ({}));
  const emails = Array.isArray(body.emails) ? body.emails : [];
  let saved = 0;
  for (const e of emails) {
    if (!e.subject || !e.sender || !e.body) continue;
    await StorageRepository.storeEmail({ subject: e.subject, sender: e.sender, body: e.body });
    saved++;
  }
  if (saved > 0) broadcastLive(c, LiveEvent.Email);
  return c.json({ ok: true, count: saved });
});

app.get('/api/runner/brain/sources', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [messages, emails, digests, estimates, tasks] = await Promise.all([
    prisma.message.findMany({ where: { timestamp: { gte: cutoff } }, orderBy: { timestamp: 'desc' }, take: 500 }),
    prisma.email.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }),
    prisma.digest.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }),
    prisma.estimate.findMany({ include: { comments: true, classification: true }, orderBy: { lastSyncTime: 'desc' }, take: 500 }),
    prisma.task.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }),
  ]);
  return c.json({ messages, emails, digests, estimates, tasks });
});

app.post('/api/runner/brain/context', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const body = await c.req.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  let upserted = 0;
  for (const row of rows) {
    if (!row.source || !row.sourceId || !row.content) continue;
    await prisma.brainContext.upsert({
      where: { source_sourceId: { source: row.source, sourceId: row.sourceId } },
      update: {
        entityName: row.entityName || null,
        content: row.content,
        metadata: row.metadata || null,
        eventDate: row.eventDate ? new Date(row.eventDate) : new Date(),
        indexedAt: new Date(),
      },
      create: {
        source: row.source,
        sourceId: row.sourceId,
        entityName: row.entityName || null,
        content: row.content,
        metadata: row.metadata || null,
        eventDate: row.eventDate ? new Date(row.eventDate) : new Date(),
        indexedAt: new Date(),
      },
    });
    upserted++;
  }
  if (upserted > 0) broadcastLive(c, LiveEvent.Brain);
  return c.json({ ok: true, count: upserted });
});

// ── whatsapp-autopilot runner (GH Actions heavy loop; shadow mode) ───────────
// Thin D1 reads/writes for scripts/whatsapp-autopilot-runner.js: the runner
// owns association + transition LLM logic; this only stores state. All writes
// broadcast a live `autopilot` event so the dashboard refreshes instantly.

const AUTOPILOT_TASK_STATUSES = ['open', 'waiting', 'needs_clarification', 'needs_review', 'completed', 'cancelled'];
const AUTOPILOT_OPEN_STATUSES = ['open', 'waiting', 'needs_clarification', 'needs_review'];
// §4.10 create-dedupe window: an identical (chat, item) open task created this
// recently means two lanes raced on the same request — treat as Update instead.
const AUTOPILOT_CREATE_DEDUPE_MS = 120_000;

function autopilotTaskJson(t: any) {
  return {
    id: t.id, chatId: t.chatId, chatName: t.chatName, taskType: t.taskType,
    item: t.item, status: t.status, priority: t.priority, assignedTo: t.assignedTo,
    rootMessageId: t.rootMessageId, summary: t.summary, version: t.version,
    lastInboundAt: t.lastInboundAt, lastOutboundAt: t.lastOutboundAt,
    waitingSince: t.waitingSince, waitTimeoutAt: t.waitTimeoutAt,
    followUpDueAt: t.followUpDueAt, followUpCount: t.followUpCount,
    createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

app.get('/api/runner/autopilot/inbox', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const contextMessages = Math.min(Number(c.req.query('context')) || 15, 50);
  // Watermark-based, NOT the digest pipeline's processed flag: the autopilot
  // loop must be able to see every message (even ones the digest runner
  // already marked processed) without racing it for the same rows.
  const sinceRaw = c.req.query('since');
  const since = sinceRaw ? new Date(sinceRaw) : null;
  const [messages, tasks] = await Promise.all([
    prisma.message.findMany({
      where: since && !isNaN(since.getTime()) ? { timestamp: { gt: since } } : {},
      orderBy: { timestamp: 'asc' },
      take: 200,
    }),
    prisma.waTask.findMany({
      where: { status: { in: AUTOPILOT_OPEN_STATUSES } },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
  ]);
  // Recent per-chat transcript for LLM context (only for chats in this batch).
  const chatIdSet = new Set<string>();
  for (const m of messages as any[]) chatIdSet.add(String(m.chatId));
  const chatIds = [...chatIdSet];
  const recentByChat: Record<string, any[]> = {};
  await Promise.all(chatIds.map(async (chatId) => {
    const rows = await prisma.message.findMany({
      where: { chatId },
      orderBy: { timestamp: 'desc' },
      take: contextMessages,
    });
    recentByChat[chatId] = rows.reverse().map((m: any) => ({
      sender: m.sender, body: m.body, timestamp: m.timestamp,
    }));
  }));
  return c.json({
    messages: messages.map((m: any) => ({
      id: m.id, chatId: m.chatId, sender: m.sender, body: m.body,
      timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
      wahaMessageId: m.wahaMessageId, quotedMessageId: m.quotedMessageId,
      quotedBody: m.quotedBody, classification: m.classification,
    })),
    tasks: tasks.map(autopilotTaskJson),
    recentByChat,
  });
});

app.get('/api/runner/autopilot/lineage-lookup', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const ids = (c.req.query('ids') || '').split(',').map((s: string) => s.trim()).filter(Boolean).slice(0, 100);
  if (!ids.length) return c.json({ byId: {} });
  const rows = await prisma.messageLineage.findMany({ where: { waMessageId: { in: ids } } });
  const byId: Record<string, unknown> = {};
  for (const r of rows) {
    byId[r.waMessageId] = { taskId: r.taskId, rootWaMessageId: r.rootWaMessageId, resolutionStatus: r.resolutionStatus };
  }
  return c.json({ byId });
});

app.post('/api/runner/autopilot/lineage', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const body = await c.req.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  let upserted = 0;
  for (const r of rows) {
    if (!r.waMessageId) continue;
    await prisma.messageLineage.upsert({
      where: { waMessageId: String(r.waMessageId) },
      update: {
        parentWaMessageId: r.parentWaMessageId ?? null,
        rootWaMessageId: r.rootWaMessageId ?? null,
        taskId: r.taskId ?? null,
        associationMethod: r.associationMethod || 'llm',
        confidence: typeof r.confidence === 'number' ? r.confidence : null,
        resolutionStatus: r.resolutionStatus || 'resolved',
      },
      create: {
        waMessageId: String(r.waMessageId),
        parentWaMessageId: r.parentWaMessageId ?? null,
        rootWaMessageId: r.rootWaMessageId ?? null,
        taskId: r.taskId ?? null,
        associationMethod: r.associationMethod || 'llm',
        confidence: typeof r.confidence === 'number' ? r.confidence : null,
        resolutionStatus: r.resolutionStatus || 'resolved',
      },
    });
    upserted++;
  }
  return c.json({ ok: true, count: upserted });
});

app.get('/api/runner/autopilot/watermark', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const row = await prisma.setting.findUnique({ where: { key: 'autopilot:message_watermark' } });
  return c.json({ watermark: row?.value || null });
});

app.post('/api/runner/autopilot/watermark', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const body = await c.req.json().catch(() => ({}));
  if (!body.watermark) return c.json({ error: 'watermark required' }, 400);
  await prisma.setting.upsert({
    where: { key: 'autopilot:message_watermark' },
    update: { value: String(body.watermark) },
    create: { key: 'autopilot:message_watermark', value: String(body.watermark) },
  });
  return c.json({ ok: true });
});

app.post('/api/runner/autopilot/tasks/create', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const body = await c.req.json().catch(() => ({}));
  if (!body.chatId) return c.json({ error: 'chatId required' }, 400);
  const item = body.item ? String(body.item) : null;
  // Create-dedupe window (§4.10): same chat + same open item within the window
  // → return the existing task instead of duplicating it.
  if (item) {
    const cutoff = new Date(Date.now() - AUTOPILOT_CREATE_DEDUPE_MS);
    const dupe = await prisma.waTask.findFirst({
      where: { chatId: body.chatId, item, status: { in: ['open', 'waiting'] }, createdAt: { gte: cutoff } },
      orderBy: { createdAt: 'desc' },
    });
    if (dupe) return c.json({ ok: true, deduped: true, task: autopilotTaskJson(dupe) });
  }
  const now = new Date();
  const task = await prisma.waTask.create({
    data: {
      chatId: String(body.chatId),
      chatName: body.chatName ? String(body.chatName) : String(body.chatId),
      taskType: body.taskType ? String(body.taskType) : 'general',
      item,
      status: 'open',
      priority: body.priority ? String(body.priority) : null,
      summary: body.summary ? String(body.summary) : null,
      rootMessageId: body.rootWaMessageId ? String(body.rootWaMessageId) : null,
      version: 1,
      lastInboundAt: now,
    },
  });
  await prisma.waTaskHistory.create({
    data: {
      taskId: task.id,
      transition: 'create',
      triggeredBy: body.triggeredBy || 'llm',
      messageId: body.wahaMessageId ? String(body.wahaMessageId) : null,
      notes: body.notes ? String(body.notes) : null,
      confidence: typeof body.confidence === 'number' ? body.confidence : null,
    },
  });
  broadcastLive(c, LiveEvent.Autopilot, { chatId: task.chatId });
  return c.json({ ok: true, task: autopilotTaskJson(task) });
});

app.post('/api/runner/autopilot/tasks/transition', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const body = await c.req.json().catch(() => ({}));
  const { taskId, expectedVersion, transition } = body;
  if (!taskId || !transition || typeof expectedVersion !== 'number') {
    return c.json({ error: 'taskId + expectedVersion + transition required' }, 400);
  }
  if (!AUTOPILOT_TASK_STATUSES.includes(String(body.status || '')) && !['update', 'action'].includes(String(transition))) {
    return c.json({ error: `invalid status '${body.status}'` }, 400);
  }
  const data: Record<string, unknown> = { version: expectedVersion + 1 };
  if (body.status) data.status = String(body.status);
  if (body.item !== undefined) data.item = body.item ? String(body.item) : null;
  if (body.summary !== undefined) data.summary = body.summary ? String(body.summary) : null;
  if (body.priority !== undefined) data.priority = body.priority ? String(body.priority) : null;
  if (body.waitingSince !== undefined) data.waitingSince = body.waitingSince ? new Date(body.waitingSince) : null;
  if (body.waitTimeoutAt !== undefined) data.waitTimeoutAt = body.waitTimeoutAt ? new Date(body.waitTimeoutAt) : null;
  if (body.followUpDueAt !== undefined) data.followUpDueAt = body.followUpDueAt ? new Date(body.followUpDueAt) : null;
  if (body.clearFollowUp) { data.followUpDueAt = null; }
  if (body.inboundAt) data.lastInboundAt = new Date(body.inboundAt);
  if (body.outboundAt) data.lastOutboundAt = new Date(body.outboundAt);
  // Optimistic concurrency (§4.10): updateMany so we can condition on version.
  const res = await prisma.waTask.updateMany({
    where: { id: String(taskId), version: expectedVersion },
    data,
  });
  if (res.count === 0) {
    const fresh = await prisma.waTask.findUnique({ where: { id: String(taskId) } });
    return c.json(
      { error: 'version_conflict', message: 'task changed underneath — re-run against fresh state', task: fresh ? autopilotTaskJson(fresh) : null },
      409,
    );
  }
  await prisma.waTaskHistory.create({
    data: {
      taskId: String(taskId),
      transition: String(transition),
      triggeredBy: body.triggeredBy || 'llm',
      messageId: body.wahaMessageId ? String(body.wahaMessageId) : null,
      notes: body.notes ? String(body.notes) : null,
      confidence: typeof body.confidence === 'number' ? body.confidence : null,
    },
  });
  const updated = await prisma.waTask.findUnique({ where: { id: String(taskId) } });
  broadcastLive(c, LiveEvent.Autopilot, { taskId: String(taskId), transition: String(transition) });
  return c.json({ ok: true, task: updated ? autopilotTaskJson(updated) : null });
});

app.post('/api/runner/autopilot/actions', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const body = await c.req.json().catch(() => ({}));
  const actions = Array.isArray(body.actions) ? body.actions : [];
  let created = 0;
  for (const a of actions) {
    if (!a.toolName) continue;
    await prisma.waAction.create({
      data: {
        taskId: a.taskId ? String(a.taskId) : null,
        toolName: String(a.toolName),
        inputJson: a.input !== undefined ? JSON.stringify(a.input) : (typeof a.inputJson === 'string' ? a.inputJson : null),
        status: 'pending',
        requestedBy: a.requestedBy || 'llm',
        reason: a.reason ? String(a.reason) : null,
      },
    });
    created++;
  }
  if (created > 0) broadcastLive(c, LiveEvent.Autopilot, { actions: created });
  return c.json({ ok: true, count: created });
});

app.get('/api/runner/autopilot/followups', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const now = new Date();
  const silenceDays = Math.min(Number(c.req.query('autoCloseDays')) || 7, 30);
  const autoCloseCutoff = new Date(now.getTime() - silenceDays * 24 * 60 * 60 * 1000);
  const [dueFollowUps, waitTimeouts, staleOpen] = await Promise.all([
    prisma.waTask.findMany({
      where: { status: { in: ['open', 'waiting'] }, followUpDueAt: { lte: now } },
      orderBy: { followUpDueAt: 'asc' }, take: 100,
    }),
    prisma.waTask.findMany({
      where: { status: 'waiting', waitTimeoutAt: { lte: now } },
      orderBy: { waitTimeoutAt: 'asc' }, take: 100,
    }),
    prisma.waTask.findMany({
      where: { status: { in: AUTOPILOT_OPEN_STATUSES }, lastInboundAt: { lt: autoCloseCutoff }, createdAt: { lt: autoCloseCutoff } },
      orderBy: { createdAt: 'asc' }, take: 100,
    }),
  ]);
  return c.json({
    dueFollowUps: dueFollowUps.map(autopilotTaskJson),
    waitTimeouts: waitTimeouts.map(autopilotTaskJson),
    autoCloses: staleOpen.map(autopilotTaskJson),
  });
});

// Contact names are not part of waengine webhooks, so rows start as the
// generic 'Client'. This pulls real display names from the conversations
// API and backfills them (only where still placeholder).
app.post('/api/runner/autopilot/sync-contacts', async (c) => {
  if (!requireSecret(c)) return c.text('Unauthorized', 401);
  const { prisma } = deps();
  const env = c.env as { WA_ENGINE_API_KEY?: string };
  if (!env.WA_ENGINE_API_KEY) return c.json({ error: 'WA_ENGINE_API_KEY not configured' }, 500);
  const placeholders = new Set(['', 'Client']);
  let scanned = 0;
  let updated = 0;
  for (let page = 1; page <= 20; page++) {
    let convs: any[];
    try {
      const res = await fetch(`https://waengine.pro/api/v1/conversations?page=${page}&limit=100`, {
        headers: { 'X-API-Key': env.WA_ENGINE_API_KEY },
      });
      if (!res.ok) break;
      const json: any = await res.json();
      convs = Array.isArray(json?.data) ? json.data : [];
    } catch {
      break;
    }
    if (!convs.length) break;
    for (const conv of convs) {
      const phone = String(conv?.contact?.phone || '').replace(/\D/g, '');
      const name = String(conv?.contact?.name || '').trim();
      if (!phone || !name || placeholders.has(name)) continue;
      scanned++;
      try {
        const r = await (prisma as any).contact.updateMany({
          where: { chatId: `${phone}@c.us`, name: { in: ['Client', ''] } },
          data: { name },
        });
        updated += Number(r?.count) || 0;
      } catch { /* skip bad row */ }
    }
    if (convs.length < 100) break;
  }
  return c.json({ ok: true, scanned, updated });
});


// ── whatsapp-autopilot human review API (dashboard, session-gated) ───────────

app.post('/api/autopilot/tasks/:id/review', async (c) => {
  const { prisma } = deps();
  const taskId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const resolution = String(body.resolution || '');
  const VALID = ['open', 'waiting', 'needs_clarification', 'completed', 'cancelled'];
  if (!VALID.includes(resolution)) return c.json({ error: `resolution must be one of ${VALID.join('|')}` }, 400);
  const task = await prisma.waTask.findUnique({ where: { id: taskId } });
  if (!task) return c.json({ error: 'task not found' }, 404);
  const reviewer = body.reviewer || 'founder';
  const res = await prisma.waTask.updateMany({
    where: { id: taskId, version: task.version },
    data: { version: task.version + 1, status: resolution },
  });
  if (res.count === 0) return c.json({ error: 'version_conflict' }, 409);
  const wasAuto = task.status === 'needs_review';
  await prisma.$transaction([
    prisma.waTaskHistory.create({
      data: {
        taskId,
        transition: resolution === 'completed' ? 'complete' : resolution === 'cancelled' ? 'update' : 'update',
        triggeredBy: 'human',
        notes: `[review:${resolution}] ${body.notes || ''}`.trim(),
      },
    }),
    ...(wasAuto ? [prisma.overrideLog.create({
      data: {
        taskId,
        decisionType: 'transition',
        systemDecision: `review:${task.status}`,
        systemConfidence: null,
        humanDecision: resolution,
        reviewer,
      },
    })] : []),
  ]);
  broadcastLive(c, LiveEvent.Autopilot, { taskId, review: resolution });
  return c.json({ ok: true });
});

app.post('/api/autopilot/actions/:id/decide', async (c) => {
  const { prisma } = deps();
  const actionId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const decision = String(body.decision || '');
  const VALID = ['approve', 'reject', 'execute_manual'];
  if (!VALID.includes(decision)) return c.json({ error: `decision must be one of ${VALID.join('|')}` }, 400);
  const action = await prisma.waAction.findUnique({ where: { id: actionId } });
  if (!action) return c.json({ error: 'action not found' }, 404);
  const statusMap: Record<string, string> = { approve: 'approved', reject: 'rejected', execute_manual: 'executed_manual' };
  await prisma.waAction.update({
    where: { id: actionId },
    data: {
      status: statusMap[decision],
      executedAt: decision === 'execute_manual' ? new Date() : null,
      outputJson: body.notes ? JSON.stringify({ notes: body.notes }) : action.outputJson,
    },
  });
  if (action.taskId) {
    await prisma.waTaskHistory.create({
      data: {
        taskId: action.taskId,
        transition: 'action',
        triggeredBy: 'human',
        notes: `[${decision}] ${action.toolName}${body.notes ? `: ${body.notes}` : ''}`.trim(),
      },
    });
  }
  broadcastLive(c, LiveEvent.Autopilot, { actionId, decision });
  return c.json({ ok: true });
});

// ── Automation admin API ────────────────────────────────────────────────────
function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

app.get('/api/automations', async (c) => {
  const { prisma, AutomationEngine } = deps();
  const rows = await prisma.automation.findMany({ orderBy: { createdAt: 'asc' } });
  // Deterministic dashboard capability: static slugs the frontend renders
  // (Automations.tsx renderDashboard) + engine modules exposing a `data` fn.
  // Independent of per-isolate boot state so the button never flickers.
  const DASHBOARD_SLUGS = new Set([
    'zoho-sent-analyzer', 'dpp-prices-dashboard', 'wa-engine-monitor',
    'whatsapp-marketing', 'enterprise-operations-analytics', 'telecalling-agent-analysis',
    'whatsapp-autopilot',
  ]);
  const withDashboard = new Set([
    ...DASHBOARD_SLUGS,
    ...AutomationEngine.all().filter((e: any) => typeof e.module?.data === 'function').map((e: any) => e.def.id),
  ]);
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

// ── Native cron triggers (wrangler.toml [triggers]) ──────────────────────────
// Every 10 min: refresh today's NeoDove USER_REPORT snapshot. This replaces
// the GH Actions 10-min workflow whose egress IPs are blocked by NeoDove.
const scheduled: ExportedHandlerScheduledHandler<Bindings, unknown> = async (event, env, ctx) => {
  bootstrapEnv(env);
  try {
    const r = await refreshNeodoveReport(neodoveTodayIst(0));
    console.log(`[cron] neodove-refresh ${r.reportDate}: ok=${r.ok} stored=${r.stored} ${r.error ?? ''}`);
  } catch (e: any) {
    console.error('[cron] neodove-refresh failed:', e?.message);
  }
};

export default {
  fetch: app.fetch,
  scheduled,
};
export { EventHub, AsyncTaskRunner };

// ── Live events (WebSocket fan-out via EventHub Durable Object) ──────────────
// Fire-and-forget broadcast; never blocks or fails the calling write path.
function notifyLive(c: any, event: Record<string, unknown>) {
  broadcastLive(c, String(event.type ?? 'automation'), event);
}

app.get('/api/events', (c) => {
  const ns = c.env.EVENT_HUB;
  if (!ns) return c.text('EVENT_HUB not bound', 500);
  const stub = ns.get(ns.idFromName('global'));
  return stub.fetch(new Request('https://hub/stream', c.req.raw));
});