// chat.ts — per-enquiry sidebar copilot (edge-safe: fetch only, no Node deps).
//
// Agnes-primary (standing rule: Groq is never used in the enquiry
// workflow). Agentic loop, max 6 steps: the model calls scoped tools, the
// module executes them against the same guarded route functions the REST API
// uses (isRestrictedViewer / canManageRates / stripMarginFields), then the
// model answers. Writes are NEVER applied here — the loop returns proposals;
// the frontend confirms and POSTs them to /chat/execute, which re-validates
// through EnquiryRoutes before touching storage.
import { getGateway, type ChatMessage, type ToolDefinition } from '../../shared/ai-gateway';
import { cacheGet, cacheSet } from '../../shared/cache';
// NOTE: price-memory lookup is parked for now (search_price_memory commented
// out below). When re-enabling, restore the similarity import:
//   import { buildItemSpecText, canonicalSpec, dimsEqual, embedTexts,
//     namespaceFor, pineconeQuery, routeByScore } from './similarity';
import {
  enquiryAddComment, enquiryUpdate, canManageRates, isRestrictedViewer, stripMarginFields,
  type EnquiryResult,
} from './routes';
import type { EnquiryStore } from './store';
import type { MeResponse } from '../auth/types';

const MAX_STEPS = 6;
const THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COUNT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// Founder decision (2026-09-21): the copilot is Agnes-only. Weak fallback
// models hallucinate, so a throttled pool answers "busy" instead of guessing.
const BUSY_REPLY = 'The AI is busy (rate-limited) — please retry in a minute.';

function threadKey(enquiryId: string, me: MeResponse): string {
  const who = String((me as any)?.user?.email ?? (me as any)?.user?.id ?? 'anon').toLowerCase();
  return `enquiry:chat:${enquiryId}:${who}`;
}

function countKey(enquiryId: string): string {
  return `enquiry:chat:count:${enquiryId}`;
}

/** Best-effort per-enquiry AI request counter. Chat history is deliberately
 *  NOT stored (threads would grow unbounded) — only the turn count is kept. */
async function bumpChatCount(enquiryId: string): Promise<void> {
  try {
    const cur = (await cacheGet<number>(countKey(enquiryId), COUNT_TTL_MS)) ?? 0;
    await cacheSet(countKey(enquiryId), (Number(cur) || 0) + 1, COUNT_TTL_MS);
  } catch { /* best-effort */ }
}

export interface ChatProposal {
  kind: 'comment' | 'spec_fix';
  text?: string;
  scope?: 'sales' | 'procurement';
  itemIndex?: number;
  spec?: string;
  label: string;
}

/** Audible-visible step for the UI chime: which tool ran + one-line outcome. */
export interface ChatActivity {
  tool: string;
  label: string;
}

export interface ChatReply {
  reply: string;
  proposals: ChatProposal[];
  activity: ChatActivity[];
}

interface Ctx {
  env: Record<string, unknown>;
  store: EnquiryStore;
  me: MeResponse;
  enquiryId: string;
  restricted: boolean;
  privileged: boolean;
}

function toolDefs(ctx: Ctx): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'get_enquiry_summary',
        description: 'Summary of this enquiry: title, client info (company, contact, location), description, priority, status, items with specs/category/kypItem/kypMissing/kypComplete, missing details and completeness counts.',
        parameters: { type: 'object', properties: {} },
      },
    },
    // PARKED: price-memory lookup disabled for now (re-enable with the
    // similarity import at the top + the execTool branch below).
    // {
    //   type: 'function',
    //   function: {
    //     name: 'search_price_memory',
    //     description: 'Top past prices for one line item from price memory.',
    //     parameters: {
    //       type: 'object',
    //       properties: { itemIndex: { type: 'number', description: '0-based item index' } },
    //       required: ['itemIndex'],
    //     },
    //   },
    // },
    // REMOVED: thread reads disabled — history is not stored anymore.
    // {
    //   type: 'function',
    //   function: {
    //     name: 'read_thread',
    //     description: 'Read the discussion thread (comments + item back-and-forth trail).',
    //     parameters: {
    //       type: 'object',
    //       properties: { scope: { type: 'string', description: "'sales' or 'procurement' (defaults to both visible to you)" } },
    //     },
    //   },
    // },
    {
      type: 'function',
      function: {
        name: 'propose_comment',
        description: 'Draft a comment for the user to confirm (does NOT post). Call this whenever the user asks to send, post, or write anything to the enquiry thread.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            scope: { type: 'string', description: "'sales' or 'procurement'" },
          },
          required: ['text'],
        },
      },
    },
  ];
  if (!ctx.restricted) {
    tools.push({
      type: 'function',
      function: {
        name: 'propose_spec_fix',
        description: 'Draft a corrected item spec for the user to confirm (does NOT save).',
        parameters: {
          type: 'object',
          properties: {
            itemIndex: { type: 'number' },
            spec: { type: 'string', description: 'Full corrected spec text' },
          },
          required: ['itemIndex', 'spec'],
        },
      },
    });
  }
  return tools;
}

