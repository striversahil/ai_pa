// copilot/engine.ts — generic agentic chat loop (edge-safe: fetch only).
//
// Extracted verbatim from modules/enquiries/chat.ts so every department
// copilot shares one loop: paid-OpenRouter primary (deepseek-v4.1-flash),
// max 6 tool steps, writes never applied (tools return proposals; the
// frontend confirms via /execute).
// Chat history is deliberately NOT stored — only a best-effort turn counter.
import { getGateway, PAID_CHAT_ROUTING, type ChatMessage } from '../shared/ai-gateway';
import { ROOT_EMAIL } from '../modules/auth/types';
import { cacheDel, cacheGet, cacheKeys, cacheSet } from '../shared/cache';
import { CALCULATE_TOOL, calculateActivity, calculateToolDef, execCalculate } from '../shared/calculator';
import { FETCH_PAGE_TOOL, execFetchPage, fetchPageActivity, fetchPageToolDef } from '../shared/fetch-page';
import { WEB_SEARCH_TOOL, execWebSearch, webSearchActivity, webSearchToolDef } from '../shared/web-search';
import type { CopilotActivity, CopilotDef, CopilotProposal, CopilotReply } from './types';

const MAX_STEPS = 6;
const COUNT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// Chat primary (2026-10-06): paid OpenRouter lane serving
// deepseek/deepseek-v4.1-flash, streamlake/fp8 preferred with OpenRouter
// fallback allowed. Direct Cloudflare egress first; GH relay lanes only on
// 1015/egress blockage (gateway handles both). A throttled pool answers
// "busy" instead of guessing from a hallucinating fallback model.
const BUSY_REPLY = 'The AI is busy (rate-limited) — please retry in a minute.';
const SESSION_TTL_MS = 30 * 60 * 1000;
/** Provider id chat turns pin (paid-only keys — free-tier keys never serve chat). */
export const CHAT_PROVIDER = 'openrouter-paid';
/** OpenRouter routing: single source is PAID_CHAT_ROUTING (gateway) — chat
 *  passes it explicitly so the intent stays visible at the call site. */
const CHAT_PROVIDER_PARAMS = PAID_CHAT_ROUTING;
// Reasoning models burn completion tokens on chain-of-thought (reasoning
// counts against max_tokens) — big blobs think for thousands of tokens
// before answering, so chat budgets 16000 (founder order): room to think
// AND to reply. A step still cut off by the cap (finish=length, empty
// content, no tools) is auto-continued in-loop (≤2 per turn) instead of
// surfacing emptyHint. NOTE: attempts carry no timeout at all (founder
// order), so long generations are never killed before the tokens arrive.
const CHAT_MAX_TOKENS = 16000;
/** NO time constraint on chat model calls (founder order): no per-attempt
 *  timeout, no first-data probe. A call lives until the provider answers or
 *  the connection itself errors. Price: a silently-dead channel hangs the
 *  turn instead of failing over — remedy is a fresh chat + retry. */
/** Nudge appended when a step was cut off by the token cap — resumes the
 *  turn instead of ending it on an empty step. */
const CUT_RESUME = 'Your reply was cut off at the length limit — continue exactly where you left off, no preamble.';
const MAX_CUT_RESUMES = 2;

