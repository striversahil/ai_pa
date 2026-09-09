// ─────────────────────────────────────────────────────────────────────────────
// worker/context.ts — shared context for every route module + cron.
//
// Centralises the pieces worker.ts used to define inline: the Bindings type,
// env bootstrap, lazy deps(), boot logic, auth/scope guards, cache middleware
// and the small per-domain helper functions (chat/enquiry send, mis guard,
// live broadcast, waengine media enrichment, csv/lead parsing, …). Route
// modules import only what they need from here.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { broadcastLive, LiveEvent, hasLiveBroadcasted } from '../live';
import * as AuthRoutes from '../modules/auth/routes';
import { createAuthStore } from '../modules/auth/store';
import { authEnabled, getMe, isApproved, requireScope } from '../modules/auth/service';
import { AuthError } from '../modules/auth/types';
import { readSessionCookie } from '../modules/auth/session';
import { createChatStore, resolveLinkedSender } from '../modules/chat/store';
import * as ChatRoutes from '../modules/chat/routes';
import { createEnquiryStore } from '../modules/enquiries/store';
import * as EnquiryRoutes from '../modules/enquiries/routes';
import { extractEnquiryFieldsRobust } from '../modules/enquiries/extract';
import { DASHBOARD_SLUGS } from '../modules/automation/dashboardSlugs';
import { refreshNeodoveReport, istDateStr as neodoveTodayIst } from '../automations/neodove-refresh';
import { isSystemGeneratedComment } from '../shared/systemComment';
import { getEstimatesPayload } from '../shared/estimates-cache';

export type Bindings = {
  DB: D1Database;
  CHAT_FILES?: KVNamespace;
  CACHE_KV?: KVNamespace;
  EVENT_HUB?: DurableObjectNamespace;
  ASYNC_RUNNER?: DurableObjectNamespace;
  CHAT_ROOM?: DurableObjectNamespace;
  SHARED_SECRET?: string;
  WA_ENGINE_API_KEY?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  ZOHO_BOOKS_SENT_URL?: string;
  ZOHO_BOOKS_AUTH_TOKEN?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GROQ_API_KEYS?: string;
  GITHUB_ACCESS_TOKEN?: string;
  [key: string]: unknown;
};

// ── Env bootstrap (must run before any module import is exercised) ──────────
export function bootstrapEnv(env: Bindings) {
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
  const { initD1 } = require('../shared/prisma-d1');
  initD1(env);
  const { initCache } = require('../shared/cache');
  initCache(env);
}

// Lazily require modules after bootstrap so config/prisma read the right globals.
export const deps = () => {
  const { prisma } = require('../shared/prisma-d1');
  const { StorageRepository } = require('../modules/storage/repository');
  const { WhatsAppService } = require('../modules/whatsapp/service');
  const { DigestService } = require('../modules/digest/service');
  const { TasksService } = require('../modules/tasks/service');
  const { AIService } = require('../modules/ai/service');
  const { BrainService } = require('../modules/brain/service');
  const { AuditService } = require('../modules/audit/service');
  const { GoogleSheetsService } = require('../modules/google_sheets/service-worker');
  const { SalesCopilotService } = require('../automations/zoho-sent-analyzer/service');
  const { OutboundService } = require('../modules/whatsapp/outbound');
  const { MessageQueueService } = require('../modules/queue/service-worker');
  const { AutomationEngine } = require('../modules/automation/engine');
  const { processMessagesToDigests } = require('../automations/whatsapp-digest/process');
  const { SchedulerService } = require('../modules/scheduler/service-worker');
  const { AutomationRegistry } = require('../modules/automation/registry-worker');
  const { isSystemGeneratedComment } = require('../shared/systemComment');
  const { WhatsAppController } = require('../modules/whatsapp/controller-worker');
  const { executeCampaign, getCampaignStats, normalizePhone } = require('../automations/whatsapp-marketing/service');
  const { broadcastWhatsAppEvent } = require('../shared/sse-worker');
  const { EngineRegistry } = require('../shared/engine');
  const { WhatsappEngine } = require('../modules/whatsapp/engine');
  const { EmailEngine } = require('../modules/email/engine');
  return {
    prisma, StorageRepository, WhatsAppService, DigestService, TasksService, AIService,
    BrainService, AuditService, GoogleSheetsService, SalesCopilotService, OutboundService,
    MessageQueueService, AutomationEngine, processMessagesToDigests, SchedulerService,
    AutomationRegistry, isSystemGeneratedComment, WhatsAppController, executeCampaign,
    getCampaignStats, normalizePhone, broadcastWhatsAppEvent, EngineRegistry, WhatsappEngine,
    EmailEngine,
  };
};