/** Human chime label per tool + args (shown in the sidebar while answering). */
function activityLabel(name: string, args: Record<string, any>, out: { result: unknown }): string {
  const r = (out.result ?? {}) as Record<string, any>;
  switch (name) {
    case 'get_enquiry_summary': {
      const n = Array.isArray(r.items) ? r.items.length : 0;
      return `Read enquiry · ${n} item${n === 1 ? '' : 's'}`;
    }
    // PARKED with search_price_memory (see toolDefs).
    // case 'search_price_memory': {
    //   const n = Array.isArray(r.matches) ? r.matches.length : 0;
    //   const best = n > 0 ? r.matches[0]?.route : null;
    //   return `Searched price memory · ${n} match${n === 1 ? '' : 'es'}${best ? ` (best: ${best})` : ''}`;
    // };
    // REMOVED with read_thread (see toolDefs).
    // case 'read_thread': {
    //   const n = Array.isArray(r.comments) ? r.comments.length : 0;
    //   return `Read ${args.scope || 'full'} thread · ${n} note${n === 1 ? '' : 's'}`;
    // };
    case 'propose_comment':
      return r.error ? 'Comment draft failed' : 'Drafted a comment for confirm';
    case 'propose_spec_fix':
      return r.error ? 'Spec draft failed' : 'Drafted a spec fix for confirm';
    default:
      return `Ran ${name}`;
  }
}

