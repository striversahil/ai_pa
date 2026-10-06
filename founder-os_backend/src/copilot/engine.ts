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
// Reasoning models burn tokens on chain-of-thought — chat budgets 4000
// completion tokens so thinking + tool calls never truncate (finish=length).
const CHAT_MAX_TOKENS = 4000;

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
    const out = await def.execTool(ctx, name, args);
    return { out, label: def.activityLabel(name, args, out) };
  } catch (e: any) {
    const out = { result: { error: String(e?.message ?? e).slice(0, 200) } };
    return { out, label: def.activityLabel(name, args, out) };
  }
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
    return {
      messages: [
        ...older.map((m) => ({ role: m.role, content: String(m.text).slice(0, GIST_CAP) })),
        ...recent.map((m) => ({ role: m.role, content: String(m.text).slice(0, RECENT_CAP) })),
      ],
      userTurns,
    };
  } catch {
    return { messages: [], userTurns: 0 };
  }
}

/** Tool-output carry-forward (keepToolOutputs defs only): last turn's tool
 *  results, appended to the next turn's system prompt so "continue" truly
 *  continues. Bounded (12k chars) — big reads fit, history stays cheap. */
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
export async function saveToolTrace<T>(def: CopilotDef<T>, ctx: T, parts: string[]): Promise<void> {
  try {
    if (!def.keepToolOutputs || !parts.length) return;
    const key = def.historyKey?.(ctx);
    if (!key) return;
    const ttl = def.historyTtlMs ?? SESSION_TTL_MS;
    const prev = (await cacheGet<string>(`${key}:trace`, ttl)) ?? '';
    const combined = [...parts, ...(prev ? [prev] : [])].join('\n').slice(0, TRACE_CAP);
    await cacheSet(`${key}:trace`, combined, ttl);
  } catch { /* best-effort */ }
}

/** Append this exchange, keeping the window bounded. Skipped when stateless. */
async function saveHistory<T>(def: CopilotDef<T>, ctx: T, userText: string, replyText: string): Promise<void> {
  try {
    const key = def.historyKey?.(ctx);
    if (!key || !replyText.trim()) return;
    const ttl = def.historyTtlMs ?? SESSION_TTL_MS;
    const max = def.historyMaxMsgs ?? 12;
    const past = (await cacheGet<HistMsg[]>(key, ttl)) ?? [];
    const next = [...past, { role: 'user' as const, text: String(userText).slice(0, 1500) }, { role: 'assistant' as const, text: String(replyText).slice(0, 1500) }];
    await cacheSet(key, next.slice(-max), ttl);
  } catch { /* best-effort */ }
}

