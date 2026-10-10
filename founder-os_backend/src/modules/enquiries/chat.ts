// chat.ts — per-enquiry sidebar copilot (edge-safe: fetch only, no Node deps).
//
// Sales department definition on the shared copilot engine (src/copilot):
// the agentic loop (Agnes-primary, max 6 steps) is reused verbatim — this
// module owns ONLY the sales def glue (prompt + registration + turn wrappers).
// Split (Phase-1): types → chat-types.ts · price session + spec helpers →
// chat-prices.ts · tool schemas + read/propose impls + router → chat-tools.ts
// · catalogue-price tool bodies → chat-tools-pricing.ts. This file re-exports
// the split so existing imports keep working.
// Writes are NEVER applied here — the loop returns proposals; the frontend
// confirms and POSTs them to /chat/execute, which re-validates through
// EnquiryRoutes before touching storage.
import { clearState, runTurn, streamTurn } from '../../copilot/engine';
import type { CopilotDef, CopilotExecResult, CopilotReply } from '../../copilot/types';
import {
  enquiryAddComment, enquiryUpdate, canManageRates, isRestrictedViewer,
  type EnquiryResult,
} from './routes';
import type { EnquiryStore } from './store';
import type { MeResponse } from '../auth/types';
import { THREAD_TTL_MS, clearPriceSession, priceWho } from './chat-prices';
import { activityLabel, execTool, toolDefs } from './chat-tools';
import type { ChatReply, SalesCtx } from './chat-types';

// Re-export the split (facade): `…/enquiries/chat` stays the single import
// path for sales-copilot shapes and tooling.
export * from './chat-types';
export { activityLabel, execTool, toolDefs } from './chat-tools';
export {
  dropVagueSpecs, filterChecklistSpecs, getItemState, itemIdx,
  loadPriceSession, priceWho, resolveSpecKeys, savePriceSession,
  THREAD_TTL_MS,
} from './chat-prices';

/** History key for the sales thread (mirrors salesCopilotDef.historyKey) —
 *  used by the /chat/execute route to record confirms in-thread. */
export function salesChatHistoryKey(enquiryId: string, me: any): string {
  const who = String((me as any)?.user?.email ?? (me as any)?.user?.id ?? 'anon').toLowerCase();
  return `enquiry:chat:hist2:${enquiryId}:${who}`;
}
export const SALES_CHAT_HISTORY_TTL_MS = THREAD_TTL_MS;