function parseArgs(raw: string): Record<string, any> {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

async function execTool(ctx: Ctx, name: string, args: Record<string, any>): Promise<{ result: unknown; proposals?: ChatProposal[] }> {
  const enquiry: any = await ctx.store.getEnquiry(ctx.enquiryId).catch(() => null);
  if (!enquiry) return { result: { error: 'enquiry not found' } };
  const view = ctx.privileged ? enquiry : stripMarginFields(enquiry);

  if (name === 'get_enquiry_summary') {    const items = (Array.isArray(view.items) ? view.items : []).map((it: any, i: number) => ({
      index: i,
      name: String(it?.name ?? '') || `Item ${i + 1}`,
      qty: String(it?.qty ?? ''),
      spec: String(it?.spec ?? '').slice(0, 500),
      category: String(it?.category ?? 'Uncategorized').slice(0, 120),
      kypItem: it?.kypItem ? String(it.kypItem).slice(0, 120) : null,
      kypMissing: Array.isArray(it?.kypMissing) ? it.kypMissing.slice(0, 10).map((s: any) => String(s).slice(0, 500)) : [],
      kypComplete: typeof it?.kypComplete === 'boolean' ? it.kypComplete : null,
      rates: (it?.rates ?? []).length,
      finalRate: it?.finalRate ?? null,
      specIssue: it?.specIssue ? String(it.specIssue).slice(0, 300) : null,
      rateAvailable: it?.rateAvailable === true,
    }));
    // Aggregate kypMissing across items for a quick overview (the UI's amber chips)
    let missing: string[] = [];
    try {
      // Prefer per-item kypMissing (the live completeness), fall back to legacy intake cache
      const kypMissingAll = items.flatMap((it: any) => Array.isArray(it.kypMissing) ? it.kypMissing.map((m: string) => `Item ${it.index + 1} — ${m}`) : []);
      if (kypMissingAll.length > 0) missing = kypMissingAll.slice(0, 25);
      else {
        const intake = await cacheGet<Record<string, any>>(`enquiry:intake:${ctx.enquiryId}`, THREAD_TTL_MS);
        if (intake && Array.isArray((intake as any).missing)) missing = (intake as any).missing;
      }
    } catch { /* ignore */ }
    return {
      result: {
        title: String(enquiry.title ?? ''),
        description: String(enquiry.description ?? '').slice(0, 1000),
        client: {
          company: String(enquiry.clientCompany ?? ''),
          contactName: String(enquiry.contactName ?? ''),
          contactPhone: String(enquiry.contactPhone ?? ''),
          contactEmail: String(enquiry.contactEmail ?? ''),
          location: String(enquiry.location ?? ''),
        },
        estNumber: String(enquiry.estNumber ?? ''),
        priority: String(enquiry.priority ?? ''),
        status: ctx.restricted ? undefined : String(enquiry.status ?? ''),
        rateStatus: String(enquiry.rateStatus ?? ''),
        assignedAgentId: String(enquiry.assignedAgentId ?? ''),
        items, missing,
        completeness: {
          complete: items.filter((it: any) => it.kypComplete === true).length,
          incomplete: items.filter((it: any) => it.kypComplete === false).length,
          uncategorized: items.filter((it: any) => !it.category || it.category === 'Uncategorized').length,
        },
      },
    };
  }

  // PARKED: price-memory lookup disabled for now. Restore with the
  // similarity import at the top when re-enabling.
  // if (name === 'search_price_memory') {
  //   const idx = Math.max(0, Math.floor(Number(args.itemIndex) || 0));
  //   const items = Array.isArray(enquiry.items) ? enquiry.items : [];
  //   const it = items[idx];
  //   if (!it) return { result: { error: `no item at index ${idx}` } };
  //   const text = buildItemSpecText({ name: String(it?.name ?? ''), qty: String(it?.qty ?? ''), spec: String(it?.spec ?? '') });
  //   const vecs = await embedTexts(ctx.env, [text]);
  //   if (!vecs || !vecs[0]) return { result: { matches: [], note: 'embeddings unavailable' } };
  //   const category = String((it as any)?.category ?? '');
  //   const namespaces = [namespaceFor(category)];
  //   if (namespaces[0] !== 'uncategorized') namespaces.push('uncategorized');
  //   const matches: any[] = [];
  //   for (const ns of namespaces) {
  //     const found = (await pineconeQuery(ctx.env, ns, vecs[0], 5)) ?? [];
  //     for (const m of found) {
  //       const md = (m.metadata ?? {}) as Record<string, any>;
  //       const specText = [md.name, md.qty, md.spec].filter(Boolean).join(' | ');
  //       const route = routeByScore(m.score, dimsEqual(specText, text));
  //       matches.push({
  //         memoryId: m.id,
  //         score: Math.round(m.score * 100) / 100,
  //         route,
  //         name: md.name,
  //         ...(ctx.restricted ? {} : { finalRate: md.finalRate }),
  //       });
  //     }
  //   }
  //   matches.sort((a, b) => b.score - a.score);
  //   return { result: { matches: matches.slice(0, 5) } };
  // }

  // REMOVED: thread reads disabled — history is not stored anymore.
  // if (name === 'read_thread') {
  //   const want = String(args.scope ?? '').toLowerCase() === 'procurement' ? 'procurement' : 'all';
  //   const all = await ctx.store.listComments(ctx.enquiryId).catch(() => []);
  //   const visible = (all as any[]).filter((cm) => {
  //     const v = String((cm as any)?.visibility ?? 'sales');
  //     if (ctx.restricted) return v === 'procurement';
  //     return want === 'all' ? true : v === want;
  //   });
  //   const items = Array.isArray(enquiry.items) ? enquiry.items : [];
  //   const trail: any[] = [];
  //   items.forEach((it: any, i: number) => {
  //     for (const e of (Array.isArray(it?.thread) ? it.thread : []).slice(-6)) {
  //       trail.push({ item: i, by: e?.by, kind: e?.kind, text: String(e?.text ?? '').slice(0, 300) });
  //     }
  //   });
  //   return {
  //     result: {
  //       comments: visible.slice(-20).map((cm: any) => ({
  //         content: String(cm?.content ?? '').slice(0, 600),
  //         scope: String((cm as any)?.visibility ?? 'sales'),
  //         at: String(cm?.createdAt ?? ''),
  //       })),
  //       itemTrail: trail.slice(-20),
  //     },
  //   };
  // }

  if (name === 'propose_comment') {
    const text = String(args.text ?? '').trim().slice(0, 2000);
    if (!text) return { result: { error: 'empty text' } };
    const scope = ctx.restricted ? 'procurement' : (String(args.scope ?? '').toLowerCase() === 'procurement' ? 'procurement' : 'sales');
    const proposal: ChatProposal = { kind: 'comment', text, scope: scope as 'sales' | 'procurement', label: `Post to ${scope} thread` };
    return { result: { proposed: true }, proposals: [proposal] };
  }

  if (name === 'propose_spec_fix') {
    if (ctx.restricted) return { result: { error: 'not permitted' } };
    const idx = Math.max(0, Math.floor(Number(args.itemIndex) || 0));
    const spec = String(args.spec ?? '').trim().slice(0, 2000);
    if (!spec) return { result: { error: 'empty spec' } };
    const proposal: ChatProposal = { kind: 'spec_fix', itemIndex: idx, spec, label: `Fix Item ${idx + 1} spec` };
    return { result: { proposed: true }, proposals: [proposal] };
  }

  return { result: { error: `unknown tool ${name}` } };
}

/** Run one chat turn. Agnes-primary; returns a config notice without keys. */
export async function chatTurn(
  env: Record<string, unknown>,
  store: EnquiryStore,
  me: MeResponse,
  enquiryId: string,
  message: string,
): Promise<ChatReply> {
  const gateway = getGateway(env);
  const usable = (p: string) => gateway.health().some((h) => h.provider === p && h.enabled && h.cooldownUntil <= Date.now());
  const hasAnyKey = gateway.health().some((h) => h.provider === 'agnes' || h.provider === 'openrouter');
  if (!hasAnyKey) {
    return { reply: 'AI chat is not configured (no Agnes/OpenRouter key).', proposals: [], activity: [] };
  }
  // Agnes-only (see BUSY_REPLY): skip the turn fast when every Agnes key is
  // throttled instead of answering from a hallucinating fallback model.
  // The storm flag is cross-isolate memory (KV): if a sibling isolate just
  // exhausted the pool, fail fast instead of burning ~60s rediscovering it.
  let storm = false;
  try { storm = !!(await cacheGet('ai:storm:agnes', 120_000)); } catch { /* ignore */ }
  if (storm || !usable('agnes')) {
    return { reply: BUSY_REPLY, proposals: [], activity: [] };
  }
  const provider: 'agnes' = 'agnes';
  const ctx: Ctx = {
    env, store, me, enquiryId,
    restricted: isRestrictedViewer(me),
    privileged: canManageRates(me),
  };
  const key = threadKey(enquiryId, me);
  // No chat history is stored (only the per-enquiry request count below).
  // The thread key still pins the whole turn to one gateway key.
  void bumpChatCount(enquiryId);

  const tools = toolDefs(ctx);
  const scopeNote = ctx.restricted
    ? 'The viewer is procurement: NEVER reveal client identity, contacts, or final rates/margins.'
    : ctx.privileged
      ? 'The viewer is management: full detail allowed.'
      : 'The viewer is sales: full pipeline detail, but margin internals (selected vendor, markup) stay hidden.';
  const langNote = !ctx.restricted && !ctx.privileged
    ? 'Reply in Hinglish (Hindi + English mix, Roman script) by default — telecaller style, short & bazaar-friendly. Use Hindi words for common talk (bhai, kya chahiye, pic bhejo, size pucho) mixed with English specs/prices. Keep specs, grades, and prices in English as written.'
    : '';
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are the sales staff helper — you work ON BEHALF of the BUI telecaller for ONE sales enquiry (ID ${enquiryId}). Act like their personal assistant: fill gaps, draft notes, fix specs, and push the enquiry toward price-ready. Answer using the tools — never invent specs, rates, or statuses. You have full KYP catalogue context: each item has category/kypItem/kypMissing/kypComplete and completeness counts — use them to answer "what's missing". Keep replies short. ${langNote} When the user asks to send, post, or write anything to the enquiry thread, draft it via propose_comment so the telecaller can confirm with one tap — do not claim it is done until confirmed. ${scopeNote}`,
    },
    { role: 'user', content: String(message ?? '').slice(0, 2000) },
  ];

  const chatModelAgnes = String((env as any)?.ENQUIRY_CHAT_MODEL ?? '').trim() || 'agnes-3.0-flash';
  let activeProvider: 'agnes' = provider;
  let activeModel: string | undefined = chatModelAgnes;
  const proposals: ChatProposal[] = [];
  const activity: ChatActivity[] = [];
  let reply = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    let res: any;
    try {
      res = await gateway.complete({
        messages, temperature: 0.2, maxTokens: 800,
        provider: activeProvider,
        ...(activeModel ? { model: activeModel } : {}),
        tools, toolChoice: 'auto',
        // Pin the whole conversation to one key (cache affinity); the
        // gateway fails over automatically if that key 429s.
        sessionKey: key,
        // Stall guard: probe 3.0 for first data per step, then continue on
        // 2.5-flash inside the same call (gateway FALLBACK_MODEL + 10-min
        // flag) — caps p99 instead of eating the 20s budget on a hung model.
        // 15s, not 8s: measured TTFB≈total with typical slow starts of
        // 10-14s — an 8s probe would misfire on normal turns and park 3.0
        // on the fallback flag for no reason.
        timeoutMs: 20_000,
        probeTimeoutMs: 15_000,
      });
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      const is429 = /429|rate-limit|1015/i.test(msg) || e?.status === 429;
      // Agnes-only by decision: a mid-turn throttle returns "busy" (with
      // whatever tool activity was gathered) instead of a hallucinated reply.
      if (is429) {
        try { await cacheSet('ai:storm:agnes', { at: Date.now() }, 120_000); } catch { /* best-effort */ }
        return { reply: BUSY_REPLY, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9) };
      }
      throw e;
    }
    if (res.toolCalls && res.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: res.content || '',
        tool_calls: res.toolCalls.map((tc) => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.arguments } })),
      });
      for (const tc of res.toolCalls.slice(0, 3)) {
        const args = parseArgs(tc.arguments);
        let out: { result: unknown; proposals?: ChatProposal[] };
        try {
          out = await execTool(ctx, tc.name, args);
        } catch (e: any) {
          out = { result: { error: String(e?.message ?? e).slice(0, 200) } };
        }
        if (out.proposals) proposals.push(...out.proposals);
        activity.push({ tool: tc.name, label: activityLabel(tc.name, args, out) });
        messages.push({
          role: 'tool',
          content: JSON.stringify(out.result).slice(0, 3000),
          tool_call_id: tc.id,
        });
      }
      continue;
    }
    reply = res.content?.trim() || 'I can’t help with that — try asking about items, specs, or missing details.';
    break;
  }
  if (!reply) reply = 'I ran out of steps — try a narrower question.';

  return { reply, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9) };
}

/** Streaming variant — yields SSE events for live typing. Keeps the SAME agentic loop
 *  (tools are still executed server-side), but the final assistant `content` is streamed
 *  delta-by-delta so the UI can render markdown tables live. */
export async function* streamChatTurn(
  env: Record<string, unknown>,
  store: EnquiryStore,
  me: MeResponse,
  enquiryId: string,
  message: string,
): AsyncGenerator<{ type: string; data: any }, ChatReply, unknown> {
  const gateway = getGateway(env);
  const usable = (p: string) => gateway.health().some((h) => h.provider === p && h.enabled && h.cooldownUntil <= Date.now());
  const hasAnyKey = gateway.health().some((h) => h.provider === 'agnes' || h.provider === 'openrouter');
  if (!hasAnyKey) {
    const r: ChatReply = { reply: 'AI chat is not configured (no Agnes/OpenRouter key).', proposals: [], activity: [] };
    yield { type: 'done', data: r };
    return r;
  }
  // Agnes-only (see BUSY_REPLY): yield "busy" fast when every Agnes key is
  // throttled instead of answering from a hallucinating fallback model.
  // Cross-isolate storm memory (KV) avoids re-burning ~60s per turn.
  let storm = false;
  try { storm = !!(await cacheGet('ai:storm:agnes', 120_000)); } catch { /* ignore */ }
  if (storm || !usable('agnes')) {
    const r: ChatReply = { reply: BUSY_REPLY, proposals: [], activity: [] };
    yield { type: 'done', data: r };
    return r;
  }
  const provider: 'agnes' = 'agnes';
  const ctx: Ctx = { env, store, me, enquiryId, restricted: isRestrictedViewer(me), privileged: canManageRates(me) };
  const key = threadKey(enquiryId, me);
  // No chat history is stored (only the per-enquiry request count below).
  void bumpChatCount(enquiryId);
  const tools = toolDefs(ctx);
  const scopeNote = ctx.restricted
    ? 'The viewer is procurement: NEVER reveal client identity, contacts, or final rates/margins.'
    : ctx.privileged ? 'The viewer is management: full detail allowed.' : 'The viewer is sales: full pipeline detail, but margin internals (selected vendor, markup) stay hidden.';
  const langNote = !ctx.restricted && !ctx.privileged
    ? 'Reply in Hinglish (Hindi + English mix, Roman script) by default — telecaller style, short & bazaar-friendly. Use Hindi words for common talk (bhai, kya chahiye, pic bhejo, size pucho) mixed with English specs/prices. Keep specs, grades, and prices in English as written.'
    : '';
  const messages: ChatMessage[] = [
    { role: 'system', content: `You are the sales staff helper — you work ON BEHALF of the BUI telecaller for ONE sales enquiry (ID ${enquiryId}). Act like their personal assistant: fill gaps, draft notes, fix specs, and push the enquiry toward price-ready. Answer using the tools — never invent specs, rates, or statuses. You have full KYP catalogue context: each item has category/kypItem/kypMissing/kypComplete and completeness counts — use them to answer "what's missing". Keep replies short. ${langNote} When the user asks to send, post, or write anything to the enquiry thread, draft it via propose_comment so the telecaller can confirm with one tap — do not claim it is done until confirmed. ${scopeNote} When you need to compare items or specs, use a markdown table.` },
    { role: 'user', content: String(message ?? '').slice(0, 2000) },
  ];
  const chatModelAgnes = String((env as any)?.ENQUIRY_CHAT_MODEL ?? '').trim() || 'agnes-3.0-flash';
  let activeProvider: 'agnes' = provider;
  let activeModel: string | undefined = chatModelAgnes;
  const proposals: ChatProposal[] = [];
  const activity: ChatActivity[] = [];
  let reply = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    // Stream this step — accumulate tool calls and content (no thinking for speed)
    let stepContent = '';
    const toolMap = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | undefined;
    try {
      for await (const chunk of gateway.stream({
        messages, temperature: 0.2, maxTokens: 800, provider: activeProvider,
        ...(activeModel ? { model: activeModel } : {}),
        tools, toolChoice: 'auto',
        sessionKey: key,
        // Hung-model ejector: first token must arrive in 15s (typical slow
        // TTFB runs ~10-14s, so this trips only on the true stall tail, not
        // normal slow turns); a flowing stream gets the full 20s so long
        // answers are never cut.
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
            // OpenAI streams also send type/id once; handle id without index
            if (!cur.id && tc.id) cur.id = String(tc.id);
            toolMap.set(idx, cur);
          }
        }
        if (chunk.finishReason) finishReason = String(chunk.finishReason);
      }
    } catch (e: any) {
      const emsg = String(e?.message ?? '');
      const is429 = /429|rate-limit|1015/i.test(emsg) || (e as any)?.status === 429;
      if (is429) {
        // Agnes-only by decision: mid-turn throttle yields "busy" (with
        // activity gathered so far) instead of a hallucinated reply.
        try { await cacheSet('ai:storm:agnes', { at: Date.now() }, 120_000); } catch { /* best-effort */ }
        const r: ChatReply = { reply: BUSY_REPLY, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9) };
        yield { type: 'done', data: r };
        return r;
      }
      // Fallback to non-streaming on stream failure (same probe semantics:
      // the probe trip already flagged 3.0 down, so this lands on 2.5-flash).
      const res = await gateway.complete({
        messages, temperature: 0.2, maxTokens: 800, provider: activeProvider,
        ...(activeModel ? { model: activeModel } : {}),
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
        let out: { result: unknown; proposals?: ChatProposal[] };
        try { out = await execTool(ctx, tc.name, args); } catch (e: any) { out = { result: { error: String(e?.message ?? e).slice(0, 200) } }; }
        if (out.proposals) proposals.push(...out.proposals);
        const act = { tool: tc.name, label: activityLabel(tc.name, args, out) };
        activity.push(act);
        yield { type: 'activity', data: act };
        messages.push({ role: 'tool', content: JSON.stringify(out.result).slice(0, 3000), tool_call_id: tc.id });
      }
      continue;
    }
    // No tool calls — this was the final streamed answer
    reply = stepContent.trim() || 'I can’t help with that — try asking about items, specs, or missing details.';
    break;
  }
  if (!reply) reply = 'I ran out of steps — try a narrower question.';
  const final: ChatReply = { reply, proposals: proposals.slice(0, 5), activity: activity.slice(0, 9) };
  yield { type: 'done', data: final };
  return final;
}

/** Execute a confirmed proposal through the guarded route functions. */
export async function executeProposal(
  store: EnquiryStore,
  me: MeResponse,
  enquiryId: string,
  action: Record<string, any>,
): Promise<{ result: EnquiryResult; applied: string }> {
  const kind = String(action?.kind ?? '');
  if (kind === 'comment') {
    const text = String(action?.text ?? '').trim().slice(0, 2000);
    if (!text) return { result: { status: 400, body: { error: 'empty text' } }, applied: 'none' };
    try {
      const r = await enquiryAddComment(store, me, enquiryId, {
        content: text,
        agentId: 0,
        visibility: action?.scope === 'procurement' ? 'procurement' : 'sales',
      });
      return { result: r, applied: r.status === 201 ? 'comment' : 'none' };
    } catch (e: any) {
      return { result: { status: 500, body: { error: String(e?.message ?? 'comment failed').slice(0, 300) } }, applied: 'none' };
    }
  }
  if (kind === 'spec_fix') {
    const idx = Math.max(0, Math.floor(Number(action?.itemIndex) || 0));
    const spec = String(action?.spec ?? '').trim().slice(0, 2000);
    if (!spec) return { result: { status: 400, body: { error: 'empty spec' } }, applied: 'none' };
    try {
      const existing: any = await store.getEnquiry(enquiryId).catch(() => null);
      if (!existing) return { result: { status: 404, body: { error: 'not found' } }, applied: 'none' };
      const items = Array.isArray(existing.items) ? [...existing.items] : [];
      if (!items[idx]) return { result: { status: 400, body: { error: 'bad item index' } }, applied: 'none' };
      items[idx] = { ...items[idx], spec };
      const r = await enquiryUpdate(store, me, enquiryId, { items });
      return { result: r, applied: r.status === 200 ? 'spec_fix' : 'none' };
    } catch (e: any) {
      return { result: { status: 500, body: { error: String(e?.message ?? 'spec fix failed').slice(0, 300) } }, applied: 'none' };
    }
  }
  return { result: { status: 400, body: { error: 'unknown action' } }, applied: 'none' };
}