// ── Boot: register engines + load automations on first request ─────────────
// MUST be registered before any route so AutomationEngine is populated before
// handlers (e.g. /api/automations/:slug/data) run.
// Only automation-management routes wait for full boot; every other endpoint
// proceeds immediately. A failed/hung init is RETRYABLE by the next request.
export const BOOT_PATH_RE = /^\/api\/(trigger|automations|status|health)(\/|$)/;
const BOOT_TIMEOUT_MS = 20000;
const BOOT_WAIT_MS = 15000;
const BOOT_MAX_ATTEMPTS = 5;
let bootAttempts = 0;
let bootSucceeded = false;
let bootPromise: Promise<void> | null = null;

export function ensureBoot(): Promise<void> {
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

export function bootStatus(): { attempts: number; automationsLoaded: number; healthy: boolean } {
  try {
    const loaded = (deps().AutomationEngine.all() as unknown[]).length;
    return { attempts: bootAttempts, automationsLoaded: loaded, healthy: loaded > 0 };
  } catch {
    return { attempts: bootAttempts, automationsLoaded: 0, healthy: false };
  }
}

export function resetBootAttemptsIfEmpty(): void {
  if (bootAttempts >= BOOT_MAX_ATTEMPTS) {
    try {
      if ((deps().AutomationEngine.all() as unknown[]).length === 0) bootAttempts = 0;
    } catch { /* deps not ready yet */ }
  }
}

export function shouldTriggerBoot(): boolean {
  return bootAttempts < BOOT_MAX_ATTEMPTS;
}

// Self-heal: if this isolate's registry is missing a slug, force one synchronous
// registry reload and retry. load() is idempotent (D1 upserts + map overwrite).
export async function getEntryOrReload(slug: string) {
  const { AutomationEngine, AutomationRegistry } = deps();
  const existing = AutomationEngine.get(slug);
  if (existing) return existing;
  try {
    await AutomationRegistry.load();
    console.log(`Registry self-heal: reloaded automations for missing slug '${slug}'`);
  } catch (e: any) {
    console.log(`Registry self-heal reload failed for '${slug}':`, e?.message);
  }
  return AutomationEngine.get(slug);
}

// ── Google auth: routes + login gate (Worker = live runtime) ─────────────────
export function authStore(c: any) {
  return createAuthStore(c.env);
}
export function publicOrigin(c: any): string {
  return (c.env.AUTH_PUBLIC_ORIGIN as string) || new URL(c.req.url).origin;
}
export function isSecure(c: any): boolean {
  return new URL(c.req.url).protocol === 'https:';
}
export const AUTH_EXEMPT = [
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
  // These endpoints already enforce requireSecret() in their handlers.
  '/api/token/',
  '/api/estimates/bulk-upsert',
  '/api/neodove/report',
];
export function isAuthExempt(path: string): boolean {
  return AUTH_EXEMPT.some((p) => path.startsWith(p));
}

// ── Live broadcast helpers ──────────────────────────────────────────────────
export { broadcastLive, LiveEvent };

/** Fire-and-forget live event; never blocks or fails the calling write path. */
export function notifyLive(c: any, event: Record<string, unknown>) {
  broadcastLive(c, String(event.type ?? 'automation'), event);
}

// ── Scope/secret guards ─────────────────────────────────────────────────────
export function requireSecret(c: any): boolean {
  const auth = c.req.header('Authorization') || '';
  const provided = auth.replace(/^Bearer\s+/i, '');
  const expected = c.env.SHARED_SECRET;
  if (!expected) return true; // secret not set → open (dev)
  return provided === expected;
}

export async function requireMisScope(c: any): Promise<void> {
  await requireScope(authStore(c), c.req.header('cookie') ?? null, 'mis');
}

export function misScopeError(c: any, e: unknown) {
  if (e instanceof AuthError) return c.json({ error: e.message }, (e as any).status ?? 403);
  throw e;
}

export function isAuthorized(c: any): boolean {
  const auth = c.req.header('Authorization') || '';
  return auth === `Bearer ${c.env.SHARED_SECRET}`;
}

// ── Team chat (Discord-style channels) ──────────────────────────────────────
export async function chatMe(c: any) {
  return getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
}
export function chatSend(c: any, r: any) {
  if (r.live) broadcastLive(c, r.live.type, r.live.extra);
}

// ── Enquiry tracker (live sales pipeline) ───────────────────────────────────
export async function enquiryMe(c: any) {
  return getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
}
export function enquirySend(c: any, r: any) {
  if (r.live) broadcastLive(c, r.live.type, r.live.extra);
}

// Real-time LLM extraction: after an enquiry is created/edited (and after its
// first 1–2 comments are added — the agent writes the lead-details block in
// the first comment), parse the text into structured fields
// (title/enquiryNumber/sourceLead/location/company/contact). The client's
// wording is NEVER rewritten, and the agent ("Lead of") is NOT inferred here —
// it is set to the enquiry's creator at creation time.
export function runEnquiryExtraction(c: any, enquiryId: string) {
  const work = async () => {
    try {
      const store = createEnquiryStore(c.env);
      const enquiry = await store.getEnquiry(enquiryId);
      if (!enquiry) return;
      // Extraction source: the description PLUS the first two comments (the
      // agent is told to write the lead-details block in comment #1/#2).
      let comments: any[] = [];
      try { comments = await store.listComments(enquiryId); } catch { /* ignore */ }
      const firstComments = (comments || [])
        .slice(0, 2)
        .map((cm: any) => `${cm.content ?? ''}`)
        .join('\n');
      const text = [enquiry.description, firstComments].filter(Boolean).join('\n');
      const extracted = await extractEnquiryFieldsRobust(c.env, {
        text,
        title: enquiry.title,
        company: enquiry.clientCompany,
      });
      if (!extracted) return;
      const updates: Record<string, string> = {};
      if (!enquiry.title && extracted.title) updates.title = extracted.title;
      if (!enquiry.enquiryNumber && extracted.enquiryNumber) updates.enquiryNumber = extracted.enquiryNumber;
      if (!enquiry.sourceLead && extracted.sourceLead) updates.sourceLead = extracted.sourceLead;
      if (!enquiry.location && extracted.location) updates.location = extracted.location;
      if (!enquiry.clientCompany && extracted.company) updates.clientCompany = extracted.company;
      if (!enquiry.contactName && extracted.contactName) updates.contactName = extracted.contactName;
      if (!enquiry.contactEmail && extracted.contactEmail) updates.contactEmail = extracted.contactEmail;
      if (!enquiry.contactPhone && extracted.contactPhone) updates.contactPhone = extracted.contactPhone;
      if (Object.keys(updates).length === 0) return;
      const saved = await store.updateEnquiry(enquiryId, updates);
      if (saved) {
        broadcastLive(c, LiveEvent.Enquiries, { action: 'updated', enquiry: saved });
        console.log(`enquiry extraction: filled ${Object.keys(updates).join(', ')} for ${enquiryId}`);
      }
    } catch (e: any) {
      console.log('enquiry extraction failed:', e?.message);
    }
  };
  if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') c.executionCtx.waitUntil(work());
  else void work();
}

// ── Chat file attachments (Workers KV) ──────────────────────────────────────
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // KV allows 25MB; keep headroom

// ── waengine.pro media enrichment ───────────────────────────────────────────
export const MEDIA_ENRICH_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);
export const MEDIA_MATCH_TOLERANCE_MS = 10 * 60 * 1000;
const convCache = new Map<string, { msgs: any[]; at: number }>();

