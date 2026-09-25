// chat.ts — per-enquiry sidebar copilot (edge-safe: fetch only, no Node deps).
//
// Sales department definition on the shared copilot engine (src/copilot):
// the agentic loop (Agnes-primary, max 6 steps) is reused verbatim — this
// module owns ONLY the sales tools, prompts, scope guards, and confirm path.
// Writes are NEVER applied here — the loop returns proposals; the frontend
// confirms and POSTs them to /chat/execute, which re-validates through
// EnquiryRoutes before touching storage.
import type { ToolDefinition } from '../../shared/ai-gateway';
import { cacheGet } from '../../shared/cache';
import { runTurn, streamTurn } from '../../copilot/engine';
import type { CopilotDef, CopilotExecResult, CopilotReply } from '../../copilot/types';
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

const THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

interface SalesCtx {
  env: Record<string, unknown>;
  store: EnquiryStore;
  me: MeResponse;
  enquiryId: string;
  restricted: boolean;
  privileged: boolean;
}

function toolDefs(ctx: SalesCtx): ToolDefinition[] {
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

async function execTool(ctx: SalesCtx, name: string, args: Record<string, any>): Promise<{ result: unknown; proposals?: ChatProposal[] }> {
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

function systemPrompt(ctx: SalesCtx): string {
  const scopeNote = ctx.restricted
    ? 'The viewer is procurement: NEVER reveal client identity, contacts, or final rates/margins.'
    : ctx.privileged
      ? 'The viewer is management: full detail allowed.'
      : 'The viewer is sales: full pipeline detail, but margin internals (selected vendor, markup) stay hidden.';
  const langNote = !ctx.restricted && !ctx.privileged
    ? 'Reply in Hinglish (Hindi + English mix, Roman script) by default — telecaller style, short & bazaar-friendly. Use Hindi words for common talk (bhai, kya chahiye, pic bhejo, size pucho) mixed with English specs/prices. Keep specs, grades, and prices in English as written.'
    : '';
  return `You are the sales staff helper — you work ON BEHALF of the BUI telecaller for ONE sales enquiry (ID ${ctx.enquiryId}). Act like their personal assistant: fill gaps, draft notes, fix specs, and push the enquiry toward price-ready. Answer using the tools — never invent specs, rates, or statuses. You have full KYP catalogue context: each item has category/kypItem/kypMissing/kypComplete and completeness counts — use them to answer "what's missing". Keep replies short. ${langNote} When the user asks to send, post, or write anything to the enquiry thread, draft it via propose_comment so the telecaller can confirm with one tap — do not claim it is done until confirmed. ${scopeNote} When you need to compare items or specs, use a markdown table.`;
}

/** Sales department definition for the shared engine. */
export const salesCopilotDef: CopilotDef<SalesCtx> = {
  id: 'sales-enquiry',
  checkAccess: (me: any) => (!me ? { status: 401, error: 'Authentication required' } : null),
  buildCtx: (env, _me, _extra) => {
    throw new Error('sales-enquiry turns run through /api/enquiries/:id/chat (store-bound), not the generic copilot route');
  },
  sessionKey: (ctx) => {
    const who = String((ctx.me as any)?.user?.email ?? (ctx.me as any)?.user?.id ?? 'anon').toLowerCase();
    return `enquiry:chat:${ctx.enquiryId}:${who}`;
  },
  countKey: (ctx) => `enquiry:chat:count:${ctx.enquiryId}`,
  systemPrompt,
  toolDefs,
  execTool,
  activityLabel,
  modelEnvVar: 'ENQUIRY_CHAT_MODEL',
  defaultModel: 'agnes-3.0-flash',
  emptyHint: 'I can’t help with that — try asking about items, specs, or missing details.',
};

/** Run one chat turn. Agnes-primary; returns a config notice without keys. */
export async function chatTurn(
  env: Record<string, unknown>,
  store: EnquiryStore,
  me: MeResponse,
  enquiryId: string,
  message: string,
): Promise<ChatReply> {
  const ctx: SalesCtx = {
    env, store, me, enquiryId,
    restricted: isRestrictedViewer(me),
    privileged: canManageRates(me),
  };
  const out: CopilotReply = await runTurn(env, salesCopilotDef, ctx, message);
  return { reply: out.reply, proposals: out.proposals as ChatProposal[], activity: out.activity };
}

/** Streaming variant — yields SSE events for live typing (same agentic loop). */
export async function* streamChatTurn(
  env: Record<string, unknown>,
  store: EnquiryStore,
  me: MeResponse,
  enquiryId: string,
  message: string,
): AsyncGenerator<{ type: string; data: any }, ChatReply, unknown> {
  const ctx: SalesCtx = {
    env, store, me, enquiryId,
    restricted: isRestrictedViewer(me),
    privileged: canManageRates(me),
  };
  const out: CopilotReply = yield* streamTurn(env, salesCopilotDef, ctx, message);
  return { reply: out.reply, proposals: out.proposals as ChatProposal[], activity: out.activity };
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

/** Engine-backed confirm path (lets the generic /execute route serve sales). */
export async function executeSalesProposal(
  ctx: SalesCtx,
  action: Record<string, any>,
): Promise<CopilotExecResult> {
  const { result, applied } = await executeProposal(ctx.store, ctx.me, ctx.enquiryId, action);
  return { result: { status: (result as any).status ?? 200, body: (result as any).body ?? {} }, applied };
}
