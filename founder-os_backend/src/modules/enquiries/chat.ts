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
import {
  enquiryAddComment, enquiryUpdate, canManageRates, isRestrictedViewer, stripMarginFields, canSeeProcurementRequests,
  type EnquiryResult,
} from './routes';
import type { EnquiryStore } from './store';
import type { MeResponse } from '../auth/types';
import { getProductDetail, getProductIndex, getRatesForProduct } from '../../automations/product-line/service';
import {
  MIN_QUOTE_CONFIDENCE, requiredChecklist, resolveProduct,
  salesSafeQuote, scoreRates,
  type MatchGuideRow, type MatchProduct, type MatchRate, type SalesQuote,
} from '../../automations/product-line/match';

const THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SpecQuestion {
  key: string;
  label: string;
  note: string;
  required: boolean;
  type: 'options' | 'text';
  options: string[];
}

export interface PriceTableRow {
  variation: string;
  markedPrice: number;
  unit: string;
  confidence: number;
  quoteAgeDays: number | null;
  moq: string | null;
  deliveryDays: number | null;
  best: boolean;
}

export interface ChatProposal {
  kind: 'comment' | 'spec_fix' | 'price_quote' | 'spec_form' | 'price_table';
  text?: string;
  scope?: 'sales' | 'procurement';
  itemIndex?: number;
  spec?: string;
  label: string;
  // price_quote only (vendor-blind by construction — see match.ts):
  productId?: string;
  productName?: string;
  markedPrice?: number;
  unit?: string;
  confidence?: number;
  quoteAgeDays?: number | null;
  moq?: string | null;
  deliveryDays?: number | null;
  // spec_form only:
  questions?: SpecQuestion[];
  // price_table only:
  rows?: PriceTableRow[];
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
    tools.push(
      {
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
      },
      {
        type: 'function',
        function: {
          name: 'find_price',
          description: 'Start a price lookup for one enquiry item: resolves the item (via its kypItem/category mapping) to a live catalogue product and returns its required spec checklist + the item spec on file. Call this first whenever the user asks for a price/rate.',
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
          name: 'ask_specs',
          description: 'Show the sales agent a stepped spec questionnaire (spec_form card) for the still-missing required specs of a catalogue product. Prefer this over asking spec questions in prose.',
          parameters: {
            type: 'object',
            properties: {
              productId: { type: 'string' },
              knownSpecs: { type: 'object', description: 'attrKey → value already collected (these are skipped)', additionalProperties: { type: 'string' } },
            },
            required: ['productId'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'quote_price',
          description: 'Look up past vendor rates for a catalogue product, score them against the collected specs, and draft a customer price (final price; cost basis and vendor hidden) for confirm. Below-confidence lookups route to procurement instead of quoting.',
          parameters: {
            type: 'object',
            properties: {
              productId: { type: 'string' },
              itemIndex: { type: 'number' },
              specs: { type: 'object', description: 'attrKey → collected spec value', additionalProperties: { type: 'string' } },
            },
            required: ['productId', 'itemIndex', 'specs'],
          },
        },
      },
    );
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
    case 'propose_comment':
      return r.error ? 'Comment draft failed' : 'Drafted a comment for confirm';
    case 'propose_spec_fix':
      return r.error ? 'Spec draft failed' : 'Drafted a spec fix for confirm';
    case 'find_price':
      return r.error ? 'Price lookup failed' : r.product ? `Matched ${r.product.name}` : 'No catalogue match';
    case 'ask_specs':
      return r.error ? 'Spec form failed' : 'Asked missing specs';
    case 'quote_price': {
      if ((r as any).error) return 'Price lookup failed';
      if ((r as any).routed === 'procurement') return 'Low confidence · routed to procurement';
      return typeof (r as any).markedPrice === 'number' ? `Quoted ₹${(r as any).markedPrice}` : 'Drafted a price for confirm';
    }
    default:
      return `Ran ${name}`;
  }
}

async function execTool(ctx: SalesCtx, name: string, args: Record<string, any>): Promise<{ result: unknown; proposals?: ChatProposal[] }> {
  const enquiry: any = await ctx.store.getEnquiry(ctx.enquiryId).catch(() => null);
  if (!enquiry) return { result: { error: 'enquiry not found' } };
  const view = ctx.privileged ? enquiry : stripMarginFields(enquiry, { hideRequests: !canSeeProcurementRequests(ctx.me) });

  /** Live catalogue rows adapted for match.ts (slim cached index — no full-table load). */
  const liveProducts = async (): Promise<MatchProduct[]> => {
    const rows = await getProductIndex().catch(() => []);
    return rows.map((p) => ({
      id: String(p.id),
      category: String(p.category ?? ''),
      name: String(p.name ?? ''),
      aliases: Array.isArray(p.aliases) ? p.aliases.map((s: any) => String(s)) : [],
      active: p.active !== false,
    }));
  };
  const liveGuide = async (productId: string): Promise<MatchGuideRow[]> => {
    const detail = await getProductDetail(String(productId)).catch(() => null);
    const rows = (((detail as any)?.guide ?? []) as any[]);
    return rows
      .filter((g: any) => g && g.active !== false && g.active !== 0)
      .map((g: any) => ({
        attrKey: String(g.attrKey ?? ''),
        question: String(g.question ?? ''),
        guideNote: g.guideNote != null ? String(g.guideNote) : null,
        sortOrder: Number(g.sortOrder ?? 0),
        isRequired: g.isRequired === true || g.isRequired === 1,
        active: true,
      }));
  };
  const liveRates = async (productId: string): Promise<MatchRate[]> => {
    const rows = await getRatesForProduct(String(productId)).catch(() => []);
    return rows.map((r: any) => ({
      id: String(r.id),
      productId: String(r.productId ?? ''),
      attrValues: (r.attrValues && typeof r.attrValues === 'object' ? r.attrValues : {}) as Record<string, string>,
      pricePerUnit: r.pricePerUnit != null ? Number(r.pricePerUnit) : null,
      unit: String(r.unit ?? ''),
      discountPercent: r.discountPercent != null ? Number(r.discountPercent) : null,
      moq: r.moq != null ? String(r.moq) : null,
      deliveryDays: r.deliveryDays != null ? Number(r.deliveryDays) : null,
      quotedAt: String(r.quotedAt ?? ''),
      active: r.active !== false,
    }));
  };
  /** Answer options mined from distinct past rate values (most-used first). */
  const specOptions = (rates: MatchRate[], key: string): string[] => {
    const counts = new Map<string, number>();
    for (const r of rates) {
      const v = String((r.attrValues ?? {})[key] ?? '').trim().slice(0, 120);
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v]) => v);
  };

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

  if (name === 'find_price') {
    if (ctx.restricted) return { result: { error: 'not permitted' } };
    const idx = Math.max(0, Math.floor(Number(args.itemIndex) || 0));
    const items = Array.isArray(enquiry.items) ? enquiry.items : [];
    const it = items[idx];
    if (!it) return { result: { error: `no item at index ${idx}` } };
    const kypItem = String((it as any)?.kypItem ?? '').slice(0, 120);
    const category = String((it as any)?.category ?? 'Uncategorized').slice(0, 120);
    const resolved = resolveProduct(await liveProducts(), kypItem || String((it as any)?.name ?? ''), category);
    if (!resolved) {
      return { result: { error: 'no catalogue match', kypItem, category, hint: 'tell the user this item is routed to procurement' } };
    }
    const required = requiredChecklist(await liveGuide(resolved.product.id));
    return {
      result: {
        itemIndex: idx,
        product: { id: resolved.product.id, name: resolved.product.name, category: resolved.product.category, exact: resolved.exact },
        required: required.map((g) => ({ key: g.attrKey, question: g.question, note: g.guideNote ?? '' })),
        itemSpec: String((it as any)?.spec ?? '').slice(0, 800),
        intakeMissing: Array.isArray((it as any)?.kypMissing) ? (it as any).kypMissing.slice(0, 10) : [],
      },
    };
  }

  if (name === 'ask_specs') {
    if (ctx.restricted) return { result: { error: 'not permitted' } };
    const pid = String(args.productId ?? '').trim();
    if (!pid) return { result: { error: 'missing productId' } };
    const product = (await liveProducts()).find((p) => p.id === pid);
    if (!product) return { result: { error: 'unknown product' } };
    const required = requiredChecklist(await liveGuide(pid));
    const known = (args.knownSpecs && typeof args.knownSpecs === 'object' ? args.knownSpecs : {}) as Record<string, unknown>;
    const rates = await liveRates(pid);
    const questions: SpecQuestion[] = [];
    for (const g of required) {
      if (String((known as any)[g.attrKey] ?? '').trim()) continue;
      const options = specOptions(rates, g.attrKey);
      questions.push({
        key: g.attrKey,
        label: g.question,
        note: g.guideNote ?? '',
        required: true,
        type: options.length >= 2 ? 'options' : 'text',
        options,
      });
    }
    if (questions.length === 0) return { result: { proposed: false, note: 'all required specs already known — call quote_price' } };
    const proposal: ChatProposal = {
      kind: 'spec_form', productId: pid, productName: product.name,
      questions, label: `Specs needed · ${product.name} (${questions.length})`,
    };
    return { result: { proposed: true, questions: questions.length }, proposals: [proposal] };
  }

  if (name === 'quote_price') {
    if (ctx.restricted) return { result: { error: 'not permitted' } };
    const pid = String(args.productId ?? '').trim();
    const idx = Math.max(0, Math.floor(Number(args.itemIndex) || 0));
    const specsIn = (args.specs && typeof args.specs === 'object' ? args.specs : {}) as Record<string, unknown>;
    const specs: Record<string, string> = {};
    for (const [k, v] of Object.entries(specsIn)) {
      const s = String(v ?? '').trim().slice(0, 200);
      if (s) specs[String(k)] = s;
    }
    if (!pid) return { result: { error: 'missing productId' } };
    const product = (await liveProducts()).find((p) => p.id === pid);
    if (!product) return { result: { error: 'unknown product' } };
    const required = requiredChecklist(await liveGuide(pid));
    const scored = scoreRates(await liveRates(pid), pid, specs, required);
    if (scored.length === 0) return { result: { error: 'no past rates for this product', routed: 'procurement' } };
    const best = scored[0];
    // Variation table: every scored past rate as a vendor-blind row so sales
    // can SEE all matching variations, not just the single best. The table is
    // view-only — one-tap apply stays gated on best-confidence below.
    const rows: PriceTableRow[] = scored.slice(0, 5).map((s, i) => {
      const q = salesSafeQuote(product, s, specs, required);
      const bits = Object.entries(s.rate.attrValues ?? {})
        .map(([, v]) => String(v ?? '').trim())
        .filter(Boolean)
        .filter((v, vi, arr) => arr.indexOf(v) === vi)
        .slice(0, 4);
      return {
        variation: bits.length > 0 ? bits.join(' · ').slice(0, 140) : `Quote ${i + 1}`,
        markedPrice: q.markedPrice,
        unit: q.unit,
        confidence: q.confidence,
        quoteAgeDays: q.quoteAgeDays,
        moq: q.moq,
        deliveryDays: q.deliveryDays,
        best: i === 0,
      };
    });
    const proposals: ChatProposal[] = [{
      kind: 'price_table', itemIndex: idx,
      productId: product.id, productName: product.name,
      rows, label: `Past prices · ${product.name} (${rows.length})`,
    }];
    if (best.confidence < MIN_QUOTE_CONFIDENCE) {
      return {
        result: { routed: 'procurement', confidence: best.confidence, variations: rows.length, note: 'below apply-confidence — table shown for reference only; tell the user this item is routed to procurement' },
        proposals,
      };
    }
    const quote: SalesQuote = salesSafeQuote(product, best, specs, required);
    const items = Array.isArray(enquiry.items) ? enquiry.items : [];
    const existing = String((items[idx] as any)?.spec ?? '');
    // Companion spec update: append only genuinely new "Question: value" lines.
    const fresh = quote.matchedSpecs
      .map((m) => `${m.question}: ${m.value}`)
      .filter((line) => line && !existing.toLowerCase().includes(line.toLowerCase().slice(0, 60)));
    proposals.push({
      kind: 'price_quote', itemIndex: idx,
      productId: product.id, productName: product.name,
      markedPrice: quote.markedPrice, unit: quote.unit, confidence: quote.confidence,
      quoteAgeDays: quote.quoteAgeDays, moq: quote.moq, deliveryDays: quote.deliveryDays,
      text: `${product.name} @ ₹${quote.markedPrice}${quote.unit ? `/${quote.unit}` : ''} — confidence ${quote.confidence}, quote ~${quote.quoteAgeDays ?? '?'}d old${quote.moq ? `, MOQ ${quote.moq}` : ''}${quote.deliveryDays != null ? `, ${quote.deliveryDays}d delivery` : ''}`,
      label: `Apply AI price · ${product.name}`,
    });
    if (fresh.length > 0) {
      proposals.push({
        kind: 'spec_fix', itemIndex: idx,
        spec: `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${fresh.join('\n')}`.slice(0, 2000),
        label: `Update Item ${idx + 1} spec with confirmed details`,
      });
    }
    return { result: { proposed: true, ...quote }, proposals };
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
    ? 'Reply in Hinglish (Hindi + English mix, Roman script) by default — sales-floor style, short & bazaar-friendly. Use Hindi words for common talk (bhai, kya chahiye, pic bhejo, size pucho) mixed with English specs/prices. Keep specs, grades, and prices in English as written.'
    : '';
  return `You are the sales agent's assistant for ONE sales enquiry (ID ${ctx.enquiryId}). Fill gaps, draft notes, fix specs, find prices, and push the enquiry toward price-ready. Answer using the tools — never invent specs, rates, or statuses. You have full KYP catalogue context: each item has category/kypItem/kypMissing/kypComplete and completeness counts — use them to answer "what's missing". Keep replies short. ${langNote} When the user asks to send, post, or write anything to the enquiry thread, draft it via propose_comment so the sales agent can confirm with one tap — do not claim it is done until confirmed. ${scopeNote} When you need to compare items or specs, use a markdown table. PRICE LOOKUPS: when the user asks for a price/rate on an item, always start with find_price (it resolves the item's kypItem mapping against the live catalogue), then ask_specs to collect missing specs through the stepped form (never interrogate in prose when the form can do it), then quote_price. Quote ONLY from tool output — never invent rates. Prices from quote_price are final customer prices. NEVER mention, hint at, or discuss markup, margin, vendor cost, or how a price was derived — in no world does the sales agent hear about markup. If asked where a price comes from, say it is based on recent matching vendor quotes. Vendor identity is hidden from you and the user by design — never guess, name, or hint at vendors. When a lookup routes to procurement, say so plainly and stop — do not quote.`;
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
  countKey: (ctx) => `enquiry:chat:count:${ctx.enquiryId}`,
  systemPrompt,
  toolDefs,
  execTool,
  activityLabel,
  modelEnvVar: 'ENQUIRY_CHAT_MODEL',
  defaultModel: 'agnes-3.0-flash',
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
