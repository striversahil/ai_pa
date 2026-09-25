// copilot/engine.ts — generic agentic chat loop (edge-safe: fetch only).
//
// Extracted verbatim from modules/enquiries/chat.ts so every department
// copilot shares one loop: Agnes-primary, max 6 tool steps, writes never
// applied (tools return proposals; the frontend confirms via /execute).
// Chat history is deliberately NOT stored — only a best-effort turn counter.
import { getGateway, type ChatMessage } from '../shared/ai-gateway';
import { cacheDel, cacheGet, cacheSet } from '../shared/cache';
import type { CopilotActivity, CopilotDef, CopilotProposal, CopilotReply } from './types';

const MAX_STEPS = 6;
const COUNT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// Founder decision (2026-09-21): copilots are Agnes-only. A throttled pool
// answers "busy" instead of guessing from a hallucinating fallback model.
const BUSY_REPLY = 'The AI is busy (rate-limited) — please retry in a minute.';
const SESSION_TTL_MS = 30 * 60 * 1000;

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
  const hasAnyKey = gateway.health().some((h) => h.provider === 'agnes' || h.provider === 'openrouter');
  if (!hasAnyKey) return { ok: false, busy: false };
  let storm = false;
  try { storm = !!(await cacheGet('ai:storm:agnes', 120_000)); } catch { /* ignore */ }
  if (storm || !usable('agnes')) return { ok: false, busy: true };
  return { ok: true, busy: false };
}

async function bumpCount(key: string | null): Promise<void> {
  if (!key) return;
  try {
    const cur = (await cacheGet<number>(key, COUNT_TTL_MS)) ?? 0;
    await cacheSet(key, (Number(cur) || 0) + 1, COUNT_TTL_MS);
  } catch { /* best-effort */ }
}

function is429Like(e: any): boolean {
  const msg = String(e?.message ?? '');
  return /429|rate-limit|1015/i.test(msg) || (e as any)?.status === 429;
}

interface HistMsg { role: 'user' | 'assistant'; text: string; }

/** Load rolling history (user/assistant texts only — tool payloads stay out).
 *  Storage keeps the full window (e.g. 50 requests); each turn SENDS only a
 *  compact slice — recent messages near-verbatim, older ones as gist lines —
 *  so prompt size stays bounded no matter how long the chat runs. */