export async function enrichWaEngineMedia(normalized: any, env: any): Promise<void> {
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

// ── Baseline snapshot (frozen daily at 1 AM IST) ────────────────────────────
export function kolkataDateStr(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now).slice(0, 10);
}

// ── WhatsApp chatId validation ──────────────────────────────────────────────
export function validateChatId(chatId: string): string | null {
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

// ── App factory (middleware + boot + auth gate) ─────────────────────────────
export function createApp(): Hono<{ Bindings: Bindings }> {
  const app = new Hono<{ Bindings: Bindings }>();
  app.use('*', cors());

  // Edge/browser response caching.
  const PUBLIC_CACHE_PATHS = ['/api/status', '/api/health', '/health'];
  const PRIVATE_CACHE_PREFIXES = [
    '/api/automations',       // registry is the same for every user
    '/api/whatsapp/contacts', // per-user but browser-cached w/ cookies
    '/api/digests',
    '/api/tasks',
    '/api/pending-items',
    '/api/chat/channels',
    '/api/estimates',
    '/api/brain/stats',
    '/api/neodove/report',
  ];
  app.use('*', async (c, next) => {
    await next();
    if (c.req.method !== 'GET') return;
    const path = new URL(c.req.url).pathname;
    const res = c.res;
    if (res && !res.headers.has('Cache-Control')) {
      if (PUBLIC_CACHE_PATHS.some((p) => path.startsWith(p))) {
        res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
      } else if (PRIVATE_CACHE_PREFIXES.some((p) => path.startsWith(p))) {
        res.headers.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30');
      } else {
        res.headers.set('Cache-Control', 'no-store');
      }
    }
  });

  // Boot middleware: warm/ensure the automation engine for automation routes.
  app.use('*', async (c, next) => {
    bootstrapEnv(c.env);
    if (BOOT_PATH_RE.test(new URL(c.req.url).pathname)) {
      if (!bootPromise && bootAttempts >= BOOT_MAX_ATTEMPTS) resetBootAttemptsIfEmpty();
      if (!bootPromise && shouldTriggerBoot()) void ensureBoot();
      if (bootPromise) await Promise.race([bootPromise, new Promise((r) => setTimeout(r, BOOT_WAIT_MS))]);
    } else if (!bootPromise && shouldTriggerBoot()) {
      void ensureBoot(); // opportunistic warm-up on any other request
    }
    await next();
  });

  // Google auth gate (skip exempt paths + runners using SHARED_SECRET).
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

  // ── Auto-live: any successful mutating /api/* write goes live automatically.
  // If the handler already broadcast a typed event (via notifyLive/broadcastLive)
  // the marker suppresses the generic one. This is the "zero-wiring" contract for
  // NEW dashboards/automations: a new endpoint that writes dashboard data gets a
  // `data-changed` broadcast for free — the frontend refetches on it by default.
  // Opt OUT of noisy/non-dashboard writes (auth sessions, tokens, chat typing)
  // via LIVE_NO_AUTO; opt IN to a specific event type via notifyLive().
  const LIVE_NO_AUTO = [
    '/api/auth/',      // session management — not dashboard data
    '/api/token/',     // token store — not dashboard data
    '/api/chat/typing',// high-frequency ephemeral signal
    '/api/chat/files', // attachment store — frontend handles refetch
    '/api/whatsapp/events', // SSE stream
    '/api/events',     // WebSocket upgrade
  ];
  app.use('*', async (c, next) => {
    await next();
    if (c.res?.status && c.res.status >= 400) return; // only successful writes
    const method = c.req.method;
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') return;
    if (hasLiveBroadcasted(c)) return; // handler already emitted a typed event
    const path = new URL(c.req.url).pathname;
    if (!path.startsWith('/api/')) return;
    if (LIVE_NO_AUTO.some((p) => path.startsWith(p))) return;
    const { LiveEvent, broadcastLive } = require('../live') as typeof import('../live');
    broadcastLive(c, LiveEvent.DataChanged, { path, method });
  });

  return app;
}

// Re-exported for route modules that need these modules directly.
export { AuthRoutes, ChatRoutes, EnquiryRoutes, createChatStore, createEnquiryStore, resolveLinkedSender, refreshNeodoveReport, neodoveTodayIst, DASHBOARD_SLUGS, authEnabled, getMe, isApproved, requireScope, isSystemGeneratedComment, getEstimatesPayload, readSessionCookie };