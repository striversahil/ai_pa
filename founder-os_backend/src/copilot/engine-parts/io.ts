// Extracted verbatim from engine.ts by scripts/refactor/split-module.mjs.
// engine.ts re-exports everything public here, so existing imports keep working.
import { getGateway } from "../../shared/ai-gateway";
import type { ChatMessage } from "../../shared/ai-gateway";
import { cacheGet, cacheSet, cacheKeys } from "../../shared/cache";
import type { CopilotDef, CopilotProposal, CopilotReply, CopilotActivity } from "../types";
import { WEB_SEARCH_TOOL, webSearchToolDef, execWebSearch, webSearchActivity } from "../../shared/web-search";
import { FETCH_PAGE_TOOL, fetchPageToolDef, execFetchPage, fetchPageActivity } from "../../shared/fetch-page";
import { CALCULATE_TOOL, calculateToolDef, execCalculate, calculateActivity } from "../../shared/calculator";
import { loadHistory, loadToolTrace, loadReasoning, readEpoch, saveUserTurn, saveToolTrace, saveAssistantReply, saveReasoning, markStorm, capReason } from "../session";
import { getAppSetting } from "../../shared/app-settings";
import { resolveChatChain } from "../../shared/intake-chain";
import { CHAT_PROVIDER, COUNT_TTL_MS, rateWho, usageKey, USAGE_TTL_MS, RATE_WINDOW_MS, BUSY_REPLY, MAX_HUMAN_TURNS, LIMIT_REPLY, THINK_BRIEF, seedToolSigs, MAX_STEPS, CHAT_MAX_TOKENS, chatLegParams, is429Like, parseArgs, toolSig, blockedOut, repeatNudge, MAX_CUT_RESUMES, CUT_RESUME, startLabel } from "./pure";

export async function gatewayReady(env: Record<string, unknown>): Promise<{ ok: boolean; busy: boolean }> {
  const gateway = getGateway(env);
  const usable = (p: string) => gateway.health().some((h) => h.provider === p && h.enabled && h.cooldownUntil <= Date.now());
  const hasAnyKey = gateway.health().some((h) => h.provider === CHAT_PROVIDER);
  if (!hasAnyKey) return { ok: false, busy: false };
  let storm = false;
  try { storm = !!(await cacheGet('ai:storm:chat', 120_000)); } catch { /* ignore */ }
  if (storm || !usable(CHAT_PROVIDER)) return { ok: false, busy: true };
  return { ok: true, busy: false };
}

export async function bumpCount(key: string | null): Promise<void> {
  if (!key) return;
  try {
    const cur = (await cacheGet<number>(key, COUNT_TTL_MS)) ?? 0;
    await cacheSet(key, (Number(cur) || 0) + 1, COUNT_TTL_MS);
  } catch { /* best-effort */ }
}

/** Engine-default tools: every copilot gets web_search + fetch_page + calculate
 *  unless it opts out via disableBuiltInTools. Dispatched by the engine
 *  itself (below), so departments never touch them. */
export function defaultToolDefs<T>(def: CopilotDef<T>, ctx: T) {
  const tools = def.toolDefs(ctx);
  if ((def as any).disableBuiltInTools === true) return tools;
  const names = new Set(tools.map((t) => t?.function?.name));
  if (!names.has(WEB_SEARCH_TOOL)) tools.push(webSearchToolDef());
  if (!names.has(FETCH_PAGE_TOOL)) tools.push(fetchPageToolDef());
  if (!names.has(CALCULATE_TOOL)) tools.push(calculateToolDef());
  return tools;
}

export async function runTool<T>(
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

export async function logUsage(ctx: any): Promise<void> {
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
    const { readGatewayUsage } = await import('../../shared/ai-gateway');
    out.gateway = await readGatewayUsage(n);
  } catch { /* best-effort */ }
  return out;
}