function parseArgs(raw: string): Record<string, any> {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

async function gatewayReady(env: Record<string, unknown>): Promise<{ ok: boolean; busy: boolean }> {
  const gateway = getGateway(env);
  const usable = (p: string) => gateway.health().some((h) => h.provider === p && h.enabled && h.cooldownUntil <= Date.now());
  const hasAnyKey = gateway.health().some((h) => h.provider === CHAT_PROVIDER);
  if (!hasAnyKey) return { ok: false, busy: false };
  let storm = false;
  try { storm = !!(await cacheGet('ai:storm:chat', 120_000)); } catch { /* ignore */ }
  if (storm || !usable(CHAT_PROVIDER)) return { ok: false, busy: true };
  return { ok: true, busy: false };
}

async function bumpCount(key: string | null): Promise<void> {
  if (!key) return;
  try {
    const cur = (await cacheGet<number>(key, COUNT_TTL_MS)) ?? 0;
    await cacheSet(key, (Number(cur) || 0) + 1, COUNT_TTL_MS);
  } catch { /* best-effort */ }
}

/** Engine-default tools: every copilot gets web_search + fetch_page + calculate
 *  unless it opts out via disableBuiltInTools. Dispatched by the engine
 *  itself (below), so departments never touch them. */
function defaultToolDefs<T>(def: CopilotDef<T>, ctx: T) {
  const tools = def.toolDefs(ctx);
  if ((def as any).disableBuiltInTools === true) return tools;
  const names = new Set(tools.map((t) => t?.function?.name));
  if (!names.has(WEB_SEARCH_TOOL)) tools.push(webSearchToolDef());
  if (!names.has(FETCH_PAGE_TOOL)) tools.push(fetchPageToolDef());
  if (!names.has(CALCULATE_TOOL)) tools.push(calculateToolDef());
  return tools;
}

async function runTool<T>(
  env: Record<string, unknown>,
  def: CopilotDef<T>,
  ctx: T,
  name: string,
  args: Record<string, any>,
  fullMessage?: string,
): Promise<{ out: { result: unknown; proposals?: CopilotProposal[] }; label: string }> {
  if (name === WEB_SEARCH_TOOL) {
    try {
      const r = await execWebSearch(env, String(args.query ?? ''), (args as any).count);
      const out = { result: r };
      return { out, label: webSearchActivity(args, out) };
    } catch (e: any) {
      const out = { result: { results: [], provider: 'none', note: 'web search failed' } };
      return { out, label: webSearchActivity(args, out) };
    }
  }
  if (name === FETCH_PAGE_TOOL) {
    const out = { result: await execFetchPage(env, String(args.url ?? ''), (args as any).maxChars) };
    return { out, label: fetchPageActivity(args, out) };
  }
  if (name === CALCULATE_TOOL) {
    const out = { result: execCalculate(String(args.expression ?? '')) };
    return { out, label: calculateActivity(args, out) };
  }
  try {
    const out = await def.execTool(ctx, name, args, fullMessage);
    return { out, label: def.activityLabel(name, args, out) };
  } catch (e: any) {
    const out = { result: { error: String(e?.message ?? e).slice(0, 200) } };
    return { out, label: def.activityLabel(name, args, out) };
  }
}

/** "Starting" chime for a tool call (shown before it returns). */
function startLabel<T>(def: CopilotDef<T>, name: string, args: Record<string, any>): string {
  try {
    const l = (def as any)?.activityStartLabel?.(name, args);
    if (l) return String(l);
  } catch { /* fall through */ }
  return `Running ${String(name ?? 'tool').replace(/_/g, ' ')}…`;
}

function is429Like(e: any): boolean {
  const msg = String(e?.message ?? '');
  return /429|rate-limit|1015/i.test(msg) || (e as any)?.status === 429;
}

interface HistMsg { role: 'user' | 'assistant'; text: string; }

/** Max HUMAN turns per chat session (across tool steps). The 26th user
 *  message is refused with the limit reply — new chat (clear) resets it. */
export const MAX_HUMAN_TURNS = 25;
export const LIMIT_REPLY = 'Limit reached (25 chats) — open a new chat to continue.';

/**
 * Thinking discipline (all copilots): deepseek-v4-flash via OpenRouter has
 * NO thinking-token budget parameter (reasoning.max_tokens is not honored;
 * effort low/medium silently map to high), so the only real lever on
 * deliberation length is instruction + context size. This line rides every
 * system prompt: brief, non-repetitive internal reasoning, never
 * re-deriving settled facts. It cuts CoT length without touching quality
 * of the visible answer or the tools.
 */
const THINK_BRIEF = '\n\nThink efficiently: keep internal reasoning brief and non-repetitive — state the plan once, act, and move on. Never re-derive settled facts or re-weigh decided options.';

/** Load rolling history (user/assistant texts only — tool payloads stay out).
 *  Storage keeps the full window (e.g. 50 requests); each turn SENDS only a
 *  compact slice — recent messages near-verbatim, older ones as gist lines —
 *  so prompt size stays bounded no matter how long the chat runs. */
const SEND_RECENT = 12;
const RECENT_CAP = 1200;
const GIST_CAP = 120;
async function loadHistory<T>(def: CopilotDef<T>, ctx: T): Promise<{ messages: ChatMessage[]; userTurns: number }> {
  try {
    const key = def.historyKey?.(ctx);
    if (!key) return { messages: [], userTurns: 0 };
    const ttl = def.historyTtlMs ?? SESSION_TTL_MS;
    const past = ((await cacheGet<HistMsg[]>(key, ttl)) ?? []).filter(
      (m) => (m?.role === 'user' || m?.role === 'assistant') && String(m?.text ?? '').trim(),
    );
    const userTurns = past.filter((m) => m.role === 'user').length;
    const recent = past.slice(-SEND_RECENT);
    const older = past.slice(0, Math.max(0, past.length - SEND_RECENT));
    const recentCap = def.historyRecentCap ?? RECENT_CAP;
    const messages: ChatMessage[] = [
      ...older.map((m) => ({ role: m.role, content: String(m.text).slice(0, GIST_CAP) })),
      ...recent.map((m) => ({ role: m.role, content: String(m.text).slice(0, recentCap) })),
    ];
    // Total prompt budget: trim oldest-first so one giant paste (or a long
    // chat) can never overflow the model's context. Default 24k sits above
    // what default per-message caps can produce — other defs unaffected.
    const totalCap = def.historyTotalCap ?? 24_000;
    let total = messages.reduce((n, m) => n + String((m as any)?.content ?? '').length, 0);
    while (messages.length > 1 && total > totalCap) {
      const dropped = messages.shift()!;
      total -= String((dropped as any)?.content ?? '').length;
    }
    return { messages, userTurns };
  } catch {
    return { messages: [], userTurns: 0 };
  }
}

/** Tool-output carry-forward (keepToolOutputs defs only): last turn's tool
 *  results, appended to the next turn's system prompt so "continue" truly
 *  continues. Bounded (12k chars default, def.traceCap overrides) — big
 *  reads fit, history stays cheap. Flushed per step, not just at turn end. */
const TRACE_CAP = 12_000;
export async function loadToolTrace<T>(def: CopilotDef<T>, ctx: T): Promise<string> {
  try {
    if (!def.keepToolOutputs) return '';
    const key = def.historyKey?.(ctx);
    if (!key) return '';
    const t = await cacheGet<string>(`${key}:trace`, def.historyTtlMs ?? SESSION_TTL_MS);
    return typeof t === 'string' ? t : '';
  } catch {
    return '';
  }
}
export async function saveToolTrace<T>(def: CopilotDef<T>, ctx: T, parts: string[], epoch?: number | null): Promise<void> {
  try {
    if (!def.keepToolOutputs || !parts.length) return;
    if (!(await epochCurrent(def, ctx, epoch))) return;
    const key = def.historyKey?.(ctx);
    if (!key) return;
    const ttl = def.historyTtlMs ?? SESSION_TTL_MS;
    const cap = def.traceCap ?? TRACE_CAP;
    const prev = (await cacheGet<string>(`${key}:trace`, ttl)) ?? '';
    const combined = [...parts, ...(prev ? [prev] : [])].join('\n').slice(0, cap);
    await cacheSet(`${key}:trace`, combined, ttl);
  } catch { /* best-effort */ }
}

/** Reasoning carry-forward: the model's deliberation is echoed on the next
 *  call (assistant-message `reasoning`, which DeepSeek-style models require
 *  for tool chains and which keeps continued hops mid-thought) and survives
 *  transport yields in KV. Bounded: per-message cap + stored-window cap
 *  (tail kept — the latest deliberation is what continuation needs).
 *  Best-effort throughout; a miss only costs re-thinking, never correctness. */
const REASON_MSG_CAP = 6000;
const REASON_STORE_CAP = 12_000;
const capReason = (t: unknown): string => String(t ?? '').trim().slice(-REASON_MSG_CAP);
export async function loadReasoning<T>(def: CopilotDef<T>, ctx: T): Promise<string> {
  try {
    const key = def.historyKey?.(ctx);
    if (!key) return '';
    const t = await cacheGet<string>(`${key}:reason`, def.historyTtlMs ?? SESSION_TTL_MS);
    return typeof t === 'string' ? t : '';
  } catch {
    return '';
  }
}
export async function saveReasoning<T>(def: CopilotDef<T>, ctx: T, text: string, epoch?: number | null): Promise<void> {
  try {
    if (!String(text ?? '').trim()) return;
    if (!(await epochCurrent(def, ctx, epoch))) return;
    const key = def.historyKey?.(ctx);
    if (!key) return;
    await cacheSet(`${key}:reason`, String(text).slice(-REASON_STORE_CAP), def.historyTtlMs ?? SESSION_TTL_MS);
  } catch { /* best-effort */ }
}

/** History is saved INCREMENTALLY, never only at turn end: the user's
 *  message lands in KV before the first model call, each step's tool
 *  outputs flush as they happen, and the assistant reply closes the turn.
 *  A turn killed mid-flight (client abort, exception, isolate freeze) still
 *  leaves resumable state — "continue" sees the blob AND the partial work.
 *  Skipped when stateless. */
async function saveUserTurn<T>(def: CopilotDef<T>, ctx: T, userText: string, epoch?: number | null): Promise<void> {
  try {
    if (!(await epochCurrent(def, ctx, epoch))) return;
    const key = def.historyKey?.(ctx);
    if (!key || !String(userText ?? '').trim()) return;
    const ttl = def.historyTtlMs ?? SESSION_TTL_MS;
    const max = def.historyMaxMsgs ?? 12;
    const storeCap = def.historyStoreCap ?? 1500;
    const past = (await cacheGet<HistMsg[]>(key, ttl)) ?? [];
    const next = [...past, { role: 'user' as const, text: String(userText).slice(0, storeCap) }];
    await cacheSet(key, next.slice(-max), ttl);
  } catch { /* best-effort */ }
}
async function saveAssistantReply<T>(def: CopilotDef<T>, ctx: T, replyText: string, epoch?: number | null): Promise<void> {
  try {
    if (!(await epochCurrent(def, ctx, epoch))) return;
    const key = def.historyKey?.(ctx);
    if (!key || !String(replyText ?? '').trim()) return;
    const ttl = def.historyTtlMs ?? SESSION_TTL_MS;
    const max = def.historyMaxMsgs ?? 12;
    const storeCap = def.historyStoreCap ?? 1500;
    const past = (await cacheGet<HistMsg[]>(key, ttl)) ?? [];
    const next = [...past, { role: 'assistant' as const, text: String(replyText).slice(0, storeCap) }];
    await cacheSet(key, next.slice(-max), ttl);
  } catch { /* best-effort */ }
}

async function markStorm(): Promise<void> {
  try { await cacheSet('ai:storm:chat', { at: Date.now() }, 120_000); } catch { /* best-effort */ }
}

/**
 * Confirm-path memory: after the user hits Confirm/Apply, the write must
 * land in THIS thread's history — otherwise the model never learns it
 * happened and re-derives (or re-proposes) from stale context on the next
 * turn. Called by every /chat/execute route after executeProposal settles,
 * success or failure. Raw-key form so store-bound routes (sales) without a
 * CopilotDef ctx can use it too. Deliberately no epoch gate: a confirm is
 * an explicit user act on a visible card.
 */
export async function appendHistoryNote(key: string | null | undefined, ttlMs: number, text: string): Promise<void> {
  try {
    if (!key || !String(text ?? '').trim()) return;
    const past = (await cacheGet<HistMsg[]>(key, ttlMs)) ?? [];
    const next = [...past, { role: 'assistant' as const, text: String(text).slice(0, 1500) }];
    await cacheSet(key, next.slice(-100), ttlMs);
  } catch { /* best-effort */ }
}

/** One-line applied/failed record for appendHistoryNote. Capped, no payloads. */
export function appliedNote(action: Record<string, any>, applied: string, body: any): string {
  const label = String(action?.label ?? action?.kind ?? applied).slice(0, 160);
  if (!applied || applied === 'none') {
    return `✗ Apply failed: ${label} — ${String(body?.error ?? 'rejected').slice(0, 200)}`;
  }
  const b = (body ?? {}) as Record<string, any>;
  const bits: string[] = [];
  if (Array.isArray(b.filed)) bits.push(`${b.filed.length} filed`);
  if (Array.isArray(b.failed) && b.failed.length) bits.push(`${b.failed.length} failed`);
  if (b.rateId) bits.push(`rate ${String(b.rateId).slice(0, 8)}`);
  if (b.id) bits.push(`id ${String(b.id).slice(0, 8)}`);
  if (b.expectedRate != null) bits.push(`expected ₹${b.expectedRate}`);
  if (typeof b.items === 'number') bits.push(`${b.items} items`);
  return `✓ Applied: ${label}${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

// ── Hourly user-turn budget (20/hr default, non-root only) ─────────────────
// One token per USER turn, consumed at turn entry in runTurn/streamTurn. The
// LLM's own tool steps (up to MAX_STEPS gateway calls per turn) never touch
// this counter — only the human's request counts. Fixed window via stored
// resetAt (KV TTL refreshes on every set, so TTL alone would slide).
const RATE_WINDOW_MS = 60 * 60 * 1000;

function rateWho(ctx: any): { id: string; root: boolean } {
  const me = (ctx as any)?.me;
  const email = String(me?.user?.email ?? '').toLowerCase();
  const id = (email || String(me?.user?.id ?? 'anon')).toLowerCase();
  const root = me?.isRoot === true || (email !== '' && email === ROOT_EMAIL.toLowerCase());
  return { id, root };
}

// ── Per-user daily usage log (MIS readout; survives the isolate) ──────────
// One AWAITED KV write per served turn (refused turns log nothing — this is
// why the old fire-and-forget turn counters never persisted). Keyed by user
// + UTC date, 90-day TTL. Root included — root turns cost the same.
const USAGE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export function usageKey(id: string, date = new Date()): string {
  return `copilot:usage:${date.toISOString().slice(0, 10)}:${id}`;
}

async function logUsage(ctx: any): Promise<void> {
  try {
    const { id } = rateWho(ctx);
    const key = usageKey(id);
    const rec = await cacheGet<{ count: number }>(key, USAGE_TTL_MS).catch(() => null);
    await cacheSet(key, { count: (rec?.count ?? 0) + 1, at: new Date().toISOString() }, USAGE_TTL_MS);
  } catch { /* best-effort */ }
}

/** MIS readout: aggregate per-user chat turns + gateway token usage over the
 *  last `days` days (UTC). Served inside /api/debug/ai-health. */
export async function readChatUsage(days: number): Promise<{
  total: number;
  users: Array<{ id: string; turns: number; lastAt: string | null }>;
  byDay: Array<{ day: string; turns: number }>;
  gateway: { total: number; calls: number; byDay: Array<{ day: string; total: number; calls: number }> };
}> {
  const out = {
    total: 0,
    users: [] as Array<{ id: string; turns: number; lastAt: string | null }>,
    byDay: [] as Array<{ day: string; turns: number }>,
    gateway: { total: 0, calls: 0, byDay: [] as Array<{ day: string; total: number; calls: number }> },
  };
  const n = Math.min(30, Math.max(1, Math.floor(days) || 7));
  const cutoff = new Date(Date.now() - n * 24 * 60 * 60_000).toISOString().slice(0, 10);
  let names: string[] = [];
  try { names = await cacheKeys('copilot:usage:', 1000); } catch { names = []; }
  const perUser = new Map<string, { turns: number; lastAt: string | null }>();
  const perDay = new Map<string, number>();
  for (const name of names) {
    const m = /^copilot:usage:(\d{4}-\d{2}-\d{2}):(.+)$/.exec(name);
    if (!m) continue;
    const [, day, id] = m;
    if (day < cutoff) continue;
    let rec: { count?: number; at?: string } | null = null;
    try { rec = await cacheGet<any>(name, USAGE_TTL_MS).catch(() => null); } catch { rec = null; }
    const turns = Number(rec?.count ?? 0);
    if (!(turns > 0)) continue;
    out.total += turns;
    const u = perUser.get(id) ?? { turns: 0, lastAt: null as string | null };
    u.turns += turns;
    const at = String(rec?.at ?? '');
    if (at && (!u.lastAt || at > u.lastAt)) u.lastAt = at;
    perUser.set(id, u);
    perDay.set(day, (perDay.get(day) ?? 0) + turns);
  }
  out.users = [...perUser.entries()]
    .map(([id, v]) => ({ id, turns: v.turns, lastAt: v.lastAt }))
    .sort((a, b) => b.turns - a.turns);
  out.byDay = [...perDay.entries()]
    .map(([day, turns]) => ({ day, turns }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  try {
    const { readGatewayUsage } = await import('../shared/ai-gateway');
    out.gateway = await readGatewayUsage(n);
  } catch { /* best-effort */ }
  return out;
}

async function checkHourlyLimit<T>(def: CopilotDef<T>, ctx: T): Promise<{ ok: boolean; reply?: string }> {
  const limit = def.hourlyLimit ?? 20;
  if (!(limit > 0)) return { ok: true };
  const { id, root } = rateWho(ctx);
  if (root) return { ok: true };
  const key = `copilot:ratelimit:${id}`;
  const now = Date.now();
  let rec: { count: number; resetAt: number } | null = null;
  try { rec = await cacheGet<{ count: number; resetAt: number }>(key, RATE_WINDOW_MS); } catch { rec = null; }
  if (rec && rec.resetAt > now && rec.count >= limit) {
    const mins = Math.max(1, Math.ceil((rec.resetAt - now) / 60_000));
    return { ok: false, reply: `Hourly chat limit reached (${limit} requests/hour) — please retry in ~${mins} min.` };
  }
  const next = rec && rec.resetAt > now
    ? { count: rec.count + 1, resetAt: rec.resetAt }
    : { count: 1, resetAt: now + RATE_WINDOW_MS };
  try { await cacheSet(key, next, RATE_WINDOW_MS); } catch { /* best-effort */ }
  return { ok: true };
}

/** Volatile session id: the client mints one per visible conversation and
 *  sends it with every message. Memory (history + trace + epoch) is keyed
 *  under it — a new chat mints a new id, so the old thread is simply
 *  unreachable (KV TTL reaps it). Normal-LLM behaviour: memory lives exactly
 *  as long as the conversation on screen. Absent = legacy user-keyed memory. */
export function cleanSession(v: unknown): string {
  return String((v as any) ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

/** Chat epoch: bumped on every new-chat. Turns capture it at entry and
 *  every save refuses to write when it moved — so a turn still running (or
 *  a killed turn's generator limping on server-side) can never resurrect
 *  memory the user just cleared. */
async function readEpoch<T>(def: CopilotDef<T>, ctx: T): Promise<number | null> {
  try {
    const key = def.historyKey?.(ctx);
    if (!key) return null;
    return (await cacheGet<number>(`${key}:epoch`, def.historyTtlMs ?? SESSION_TTL_MS)) ?? 0;
  } catch {
    return 0;
  }
}
async function epochCurrent<T>(def: CopilotDef<T>, ctx: T, epoch: number | null | undefined): Promise<boolean> {
  if (epoch === null || epoch === undefined) return true;
  return (await readEpoch(def, ctx)) === epoch;
}

/** New-chat: wipe rolling history + any copilot extras (e.g. intake draft). */
export async function clearState<T>(def: CopilotDef<T>, ctx: T): Promise<void> {
  try {
    const key = def.historyKey?.(ctx);
    // History + carried-forward tool trace go together, or "new chat" lies.
    if (key) await cacheDel(key);
    if (key) await cacheDel(`${key}:trace`).catch(() => {});
    // Copilot scratch state (e.g. intake's per-chat draft registry) dies
    // with the chat too — a new conversation must never inherit old claims.
    if (key) await cacheDel(`${key}:prop`).catch(() => {});
    // Bump AFTER wiping: any in-flight turn holds the old epoch and all
    // its subsequent saves (user msg, per-step trace, reply) are refused.
    if (key) await cacheSet(`${key}:epoch`, Date.now(), def.historyTtlMs ?? SESSION_TTL_MS).catch(() => {});
  } catch { /* best-effort */ }
  try {
    await def.clearExtra?.(ctx);
  } catch { /* best-effort */ }
}

/** Run one non-streaming chat turn. */
export async function runTurn<T>(
  env: Record<string, unknown>,
  def: CopilotDef<T>,
  ctx: T,
  message: string,
): Promise<CopilotReply> {
  const ready = await gatewayReady(env);
  if (!ready.ok) {
    return {
      reply: ready.busy ? BUSY_REPLY : 'AI chat is not configured (no paid OpenRouter key).',
      proposals: [], activity: [],
    };
  }
  const allowed = await checkHourlyLimit(def, ctx);
  if (!allowed.ok) {
    return { reply: allowed.reply ?? 'Hourly chat limit reached — please retry in a bit.', proposals: [], activity: [], memoryTurns: 0 };
  }
  await logUsage(ctx);
  const gateway = getGateway(env);
  const key = def.sessionKey(ctx);
  void bumpCount(def.countKey(ctx));
  const tools = defaultToolDefs(def, ctx);
  const model = String((env as any)?.[def.modelEnvVar] ?? '').trim() || def.defaultModel;
  const hist = await loadHistory(def, ctx);
  // 25-human-turn cap: the refused message is NOT stored, so the cap holds
  // until the user opens a new chat (clear wipes history).
  if (hist.userTurns >= MAX_HUMAN_TURNS) {
    return { reply: LIMIT_REPLY, proposals: [], activity: [], memoryTurns: hist.userTurns };
  }
  const toolTrace = await loadToolTrace(def, ctx);
  const priorReasoning = await loadReasoning(def, ctx);
  const messages: ChatMessage[] = [
    { role: 'system', content: def.systemPrompt(ctx) + THINK_BRIEF + (priorReasoning ? `\n\n[Your unfinished deliberation from the previous hop — continue from it, do not restart:\n${priorReasoning}]` : '') + (toolTrace ? `\n\n[Tool outputs from your earlier turns here \u2014 already known, do NOT re-run these tools, continue from them:\n${toolTrace}]` : '') },
    ...hist.messages,
    { role: 'user', content: String(message ?? '') },
  ];
  // User message persists BEFORE the first model call (see saveUserTurn —
  // a killed turn must still leave the blob behind for "continue").
  // AWAIT (never fire-and-forget): Workers freeze the isolate once the
  // response returns, killing any pending KV put.
  const epoch = await readEpoch(def, ctx);
  await saveUserTurn(def, ctx, String(message ?? ''), epoch);
  const proposals: CopilotProposal[] = [];
  const traceParts: string[] = [];
  const flushTrace = async () => { if (traceParts.length) { const p = traceParts.splice(0); await saveToolTrace(def, ctx, p, epoch); } };
  const activity: CopilotActivity[] = [];
  let reply = '';
  let autoCuts = 0;
  let lastReasoning = '';
  // Transport budget (NOT an AI limit): yield the turn before its HTTP hop
  // approaches the edge ~100s guillotine. State is already flushed
  // incrementally, so the client's auto-continued hop resumes seamlessly.
  const deadline = Date.now() + (def.turnBudgetMs ?? 80_000);
  for (let step = 0; step < (def.maxSteps ?? MAX_STEPS); step++) {
    if (step > 0 && Date.now() > deadline) {
      await flushTrace();
      const partial = reply || 'Working through it — continuing…';
      await saveAssistantReply(def, ctx, partial, epoch);
      await saveReasoning(def, ctx, lastReasoning, epoch);
      return { reply: partial, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9), continued: true, memoryTurns: hist.userTurns };
    }
    let res: any;
    try {
      res = await gateway.complete({
        messages, temperature: 0.2, maxTokens: CHAT_MAX_TOKENS,
        provider: CHAT_PROVIDER, model, extraParams: CHAT_PROVIDER_PARAMS,
        tools, toolChoice: 'auto',
        sessionKey: key,
        // No time constraint (founder order) — see CHAT note above.
        timeoutMs: undefined,
        probeTimeoutMs: undefined,
      });
    } catch (e: any) {
      if (is429Like(e)) {
        await markStorm();
        await flushTrace();
        return { reply: BUSY_REPLY, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9), memoryTurns: hist.userTurns };
      }
      await flushTrace();
      throw e;
    }
    const stepReasoning = capReason((res as any)?.reasoning);
    if (stepReasoning) lastReasoning = stepReasoning;
    if (res.toolCalls && res.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: res.content || '',
        tool_calls: res.toolCalls.map((tc: any) => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.arguments } })),
        ...(stepReasoning ? { reasoning: stepReasoning } : {}),
      });
      // Parallel fan-out: independent calls resolve together, results
      // re-attached in call order. One failing call must not sink the batch.
      const batch = res.toolCalls.slice(0, def.maxParallelTools ?? 3);
      const results = await Promise.all(batch.map(async (tc: any) => {
        try {
          const args = parseArgs(tc.arguments);
          const { out, label } = await runTool(env, def, ctx, tc.name, args, String(message ?? ''));
          return { tc, out, label };
        } catch (e: any) {
          const out: { result: unknown; proposals?: CopilotProposal[] } = { result: { error: String(e?.message ?? e).slice(0, 200) } };
          return { tc, out, label: def.activityLabel(tc.name, {}, out) };
        }
      }));
      for (const { tc, out, label } of results) {
        if (out.proposals) proposals.push(...out.proposals);
        activity.push({ tool: tc.name, label });
        messages.push({
          role: 'tool',
          content: (() => { const c = JSON.stringify(out.result).slice(0, def.toolResultCap ?? 3000); traceParts.push(`${tc.name}: ${c}`.slice(0, def.toolResultCap ?? 3000)); return c; })(),
          tool_call_id: tc.id,
        });
      }
      await flushTrace();
      continue;
    }
    // Length-cutoff with nothing usable: the model thought itself into the
    // token cap (reasoning counts against it). Resume in-loop instead of
    // ending the turn on an empty step.
    const cutOff = !(res.toolCalls?.length > 0) && !res.content?.trim() && (res as any)?.finishReason === 'length';
    if (cutOff && autoCuts < MAX_CUT_RESUMES) {
      autoCuts++;
      messages.push({ role: 'assistant' as const, content: '' }, { role: 'user' as const, content: CUT_RESUME });
      continue;
    }
    reply = res.content?.trim() || def.emptyHint;
    break;
  }
  if (!reply) reply = 'I ran out of steps — try a narrower question.';
  await saveAssistantReply(def, ctx, reply, epoch);
  await saveReasoning(def, ctx, lastReasoning, epoch);
  return { reply, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9), memoryTurns: hist.userTurns };
}

/** Streaming variant — yields SSE events for live typing. Same loop. */
export async function* streamTurn<T>(
  env: Record<string, unknown>,
  def: CopilotDef<T>,
  ctx: T,
  message: string,
): AsyncGenerator<{ type: string; data: any }, CopilotReply, unknown> {
  const ready = await gatewayReady(env);
  if (!ready.ok) {
    const r: CopilotReply = {
      reply: ready.busy ? BUSY_REPLY : 'AI chat is not configured (no paid OpenRouter key).',
      proposals: [], activity: [],
    };
    yield { type: 'done', data: r };
    return r;
  }
  const allowed = await checkHourlyLimit(def, ctx);
  if (!allowed.ok) {
    const r: CopilotReply = {
      reply: allowed.reply ?? 'Hourly chat limit reached — please retry in a bit.',
      proposals: [], activity: [], memoryTurns: 0,
    };
    yield { type: 'done', data: r };
    return r;
  }
  await logUsage(ctx);
  const gateway = getGateway(env);
  const key = def.sessionKey(ctx);
  void bumpCount(def.countKey(ctx));
  const tools = defaultToolDefs(def, ctx);
  const model = String((env as any)?.[def.modelEnvVar] ?? '').trim() || def.defaultModel;
  const hist = await loadHistory(def, ctx);
  if (hist.userTurns >= MAX_HUMAN_TURNS) {
    const r: CopilotReply = { reply: LIMIT_REPLY, proposals: [], activity: [], memoryTurns: hist.userTurns };
    yield { type: 'done', data: r };
    return r;
  }
  const toolTrace = await loadToolTrace(def, ctx);
  const priorReasoning = await loadReasoning(def, ctx);
  const messages: ChatMessage[] = [
    { role: 'system', content: def.systemPrompt(ctx) + THINK_BRIEF + (priorReasoning ? `\n\n[Your unfinished deliberation from the previous hop — continue from it, do not restart:\n${priorReasoning}]` : '') + (toolTrace ? `\n\n[Tool outputs from your earlier turns here \u2014 already known, do NOT re-run these tools, continue from them:\n${toolTrace}]` : '') },
    ...hist.messages,
    { role: 'user', content: String(message ?? '') },
  ];
  const epoch = await readEpoch(def, ctx);
  await saveUserTurn(def, ctx, String(message ?? ''), epoch);
  const proposals: CopilotProposal[] = [];
  const traceParts: string[] = [];
  const flushTrace = async () => { if (traceParts.length) { const p = traceParts.splice(0); await saveToolTrace(def, ctx, p, epoch); } };
  const activity: CopilotActivity[] = [];
  let reply = '';
  let autoCuts = 0;
  let lastReasoning = '';
  let turnText = '';
  // Transport budget, same as runTurn: yield before the edge guillotine.
  const deadline = Date.now() + (def.turnBudgetMs ?? 80_000);
  for (let step = 0; step < (def.maxSteps ?? MAX_STEPS); step++) {
    let stepContent = '';
    let stepReasoning = '';
    if (step > 0 && Date.now() > deadline) {
      await flushTrace();
      const partial: CopilotReply = { reply: turnText, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9), continued: true, memoryTurns: hist.userTurns };
      yield { type: 'done', data: partial };
      await saveAssistantReply(def, ctx, turnText || 'Working through it — continuing…', epoch);
      await saveReasoning(def, ctx, lastReasoning, epoch);
      return partial;
    }
    // Live streaming: every content token goes out as a delta immediately
    // (token-by-token typing). Steps that end in tool calls are working
    // notes — their streamed text stays visible in the bubble (never
    // replaced), and a thinking summary is also emitted for status UI.
    const toolMap = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | undefined;
    try {
      for await (const chunk of gateway.stream({
        messages, temperature: 0.2, maxTokens: CHAT_MAX_TOKENS, provider: CHAT_PROVIDER, model,
        extraParams: CHAT_PROVIDER_PARAMS,
        tools, toolChoice: 'auto',
        sessionKey: key,
        timeoutMs: undefined, probeTimeoutMs: undefined,
      })) {
        if (chunk.contentDelta) {
          stepContent += chunk.contentDelta;
          yield { type: 'delta', data: { text: chunk.contentDelta } };
        }
        if (chunk.reasoningDelta) {
          stepReasoning += String(chunk.reasoningDelta);
          yield { type: 'thinking', data: { text: String(chunk.reasoningDelta).slice(0, 500) } };
        }
        if (chunk.toolCallDelta) {
          for (const tc of chunk.toolCallDelta as any[]) {
            const idx = Number(tc.index ?? 0);
            const cur = toolMap.get(idx) ?? { id: '', name: '', args: '' };
            if (tc.id) cur.id = String(tc.id);
            if (tc.function?.name) cur.name = String(tc.function.name);
            if (tc.function?.arguments) cur.args += String(tc.function.arguments);
            if (!cur.id && tc.id) cur.id = String(tc.id);
            toolMap.set(idx, cur);
          }
        }
        if (chunk.finishReason) finishReason = String(chunk.finishReason);
      }
    } catch (e: any) {
      if (is429Like(e)) {
        await markStorm();
        await flushTrace();
        const r: CopilotReply = { reply: BUSY_REPLY, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9), memoryTurns: hist.userTurns };
        yield { type: 'done', data: r };
        return r;
      }
      // Fallback to non-streaming on stream failure.
      const res = await gateway.complete({
        messages, temperature: 0.2, maxTokens: CHAT_MAX_TOKENS, provider: CHAT_PROVIDER, model,
        extraParams: CHAT_PROVIDER_PARAMS,
        tools, toolChoice: 'auto',
        sessionKey: key,
        timeoutMs: undefined, probeTimeoutMs: undefined,
      });
      if (res.reasoning) {
        stepReasoning += String(res.reasoning);
        yield { type: 'thinking', data: { text: String(res.reasoning).slice(0, 2000) } };
      }
      if (res.toolCalls && res.toolCalls.length) {
        for (const tc of res.toolCalls) toolMap.set(toolMap.size, { id: tc.id, name: tc.name, args: tc.arguments });
        finishReason = 'tool_calls';
      } else {
        stepContent = res.content ?? '';
        if (stepContent) yield { type: 'delta', data: { text: stepContent } };
        finishReason = res.toolCalls ? 'tool_calls' : 'stop';
      }
    }
    const toolCalls = [...toolMap.values()].filter((t) => t.name);
    if (toolCalls.length > 0) {
      if (stepContent.trim()) yield { type: 'thinking', data: { text: stepContent.trim().slice(0, 500) } };
      const cappedStepReasoning = capReason(stepReasoning);
      if (cappedStepReasoning) lastReasoning = cappedStepReasoning;
      messages.push({
        role: 'assistant', content: stepContent,
        tool_calls: toolCalls.map((tc) => ({ id: tc.id || `call_${Math.random().toString(36).slice(2)}`, type: 'function' as const, function: { name: tc.name, arguments: tc.args || '{}' } })),
        ...(cappedStepReasoning ? { reasoning: cappedStepReasoning } : {}),
      });
      turnText += stepContent;
      const batch = toolCalls.slice(0, def.maxParallelTools ?? 3);
      // Announce every call BEFORE it runs: a 5s lookup with no signal
      // feels broken, while "Looking up vendors…" (pulsing) feels alive.
      // Completions below replace these pending chips in place.
      for (const tc of batch) {
        yield { type: 'activity-start', data: { tool: tc.name, label: startLabel(def, tc.name, parseArgs(tc.args)) } };
      }
      const results = await Promise.all(batch.map(async (tc) => {
        try {
          const args = parseArgs(tc.args);
          const { out, label } = await runTool(env, def, ctx, tc.name, args, String(message ?? ''));
          return { tc, out, label };
        } catch (e: any) {
          const out: { result: unknown; proposals?: CopilotProposal[] } = { result: { error: String(e?.message ?? e).slice(0, 200) } };
          return { tc, out, label: def.activityLabel(tc.name, {}, out) };
        }
      }));
      for (const { tc, out, label } of results) {
        if (out.proposals) proposals.push(...out.proposals);
        const act = { tool: tc.name, label };
        activity.push(act);
        yield { type: 'activity', data: act };
        (() => { const c2 = JSON.stringify(out.result).slice(0, def.toolResultCap ?? 3000); traceParts.push(`${tc.name}: ${c2}`.slice(0, def.toolResultCap ?? 3000)); messages.push({ role: 'tool', content: c2, tool_call_id: tc.id }); })();
      }
      await flushTrace();
      continue;
    }
    // Same length-cutoff resume as runTurn (finishReason is captured per
    // step above). The resumed thinking streams live like any other step.
    const cutOff = toolCalls.length === 0 && !stepContent.trim() && finishReason === 'length';
    if (cutOff && autoCuts < MAX_CUT_RESUMES) {
      autoCuts++;
      const cappedCutReasoning = capReason(stepReasoning);
      if (cappedCutReasoning) lastReasoning = cappedCutReasoning;
      messages.push({ role: 'assistant' as const, content: stepContent, ...(cappedCutReasoning ? { reasoning: cappedCutReasoning } : {}) }, { role: 'user' as const, content: CUT_RESUME });
      continue;
    }
    turnText += stepContent;
    reply = turnText.trim() || def.emptyHint;
    // Already streamed live above — nothing more to emit for the final step.
    break;
  }
  if (!reply) reply = 'I ran out of steps — try a narrower question.';
  const final: CopilotReply = { reply, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9), memoryTurns: hist.userTurns };
  yield { type: 'done', data: final };
  // AWAIT: a fire-and-forget KV put dies with the isolate. (User turn +
  // per-step trace were already flushed during the loop — this only closes
  // the turn with the assistant reply.)
  await saveAssistantReply(def, ctx, reply, epoch);
  await saveReasoning(def, ctx, lastReasoning, epoch);
  return final;
}
