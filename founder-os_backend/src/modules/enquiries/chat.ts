// chat.ts — per-enquiry sidebar copilot (edge-safe: fetch only, no Node deps).
//
// OpenRouter-only (standing rule: Groq is never used in the enquiry
// workflow). Agentic loop, max 6 steps: the model calls scoped tools, the
// module executes them against the same guarded route functions the REST API
// uses (isRestrictedViewer / canManageRates / stripMarginFields), then the
// model answers. Writes are NEVER applied here — the loop returns proposals;
// the frontend confirms and POSTs them to /chat/execute, which re-validates
// through EnquiryRoutes before touching storage.
import { getGateway, type ChatMessage, type ToolDefinition } from '../../shared/ai-gateway';
import { cacheGet, cacheSet } from '../../shared/cache';
import {
  buildItemSpecText, canonicalSpec, dimsEqual, embedTexts, namespaceFor,
  pineconeQuery, routeByScore,
} from './similarity';
import {
  enquiryAddComment, enquiryUpdate, canManageRates, isRestrictedViewer, stripMarginFields,
  type EnquiryResult,
} from './routes';
import { enquiryLabelText, type EnquiryStore } from './store';
import type { MeResponse } from '../auth/types';

const MAX_STEPS = 6;
const THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HISTORY = 12;

function threadKey(enquiryId: string, me: MeResponse): string {
  const who = String((me as any)?.user?.email ?? (me as any)?.user?.id ?? 'anon').toLowerCase();
  return `enquiry:chat:${enquiryId}:${who}`;
}

export interface ChatProposal {
  kind: 'comment' | 'spec_fix';
  text?: string;
  scope?: 'sales' | 'procurement';
  itemIndex?: number;
  spec?: string;
  label: string;
}