async function markStorm(): Promise<void> {
  try { await cacheSet('ai:storm:chat', { at: Date.now() }, 120_000); } catch { /* best-effort */ }
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

/** MIS readout: aggregate per-user chat turns over the last `days` days
 *  (UTC). Served inside /api/debug/ai-health — no new route needed. */
export async function readChatUsage(days: number): Promise<{ total: number; users: Array<{ id: string; turns: number; lastAt: string | null }>; byDay: Array<{ day: string; turns: number }> }> {
  const out = { total: 0, users: [] as Array<{ id: string; turns: number; lastAt: string | null }>, byDay: [] as Array<{ day: string; turns: number }> };
  const n = Math.min(30, Math.max(1, Math.floor(days) || 7));
  const cutoff = new Date(Date.now() - n * 24 * 60 * 60_000).toISOString().slice(0, 10);
  let names: string[] = [];
  try { names = await cacheKeys('copilot:usage:', 1000); } catch { names = []; }
  const perUser = new Map<string, { turns: number; lastAt: string | null }>();
  const perDay = new Map<string, number>();
  for (const name of names) {
    // name: copilot:usage:<YYYY-MM-DD>:<id>
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

/** New-chat: wipe rolling history + any copilot extras (e.g. intake draft). */
export async function clearState<T>(def: CopilotDef<T>, ctx: T): Promise<void> {
  try {
    const key = def.historyKey?.(ctx);
    if (key) await cacheDel(key);
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
    return { reply: allowed.reply ?? 'Hourly chat limit reached — please retry in a bit.', proposals: [], activity: [] };
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
    return { reply: LIMIT_REPLY, proposals: [], activity: [] };
  }
  const toolTrace = await loadToolTrace(def, ctx);
  const messages: ChatMessage[] = [
    { role: 'system', content: def.systemPrompt(ctx) + (toolTrace ? `\n\n[Tool outputs from your earlier turns here \u2014 already known, do NOT re-run these tools, continue from them:\n${toolTrace}]` : '') },
    ...hist.messages,
    { role: 'user', content: String(message ?? '') },
  ];
  const proposals: CopilotProposal[] = [];
  const traceParts: string[] = [];
  const activity: CopilotActivity[] = [];
  let reply = '';
  for (let step = 0; step < (def.maxSteps ?? MAX_STEPS); step++) {
    let res: any;
    try {
      res = await gateway.complete({
        messages, temperature: 0.2, maxTokens: CHAT_MAX_TOKENS,
        provider: CHAT_PROVIDER, model, extraParams: CHAT_PROVIDER_PARAMS,
        tools, toolChoice: 'auto',
        sessionKey: key,
        // Stall guard: reasoning first-tokens are slower — 20s probe, 30s cap.
        timeoutMs: 30_000,
        probeTimeoutMs: 20_000,
      });
    } catch (e: any) {
      if (is429Like(e)) {
        await markStorm();
        return { reply: BUSY_REPLY, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9) };
      }
      throw e;
    }
    if (res.toolCalls && res.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: res.content || '',
        tool_calls: res.toolCalls.map((tc: any) => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.arguments } })),
      });
      for (const tc of res.toolCalls.slice(0, 3)) {
        const args = parseArgs(tc.arguments);
        const { out, label } = await runTool(env, def, ctx, tc.name, args);
        if (out.proposals) proposals.push(...out.proposals);
        activity.push({ tool: tc.name, label });
        messages.push({
          role: 'tool',
          content: (() => { const c = JSON.stringify(out.result).slice(0, def.toolResultCap ?? 3000); traceParts.push(`${tc.name}: ${c}`.slice(0, def.toolResultCap ?? 3000)); return c; })(),
          tool_call_id: tc.id,
        });
      }
      continue;
    }
    reply = res.content?.trim() || def.emptyHint;
    break;
  }
  if (!reply) reply = 'I ran out of steps — try a narrower question.';
  // AWAIT (never fire-and-forget): Workers freeze the isolate once the
  // response returns, killing any pending KV put — the next turn would land
  // on a fresh isolate with no recall ("new session" symptom).
  await saveHistory(def, ctx, String(message ?? ''), reply);
  await saveToolTrace(def, ctx, traceParts);
  return { reply, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9) };
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
      proposals: [], activity: [],
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
    const r: CopilotReply = { reply: LIMIT_REPLY, proposals: [], activity: [] };
    yield { type: 'done', data: r };
    return r;
  }
  const toolTrace = await loadToolTrace(def, ctx);
  const messages: ChatMessage[] = [
    { role: 'system', content: def.systemPrompt(ctx) + (toolTrace ? `\n\n[Tool outputs from your earlier turns here \u2014 already known, do NOT re-run these tools, continue from them:\n${toolTrace}]` : '') },
    ...hist.messages,
    { role: 'user', content: String(message ?? '') },
  ];
  const proposals: CopilotProposal[] = [];
  const traceParts: string[] = [];
  const activity: CopilotActivity[] = [];
  let reply = '';
  for (let step = 0; step < (def.maxSteps ?? MAX_STEPS); step++) {
    let stepContent = '';
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
        timeoutMs: 30_000, probeTimeoutMs: 20_000,
      })) {
        if (chunk.contentDelta) {
          stepContent += chunk.contentDelta;
          yield { type: 'delta', data: { text: chunk.contentDelta } };
        }
        if (chunk.reasoningDelta) {
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
        const r: CopilotReply = { reply: BUSY_REPLY, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9) };
        yield { type: 'done', data: r };
        return r;
      }
      // Fallback to non-streaming on stream failure.
      const res = await gateway.complete({
        messages, temperature: 0.2, maxTokens: CHAT_MAX_TOKENS, provider: CHAT_PROVIDER, model,
        extraParams: CHAT_PROVIDER_PARAMS,
        tools, toolChoice: 'auto',
        sessionKey: key,
        timeoutMs: 30_000, probeTimeoutMs: 20_000,
      });
      if (res.reasoning) yield { type: 'thinking', data: { text: String(res.reasoning).slice(0, 2000) } };
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
      messages.push({
        role: 'assistant', content: stepContent,
        tool_calls: toolCalls.map((tc) => ({ id: tc.id || `call_${Math.random().toString(36).slice(2)}`, type: 'function' as const, function: { name: tc.name, arguments: tc.args || '{}' } })),
      });
      for (const tc of toolCalls.slice(0, 3)) {
        const args = parseArgs(tc.args);
        const { out, label } = await runTool(env, def, ctx, tc.name, args);
        if (out.proposals) proposals.push(...out.proposals);
        const act = { tool: tc.name, label };
        activity.push(act);
        yield { type: 'activity', data: act };
        (() => { const c2 = JSON.stringify(out.result).slice(0, def.toolResultCap ?? 3000); traceParts.push(`${tc.name}: ${c2}`.slice(0, def.toolResultCap ?? 3000)); messages.push({ role: 'tool', content: c2, tool_call_id: tc.id }); })();
      }
      continue;
    }
    reply = stepContent.trim() || def.emptyHint;
    // Already streamed live above — nothing more to emit for the final step.
    break;
  }
  if (!reply) reply = 'I ran out of steps — try a narrower question.';
  const final: CopilotReply = { reply, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9) };
  yield { type: 'done', data: final };
  // AWAIT (see runTurn): a fire-and-forget KV put dies with the isolate.
  await saveHistory(def, ctx, String(message ?? ''), reply);
  await saveToolTrace(def, ctx, traceParts);
  return final;
}