function systemPrompt(ctx: SalesCtx): string {
  const scopeNote = ctx.restricted
    ? 'The viewer is procurement: NEVER reveal client identity, contacts, or final rates/margins.'
    : ctx.privileged
      ? 'The viewer is management: full detail allowed.'
      : 'The viewer is sales: full pipeline detail, but margin internals (selected vendor, markup) stay hidden.';
  const langNote = !ctx.restricted && !ctx.privileged
    ? 'Reply in Hinglish (Hindi + English mix, Roman script) by default — sales-floor style, short & bazaar-friendly. Use Hindi words for common talk (bhai, kya chahiye, pic bhejo, size pucho) mixed with English specs/prices. Keep specs, grades, and prices in English as written.'
    : '';
  return `You are the sales agent's assistant for ONE sales enquiry (ID ${ctx.enquiryId}). Fill gaps, draft notes, fix specs, find prices, and push the enquiry toward price-ready. Answer using the tools — never invent specs, rates, or statuses. You have full KYP catalogue context: each item has category/kypItem/kypMissing/kypComplete and completeness counts — use them to answer "what's missing". Keep replies short. Items are numbered from 1 exactly as shown (Item 1, Item 2, …) — always speak and accept item numbers 1-based; there is no Item 0, never say "index". ${langNote} Prior turns AND the price session are recalled automatically every turn — never claim to be a new session or to lack earlier context. When the user asks to send, post, or write anything to the enquiry thread, draft it via propose_comment so the sales agent can confirm with one tap — do not claim it is done until confirmed. ${scopeNote} When you need to compare items or specs, use a markdown table. PRICE LOOKUPS: when the user asks for a price/rate on an item, always start with find_price (it recalls the saved product + collected specs for the item) — never re-ask specs that are already collected. When they ask the rate of ANYTHING not on this enquiry (or before items exist), use lookup_price straight away — NEVER tell them to add the item first; that lookup is view-only by design. RANKING RULE: find_price hands you EVERY past rate vendor-blind plus the client's verbatim spec — YOU rank them with language judgment (client words beat the deterministic confidence score when wording is loose or partial); tables likewise list every variation, never top-N. GROUNDING RULE: price/lookup results carry variationCount + specVerdict (which asked specs matched how many rows, with the stored values) — prose MUST state the row count and MUST answer "do you have X / is there a Y variation" from specVerdict and the table rows, never from confidence alone; a low-confidence caveat is not an absence — never claim a variation is missing when rows carry it. Dropped spec keys come back as droppedSpecs — re-pass those values under the right attrKey instead of giving up. BATCH RULE: when prices are asked for MULTIPLE items, use find_price_batch ONCE for all of them (never find_price in a loop), then one ask_specs per distinct product, then quote_price_batch ONCE for all of them (never quote_price in a loop). If find_price returns candidates, offer them to the user to pick one, then call find_price again with the picked productId. Then ask_specs to collect missing specs through the stepped form (never interrogate in prose when the form can do it), then quote_price. GUIDE-FIRST DISCIPLINE (founder order): a quote without specs is a guess — before ANY quote_price/quote_price_batch, check what is actually collected. Nothing usable (or only vague words like small / normal / standard / "regular size", which the tools strip and hand back as vague) → do NOT quote; call ask_specs (options are auto-mined from past quotes — offer them, don\'t open-quiz) or ask_question for the vague ones, then quote. Use milling-spares intelligence on unclear terminology: MS = mild steel, SS = stainless (SS304/SS316), GZ = gauge (lower number = thicker), jali = mesh/screen/sieve, JINDAL = steel brand (not the maker), elevator bucket size = width x projection x depth — interpret first, then CONFIRM via options rather than filing a guess. Quote only when specs suffice, or the instant the user says quote with what we have (skipSpecs:true) — flagging unconfirmed details as caveats on the quote. OTHER PRICES: when the user asks what was quoted before, what other prices exist, or the price history of an item, use list_enquiry_rates (the item\'s own stored rates, vendor-blind) — never guess from memory. QUESTIONS: whenever you need ANY answer, decision, or confirmation from the user — specs, choice between options, go-ahead, free-text detail — ask it through ask_specs (catalogue spec checklists) or ask_question (everything else), which render as answerable cards. NEVER leave a question buried in prose: prose questions have no answer box. Answers to ask_question cards are conversational — read them from history, never file them as specs. The user\'s spec-form answers arrive as the next message labeled by question text — file them via quote_price and continue. Quote ONLY from tool output — never invent rates. Prices from quote_price are final customer prices. NEVER mention, hint at, or discuss markup, margin, vendor cost, or how a price was derived — in no world does the sales agent hear about markup. If asked where a price comes from, say it is based on recent matching vendor quotes. Vendor identity is hidden from you and the user by design — never guess, name, or hint at vendors. PROCUREMENT RULE: offer the fetch-from-procurement button ONLY when the lookup found no usable price (no past rates, no matched product) — never alongside a quoted price. When routed, say so plainly and point at the button; when quoted with caveats, present the price plus exactly what is unconfirmed.`;
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
  // Rolling conversation memory (was missing — every turn started blank).
  // Distinct namespace from sessionKey (gateway sticky-pin, not chat text).
  // hist2: rotated after the markup-secrecy fix so pre-secrecy wording held
  // in older windows can never resurface in context.
  historyKey: (ctx) => {
    const who = String((ctx.me as any)?.user?.email ?? (ctx.me as any)?.user?.id ?? 'anon').toLowerCase();
    return `enquiry:chat:hist2:${ctx.enquiryId}:${who}`;
  },
  historyTtlMs: THREAD_TTL_MS,
  historyMaxMsgs: 100,
  // Wipes the price session on new-chat (mirrors intake's clearExtra/draft).
  clearExtra: async (ctx) => { await clearPriceSession(ctx.enquiryId, priceWho(ctx.me)); },
  countKey: (ctx) => `enquiry:chat:count:${ctx.enquiryId}`,
  systemPrompt,
  toolDefs,
  execTool,
  activityLabel,
  activityStartLabel: (name) => {
    switch (name) {
      case 'get_enquiry_summary': return 'Reading enquiry…';
      case 'propose_comment': return 'Drafting comment…';
      case 'propose_spec_fix': return 'Drafting spec fix…';
      case 'ask_question': return 'Preparing question…';
      case 'find_price': return 'Looking up price…';
      case 'lookup_price': return 'Looking up catalogue price…';
      case 'ask_specs': return 'Preparing spec form…';
      case 'quote_price': return 'Pricing…';
      case 'find_price_batch': return 'Matching batch…';
      case 'quote_price_batch': return 'Pricing batch…';
      case 'list_enquiry_rates': return 'Reading earlier prices…';
      default: return `Running ${name}…`;
    }
  },
  modelEnvVar: 'ENQUIRY_CHAT_MODEL',
  defaultModel: 'deepseek/deepseek-v4.1-flash',
  emptyHint: 'I can’t help with that — try asking about items, specs, missing details, or an AI price.',
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
  return { reply: out.reply, proposals: out.proposals as ChatReply['proposals'], activity: out.activity };
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
  return { reply: out.reply, proposals: out.proposals as ChatReply['proposals'], activity: out.activity };
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
  if (kind === 'price_quote') {
    const idx = Math.max(0, Math.floor(Number(action?.itemIndex) || 0));
    const price = Number(action?.markedPrice);
    if (!Number.isFinite(price) || price <= 0) return { result: { status: 400, body: { error: 'bad price' } }, applied: 'none' };
    try {
      const existing: any = await store.getEnquiry(enquiryId).catch(() => null);
      if (!existing) return { result: { status: 404, body: { error: 'not found' } }, applied: 'none' };
      const items = Array.isArray(existing.items) ? [...existing.items] : [];
      if (!items[idx]) return { result: { status: 400, body: { error: 'bad item index' } }, applied: 'none' };
      const conf = action?.confidence != null ? ` · conf ${action.confidence}` : '';
      const age = action?.quoteAgeDays != null ? ` · ~${action.quoteAgeDays}d old quote` : '';
      items[idx] = {
        ...items[idx],
        expectedRate: Math.round(price * 100) / 100,
        expectedNote: `AI price · ${String(action?.productName ?? 'catalogue').slice(0, 120)}${conf}${age}`.slice(0, 500),
      };
      const r = await enquiryUpdate(store, me, enquiryId, { items });
      return { result: r, applied: r.status === 200 ? 'price_quote' : 'none' };
    } catch (e: any) {
      return { result: { status: 500, body: { error: String(e?.message ?? 'price apply failed').slice(0, 300) } }, applied: 'none' };
    }
  }
  if (kind === 'fetch_procurement') {
    // Telecaller fallback: flag the item for procurement (ratesRequested).
    // Offered ONLY when the lookup found no usable price (needsProcurement).
    const idx = Math.max(0, Math.floor(Number(action?.itemIndex) || 0));
    try {
      const existing: any = await store.getEnquiry(enquiryId).catch(() => null);
      if (!existing) return { result: { status: 404, body: { error: 'not found' } }, applied: 'none' };
      const items = Array.isArray(existing.items) ? [...existing.items] : [];
      if (!items[idx]) return { result: { status: 400, body: { error: 'bad item index' } }, applied: 'none' };
      items[idx] = { ...items[idx], ratesRequested: 'AI chat · telecaller request', ratesRequestedAt: new Date().toISOString() };
      const r = await enquiryUpdate(store, me, enquiryId, { items });
      return { result: r, applied: r.status === 200 ? 'fetch_procurement' : 'none' };
    } catch (e: any) {
      return { result: { status: 500, body: { error: String(e?.message ?? 'procurement request failed').slice(0, 300) } }, applied: 'none' };
    }
  }
  return { result: { status: 400, body: { error: 'unknown action' } }, applied: 'none' };
}

/** New-chat: wipe rolling history + price session (mirrors the copilot clear route). */
export async function clearSalesChat(
  env: Record<string, unknown>,
  store: EnquiryStore,
  me: MeResponse,
  enquiryId: string,
): Promise<void> {
  const ctx: SalesCtx = {
    env, store, me, enquiryId,
    restricted: isRestrictedViewer(me),
    privileged: canManageRates(me),
  };
  await clearState(salesCopilotDef, ctx);
}

/** Engine-backed confirm path (lets the generic /execute route serve sales). */
export async function executeSalesProposal(
  ctx: SalesCtx,
  action: Record<string, any>,
): Promise<CopilotExecResult> {
  const { result, applied } = await executeProposal(ctx.store, ctx.me, ctx.enquiryId, action);
  return { result: { status: (result as any).status ?? 200, body: (result as any).body ?? {} }, applied };
}