const SEND_RECENT = 12;
const RECENT_CAP = 1200;
const GIST_CAP = 120;
async function loadHistory<T>(def: CopilotDef<T>, ctx: T): Promise<ChatMessage[]> {
  try {
    const key = def.historyKey?.(ctx);
    if (!key) return [];
    const ttl = def.historyTtlMs ?? SESSION_TTL_MS;
    const past = ((await cacheGet<HistMsg[]>(key, ttl)) ?? []).filter(
      (m) => (m?.role === 'user' || m?.role === 'assistant') && String(m?.text ?? '').trim(),
    );
    const recent = past.slice(-SEND_RECENT);
    const older = past.slice(0, Math.max(0, past.length - SEND_RECENT));
    return [
      ...older.map((m) => ({ role: m.role, content: String(m.text).slice(0, GIST_CAP) })),
      ...recent.map((m) => ({ role: m.role, content: String(m.text).slice(0, RECENT_CAP) })),
    ];
  } catch {
    return [];
  }
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
  try { await cacheSet('ai:storm:agnes', { at: Date.now() }, 120_000); } catch { /* best-effort */ }
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
      reply: ready.busy ? BUSY_REPLY : 'AI chat is not configured (no Agnes/OpenRouter key).',
      proposals: [], activity: [],
    };
  }
  const gateway = getGateway(env);
  const key = def.sessionKey(ctx);
  void bumpCount(def.countKey(ctx));
  const tools = def.toolDefs(ctx);
  const model = String((env as any)?.[def.modelEnvVar] ?? '').trim() || def.defaultModel;
  const messages: ChatMessage[] = [
    { role: 'system', content: def.systemPrompt(ctx) },
    ...(await loadHistory(def, ctx)),
    { role: 'user', content: String(message ?? '').slice(0, 2000) },
  ];
  const proposals: CopilotProposal[] = [];
  const activity: CopilotActivity[] = [];
  let reply = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    let res: any;
    try {
      res = await gateway.complete({
        messages, temperature: 0.2, maxTokens: 800,
        provider: 'agnes', model,
        tools, toolChoice: 'auto',
        sessionKey: key,
        // Stall guard: probe for first data, then continue on the fallback
        // model inside the same call — caps p99 instead of burning budget.
        timeoutMs: 20_000,
        probeTimeoutMs: 15_000,
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
        let out: { result: unknown; proposals?: CopilotProposal[] };
        try {
          out = await def.execTool(ctx, tc.name, args);
        } catch (e: any) {
          out = { result: { error: String(e?.message ?? e).slice(0, 200) } };
        }
        if (out.proposals) proposals.push(...out.proposals);
        activity.push({ tool: tc.name, label: def.activityLabel(tc.name, args, out) });
        messages.push({
          role: 'tool',
          content: JSON.stringify(out.result).slice(0, 3000),
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
      reply: ready.busy ? BUSY_REPLY : 'AI chat is not configured (no Agnes/OpenRouter key).',
      proposals: [], activity: [],
    };
    yield { type: 'done', data: r };
    return r;
  }
  const gateway = getGateway(env);
  const key = def.sessionKey(ctx);
  void bumpCount(def.countKey(ctx));
  const tools = def.toolDefs(ctx);
  const model = String((env as any)?.[def.modelEnvVar] ?? '').trim() || def.defaultModel;
  const messages: ChatMessage[] = [
    { role: 'system', content: def.systemPrompt(ctx) },
    ...(await loadHistory(def, ctx)),
    { role: 'user', content: String(message ?? '').slice(0, 2000) },
  ];
  const proposals: CopilotProposal[] = [];
  const activity: CopilotActivity[] = [];
  let reply = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    let stepContent = '';
    const toolMap = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | undefined;
    try {
      for await (const chunk of gateway.stream({
        messages, temperature: 0.2, maxTokens: 800, provider: 'agnes', model,
        tools, toolChoice: 'auto',
        sessionKey: key,
        timeoutMs: 20_000, probeTimeoutMs: 15_000,
      })) {
        if (chunk.contentDelta) {
          stepContent += chunk.contentDelta;
          yield { type: 'delta', data: { text: chunk.contentDelta } };
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
        messages, temperature: 0.2, maxTokens: 800, provider: 'agnes', model,
        tools, toolChoice: 'auto',
        sessionKey: key,
        timeoutMs: 20_000, probeTimeoutMs: 15_000,
      });
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
      messages.push({
        role: 'assistant', content: stepContent,
        tool_calls: toolCalls.map((tc) => ({ id: tc.id || `call_${Math.random().toString(36).slice(2)}`, type: 'function' as const, function: { name: tc.name, arguments: tc.args || '{}' } })),
      });
      for (const tc of toolCalls.slice(0, 3)) {
        const args = parseArgs(tc.args);
        let out: { result: unknown; proposals?: CopilotProposal[] };
        try { out = await def.execTool(ctx, tc.name, args); } catch (e: any) { out = { result: { error: String(e?.message ?? e).slice(0, 200) } }; }
        if (out.proposals) proposals.push(...out.proposals);
        const act = { tool: tc.name, label: def.activityLabel(tc.name, args, out) };
        activity.push(act);
        yield { type: 'activity', data: act };
        messages.push({ role: 'tool', content: JSON.stringify(out.result).slice(0, 3000), tool_call_id: tc.id });
      }
      continue;
    }
    reply = stepContent.trim() || def.emptyHint;
    break;
  }
  if (!reply) reply = 'I ran out of steps — try a narrower question.';
  const final: CopilotReply = { reply, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9) };
  yield { type: 'done', data: final };
  // AWAIT (see runTurn): a fire-and-forget KV put dies with the isolate.
  await saveHistory(def, ctx, String(message ?? ''), reply);
  return final;
}