export interface ChatReply {
  reply: string;
  proposals: ChatProposal[];
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
        description: 'Scoped summary of this enquiry: label, status, items with specs/rates, workflow stage, missing details.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_price_memory',
        description: 'Top past prices for one line item from price memory.',
        parameters: {
          type: 'object',
          properties: { itemIndex: { type: 'number', description: '0-based item index' } },
          required: ['itemIndex'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_thread',
        description: 'Read the discussion thread (comments + item back-and-forth trail).',
        parameters: {
          type: 'object',
          properties: { scope: { type: 'string', description: "'sales' or 'procurement' (defaults to both visible to you)" } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_comment',
        description: 'Draft a comment for the user to confirm (does NOT post).',
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

  if (name === 'get_enquiry_summary') {
    const items = (Array.isArray(view.items) ? view.items : []).map((it: any, i: number) => ({
      index: i,
      name: String(it?.name ?? '') || `Item ${i + 1}`,
      qty: String(it?.qty ?? ''),
      spec: String(it?.spec ?? '').slice(0, 500),
      rates: (it?.rates ?? []).length,
      finalRate: it?.finalRate ?? null,
      specIssue: it?.specIssue ? String(it.specIssue).slice(0, 300) : null,
      rateAvailable: it?.rateAvailable === true,
    }));
    let missing: string[] = [];
    try {
      const intake = await cacheGet<Record<string, any>>(`enquiry:intake:${ctx.enquiryId}`, THREAD_TTL_MS);
      if (intake && Array.isArray((intake as any).missing)) missing = (intake as any).missing;
    } catch { /* ignore */ }
    return {
      result: {
        label: enquiryLabelText(enquiry.dailyNo ?? null, String(enquiry.createdAt ?? ''), String(enquiry.source ?? 'TL')),
        title: String(enquiry.title ?? ''),
        status: ctx.restricted ? undefined : String(enquiry.status ?? ''),
        rateStatus: String(enquiry.rateStatus ?? ''),
        items, missing,
      },
    };
  }

  if (name === 'search_price_memory') {
    const idx = Math.max(0, Math.floor(Number(args.itemIndex) || 0));
    const items = Array.isArray(enquiry.items) ? enquiry.items : [];
    const it = items[idx];
    if (!it) return { result: { error: `no item at index ${idx}` } };
    const text = buildItemSpecText({ name: String(it?.name ?? ''), qty: String(it?.qty ?? ''), spec: String(it?.spec ?? '') });
    const vecs = await embedTexts(ctx.env, [text]);
    if (!vecs || !vecs[0]) return { result: { matches: [], note: 'embeddings unavailable' } };
    const category = String((it as any)?.category ?? '');
    const namespaces = [namespaceFor(category)];
    if (namespaces[0] !== 'uncategorized') namespaces.push('uncategorized');
    const matches: any[] = [];
    for (const ns of namespaces) {
      const found = (await pineconeQuery(ctx.env, ns, vecs[0], 5)) ?? [];
      for (const m of found) {
        const md = (m.metadata ?? {}) as Record<string, any>;
        const specText = [md.name, md.qty, md.spec].filter(Boolean).join(' | ');
        const route = routeByScore(m.score, dimsEqual(specText, text));
        matches.push({
          memoryId: m.id,
          score: Math.round(m.score * 100) / 100,
          route,
          name: md.name,
          ...(ctx.restricted ? {} : { finalRate: md.finalRate }),
        });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    return { result: { matches: matches.slice(0, 5) } };
  }

  if (name === 'read_thread') {
    const want = String(args.scope ?? '').toLowerCase() === 'procurement' ? 'procurement' : 'all';
    const all = await ctx.store.listComments(ctx.enquiryId).catch(() => []);
    const visible = (all as any[]).filter((cm) => {
      const v = String((cm as any)?.visibility ?? 'sales');
      if (ctx.restricted) return v === 'procurement';
      return want === 'all' ? true : v === want;
    });
    const items = Array.isArray(enquiry.items) ? enquiry.items : [];
    const trail: any[] = [];
    items.forEach((it: any, i: number) => {
      for (const e of (Array.isArray(it?.thread) ? it.thread : []).slice(-6)) {
        trail.push({ item: i, by: e?.by, kind: e?.kind, text: String(e?.text ?? '').slice(0, 300) });
      }
    });
    return {
      result: {
        comments: visible.slice(-20).map((cm: any) => ({
          content: String(cm?.content ?? '').slice(0, 600),
          scope: String((cm as any)?.visibility ?? 'sales'),
          at: String(cm?.createdAt ?? ''),
        })),
        itemTrail: trail.slice(-20),
      },
    };
  }

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

/** Run one chat turn. OpenRouter-only; returns a config notice without keys. */
export async function chatTurn(
  env: Record<string, unknown>,
  store: EnquiryStore,
  me: MeResponse,
  enquiryId: string,
  message: string,
): Promise<ChatReply> {
  const gateway = getGateway(env);
  if (!gateway.health().some((h) => h.provider === 'openrouter')) {
    return { reply: 'AI chat is not configured (no OpenRouter key).', proposals: [] };
  }
  const ctx: Ctx = {
    env, store, me, enquiryId,
    restricted: isRestrictedViewer(me),
    privileged: canManageRates(me),
  };
  const key = threadKey(enquiryId, me);
  let history: ChatMessage[] = [];
  try {
    const cached = await cacheGet<ChatMessage[]>(key, THREAD_TTL_MS);
    if (Array.isArray(cached)) history = cached.slice(-MAX_HISTORY);
  } catch { /* ignore */ }

  const tools = toolDefs(ctx);
  const scopeNote = ctx.restricted
    ? 'The viewer is procurement: NEVER reveal client identity, contacts, or final rates/margins.'
    : ctx.privileged
      ? 'The viewer is management: full detail allowed.'
      : 'The viewer is sales: full pipeline detail, but margin internals (selected vendor, markup) stay hidden.';
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are the copilot for ONE sales enquiry (ID ${enquiryId}). Answer questions using the tools — never invent specs, rates, or statuses. Keep replies short. When the user wants something changed (post a note, fix a spec), call the propose_* tool so they can confirm; do not claim it is done. ${scopeNote}`,
    },
    ...history,
    { role: 'user', content: String(message ?? '').slice(0, 2000) },
  ];

  const chatModel = String((env as any)?.ENQUIRY_CHAT_MODEL ?? '').trim() || undefined;
  const proposals: ChatProposal[] = [];
  let reply = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await gateway.complete({
      messages, temperature: 0.2, maxTokens: 1200,
      provider: 'openrouter',
      ...(chatModel ? { model: chatModel } : {}),
      tools, toolChoice: 'auto',
    });
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
        messages.push({
          role: 'tool',
          content: JSON.stringify(out.result).slice(0, 3000),
          tool_call_id: tc.id,
        });
      }
      continue;
    }
    reply = res.content?.trim() || 'I can’t help with that — try asking about items, specs, prices in memory, or the ops thread.';
    break;
  }
  if (!reply) reply = 'I ran out of steps — try a narrower question.';

  const next: ChatMessage[] = [...history, { role: 'user' as const, content: String(message).slice(0, 2000) }, { role: 'assistant' as const, content: reply.slice(0, 2000) }].slice(-MAX_HISTORY);
  try {
    await cacheSet(key, next, THREAD_TTL_MS);
  } catch { /* best-effort */ }
  return { reply, proposals: proposals.slice(0, 5) };
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
    const r = await enquiryAddComment(store, me, enquiryId, {
      content: text,
      agentId: 0,
      visibility: action?.scope === 'procurement' ? 'procurement' : 'sales',
    });
    return { result: r, applied: r.status === 201 ? 'comment' : 'none' };
  }
  if (kind === 'spec_fix') {
    const idx = Math.max(0, Math.floor(Number(action?.itemIndex) || 0));
    const spec = String(action?.spec ?? '').trim().slice(0, 2000);
    if (!spec) return { result: { status: 400, body: { error: 'empty spec' } }, applied: 'none' };
    const existing: any = await store.getEnquiry(enquiryId).catch(() => null);
    if (!existing) return { result: { status: 404, body: { error: 'not found' } }, applied: 'none' };
    const items = Array.isArray(existing.items) ? [...existing.items] : [];
    if (!items[idx]) return { result: { status: 400, body: { error: 'bad item index' } }, applied: 'none' };
    items[idx] = { ...items[idx], spec };
    const r = await enquiryUpdate(store, me, enquiryId, { items });
    return { result: r, applied: r.status === 200 ? 'spec_fix' : 'none' };
  }
  return { result: { status: 400, body: { error: 'unknown action' } }, applied: 'none' };
}