export async function checkHourlyLimit<T>(def: CopilotDef<T>, ctx: T): Promise<{ ok: boolean; reply?: string }> {
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
  // Chat chain resolved once per turn (Agnes relay-only first, paid
  // fallback — resolveChatChain): every step walks the same legs with the
  // same sticky sessionKey. Primary + Agnes model are root-controlled
  // Settings (fail-open to compiled defaults).
  const chatPrimary = await getAppSetting('chat:primary_provider').catch(() => 'agnes');
  const chatAgnesModel = await getAppSetting('chat:agnes_model').catch(() => '');
  const chatOpenrouterModel = await getAppSetting('chat:openrouter_model').catch(() => '');
  const chatPaidRoute = await getAppSetting('chat:paid_route').catch(() => '');
  const chatPaidRouteMode = await getAppSetting('chat:paid_route_mode').catch(() => 'prefer');
  const chatModels = { agnesModel: chatAgnesModel, openrouterModel: chatOpenrouterModel, paidRoute: chatPaidRoute, paidRouteMode: chatPaidRouteMode };
  const chatChain = resolveChatChain(env, { primary: chatPrimary });
  // Same-tool loop ledger, seeded from history so a continued hop can't
  // restart a loop the previous hop already ran (see breaker above).
  const toolSigs = seedToolSigs(hist.messages);
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
    // Chat chain (resolved pre-loop): EVERY leg error, 429 included, falls
    // through to the next leg (each leg rotates keys internally). BUSY only
    // when the whole chain is exhausted *and* the last error is
    // rate-limit-like; anything else still throws (same as the old
    // single-provider behavior).
    if (chatChain.length === 0) {
      await flushTrace();
      throw new Error('No Agnes/paid AI key configured — chat unavailable');
    }
    let res: any;
    let legErr: any = null;
    for (const leg of chatChain) {
      try {
        res = await gateway.complete({
          messages, temperature: 0.2, maxTokens: CHAT_MAX_TOKENS,
          ...chatLegParams(leg, def, env, chatModels),
          tools, toolChoice: 'auto',
          sessionKey: key,
          // No time constraint (founder order) — see CHAT note above.
          timeoutMs: undefined,
          probeTimeoutMs: undefined,
        });
        legErr = null;
        break;
      } catch (e: any) {
        legErr = e;
        if (is429Like(e)) await markStorm();
      }
    }
    if (legErr) {
      await flushTrace();
      if (is429Like(legErr)) {
        return { reply: BUSY_REPLY, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9), memoryTurns: hist.userTurns };
      }
      throw legErr;
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
      // The loop breaker counts identical signatures: 2nd run carries a
      // decide-now nudge, 3rd+ never executes (loop-blocked pseudo-result).
      const batch = res.toolCalls.slice(0, def.maxParallelTools ?? 3);
      const results = await Promise.all(batch.map(async (tc: any) => {
        try {
          const args = parseArgs(tc.arguments);
          const sig = toolSig(tc.name, args);
          const prior = toolSigs.get(sig) ?? 0;
          toolSigs.set(sig, prior + 1);
          if (prior >= 2) {
            return { tc, args, out: blockedOut(tc.name, prior + 1), label: `${tc.name} blocked (repeat ×${prior + 1})`, note: '' };
          }
          const { out, label } = await runTool(env, def, ctx, tc.name, args, String(message ?? ''));
          return { tc, args, out, label, note: prior === 1 ? repeatNudge(tc.name) : '' };
        } catch (e: any) {
          const out: { result: unknown; proposals?: CopilotProposal[] } = { result: { error: String(e?.message ?? e).slice(0, 200) } };
          return { tc, args: {} as Record<string, any>, out, label: def.activityLabel(tc.name, {}, out), note: '' };
        }
      }));
      for (const { tc, args, out, label, note } of results) {
        if (out.proposals) {
          for (const p of out.proposals) {
            if (!proposals.some((q) => q.kind === (p as any).kind && q.label === (p as any).label)) proposals.push(p);
          }
        }
        activity.push({ tool: tc.name, label });
        messages.push({
          role: 'tool',
          content: (() => { const c = JSON.stringify(out.result).slice(0, def.toolResultCap ?? 3000); const n = note ? `\n${note}` : ''; traceParts.push(((def.traceLine?.(tc.name, args, out) ?? `${tc.name}: ${c}`)).slice(0, def.toolResultCap ?? 3000)); return c.slice(0, (def.toolResultCap ?? 3000) - n.length) + n; })(),
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
  // Chat chain resolved once per turn (same legs + sticky key every step).
  const chatPrimaryS = await getAppSetting('chat:primary_provider').catch(() => 'agnes');
  const chatAgnesModelS = await getAppSetting('chat:agnes_model').catch(() => '');
  const chatOpenrouterModelS = await getAppSetting('chat:openrouter_model').catch(() => '');
  const chatPaidRouteS = await getAppSetting('chat:paid_route').catch(() => '');
  const chatPaidRouteModeS = await getAppSetting('chat:paid_route_mode').catch(() => 'prefer');
  const chatModelsS = { agnesModel: chatAgnesModelS, openrouterModel: chatOpenrouterModelS, paidRoute: chatPaidRouteS, paidRouteMode: chatPaidRouteModeS };
  const chatChainS = resolveChatChain(env, { primary: chatPrimaryS });
  // Same-tool loop ledger (seeded from history — see runTurn).
  const toolSigsS = seedToolSigs(hist.messages);
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
    // Stream leg by leg (chain resolved pre-loop): a leg that dies BEFORE first delta yields to the
    // next leg's stream; a leg that dies MID-stream (deltas already sent —
    // another stream can't resume them) drops to non-streaming across the
    // chain below. Same BUSY/throw contract as runTurn above.
    if (chatChainS.length === 0) {
      await flushTrace();
      throw new Error('No Agnes/paid AI key configured — chat unavailable');
    }
    try {
      let streamed = false;
      for (const leg of chatChainS) {
        try {
          for await (const chunk of gateway.stream({
            messages, temperature: 0.2, maxTokens: CHAT_MAX_TOKENS,
            ...chatLegParams(leg, def, env, chatModelsS),
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
          streamed = true;
          break;
        } catch (e: any) {
          if (is429Like(e)) await markStorm();
          // Mid-stream death: deltas already went out — stop trying streams.
          if (stepContent || stepReasoning || toolMap.size > 0) throw e;
          // Pre-delta death: next leg's stream starts clean.
        }
      }
      if (!streamed) throw new Error('All chat legs failed before first token');
    } catch (e: any) {
      if (is429Like(e)) {
        await markStorm();
        await flushTrace();
        const r: CopilotReply = { reply: BUSY_REPLY, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9), memoryTurns: hist.userTurns };
        yield { type: 'done', data: r };
        return r;
      }
      // Fallback to non-streaming across the chain on stream failure (each
      // leg rotates keys internally, so a flaky leg may still serve here).
      let res: any;
      let legErr: any = null;
      for (const leg of chatChainS) {
        try {
          res = await gateway.complete({
            messages, temperature: 0.2, maxTokens: CHAT_MAX_TOKENS,
            ...chatLegParams(leg, def, env, chatModelsS),
            tools, toolChoice: 'auto',
            sessionKey: key,
            timeoutMs: undefined, probeTimeoutMs: undefined,
          });
          legErr = null;
          break;
        } catch (e2: any) {
          legErr = e2;
          if (is429Like(e2)) await markStorm();
        }
      }
      if (legErr) {
        await flushTrace();
        if (is429Like(legErr)) {
          const r: CopilotReply = { reply: BUSY_REPLY, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9), memoryTurns: hist.userTurns };
          yield { type: 'done', data: r };
          return r;
        }
        throw legErr;
      }
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
          const sig = toolSig(tc.name, args);
          const prior = toolSigsS.get(sig) ?? 0;
          toolSigsS.set(sig, prior + 1);
          if (prior >= 2) {
            return { tc, args, out: blockedOut(tc.name, prior + 1), label: `${tc.name} blocked (repeat ×${prior + 1})`, note: '' };
          }
          const { out, label } = await runTool(env, def, ctx, tc.name, args, String(message ?? ''));
          return { tc, args, out, label, note: prior === 1 ? repeatNudge(tc.name) : '' };
        } catch (e: any) {
          const out: { result: unknown; proposals?: CopilotProposal[] } = { result: { error: String(e?.message ?? e).slice(0, 200) } };
          return { tc, args: {} as Record<string, any>, out, label: def.activityLabel(tc.name, {}, out), note: '' };
        }
      }));
      for (const { tc, args, out, label, note } of results) {
        if (out.proposals) {
          for (const p of out.proposals) {
            if (!proposals.some((q) => q.kind === (p as any).kind && q.label === (p as any).label)) proposals.push(p);
          }
        }
        const act = { tool: tc.name, label };
        activity.push(act);
        yield { type: 'activity', data: act };
        (() => { const c2 = JSON.stringify(out.result).slice(0, def.toolResultCap ?? 3000); const n = note ? `\n${note}` : ''; traceParts.push(((def.traceLine?.(tc.name, args, out) ?? `${tc.name}: ${c2}`)).slice(0, def.toolResultCap ?? 3000)); messages.push({ role: 'tool', content: c2.slice(0, (def.toolResultCap ?? 3000) - n.length) + n, tool_call_id: tc.id }); })();
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
