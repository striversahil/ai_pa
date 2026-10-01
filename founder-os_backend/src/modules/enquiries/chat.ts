// chat.ts — per-enquiry sidebar copilot (edge-safe: fetch only, no Node deps).
//
// Sales department definition on the shared copilot engine (src/copilot):
// the agentic loop (Agnes-primary, max 6 steps) is reused verbatim — this
// module owns ONLY the sales tools, prompts, scope guards, and confirm path.
// Writes are NEVER applied here — the loop returns proposals; the frontend
// confirms and POSTs them to /chat/execute, which re-validates through
// EnquiryRoutes before touching storage.
import type { ToolDefinition } from '../../shared/ai-gateway';
import { cacheDel, cacheGet, cacheSet } from '../../shared/cache';
import { clearState, runTurn, streamTurn } from '../../copilot/engine';
import type { CopilotDef, CopilotExecResult, CopilotReply } from '../../copilot/types';
import {
  enquiryAddComment, enquiryUpdate, canManageRates, isRestrictedViewer, stripMarginFields, canSeeProcurementRequests,
  type EnquiryResult,
} from './routes';
import type { EnquiryStore } from './store';
import type { MeResponse } from '../auth/types';
import { getProductDetail, getProductIndex, getRatesForProduct } from '../../automations/product-line/service';
import {
  MIN_QUOTE_CONFIDENCE, rankProducts, requiredChecklist, resolveProduct,
  salesSafeQuote, scoreRates,
  type MatchGuideRow, type MatchProduct, type MatchRate, type SalesQuote,
} from '../../automations/product-line/match';

const THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SpecQuestion {
  key: string;
  label: string;
  note: string;
  required: boolean;
  /** options = MCQ single-pick · multiselect = MSQ multi-pick · number/date/text */
  type: 'options' | 'multiselect' | 'text' | 'number' | 'date';
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
  /** 1-based item number + name (set for batch tables spanning items). */
  itemIndex?: number;
  itemName?: string;
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

// ── Price session (mirrors the intake draft method) ─────────────────────
// Structured per-item pricing state (resolved product + collected specs) in
// KV, 30-min TTL — the same method as product-line intake's draft. Chat
// history prose is lossy for structured data (which specs were answered,
// which product was resolved); without this the model drops specs between
// turns and re-asks. find_price writes it, ask_specs/quote_price merge it.
const PRICE_SESSION_TTL_MS = 30 * 60 * 1000;

interface PriceItemState {
  productId?: string;
  productName?: string;
  specs: Record<string, string>;
}

interface PriceSession {
  /** Per-item state, keyed by INTERNAL 0-based index. */
  items: Record<string, PriceItemState>;
  activeItem?: number;
}

function blankItemState(): PriceItemState {
  return { specs: {} };
}

function getItemState(s: PriceSession, idx: number): PriceItemState {
  const st = (s.items ?? {})[String(idx)];
  return st && typeof st === 'object' ? { productId: st.productId, productName: st.productName, specs: { ...(st.specs ?? {}) } } : blankItemState();
}

function priceWho(me: any): string {
  return String(me?.user?.email ?? me?.user?.id ?? 'anon').toLowerCase();
}

function priceSessionKey(enquiryId: string, who: string): string {
  return `enquiry:price:${enquiryId}:${who}`;
}

async function loadPriceSession(enquiryId: string, who: string): Promise<PriceSession> {
  try {
    const s = await cacheGet<PriceSession>(priceSessionKey(enquiryId, who), PRICE_SESSION_TTL_MS);
    if (s && typeof s === 'object') {
      // Migrate v1 shape ({itemIndex, productId, productName, specs}) → v2 map.
      if (!(s as any).items && ((s as any).productId !== undefined || (s as any).itemIndex !== undefined)) {
        const idx = Number((s as any).itemIndex ?? 0);
        return {
          items: { [String(idx)]: { productId: (s as any).productId, productName: (s as any).productName, specs: { ...(((s as any).specs ?? {}) as Record<string, string>) } } },
          activeItem: idx,
        };
      }
      return { items: { ...((s as any).items ?? {}) }, activeItem: (s as any).activeItem };
    }
  } catch { /* ignore */ }
  return { items: {} };
}

async function savePriceSession(enquiryId: string, who: string, s: PriceSession): Promise<void> {
  try { await cacheSet(priceSessionKey(enquiryId, who), s, PRICE_SESSION_TTL_MS); } catch { /* ignore */ }
}

async function clearPriceSession(enquiryId: string, who: string): Promise<void> {
  try { await cacheDel(priceSessionKey(enquiryId, who)); } catch { /* ignore */ }
}

/** SpecForm answers arrive labeled by raw question text, not attrKey —
//  resolve either form to the storage key against the live checklist. */
function normSpecKey(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Price sessions hold ONLY catalogue checklist specs (attrKeys). Generic
 *  ask_question answers share the same reply channel — drop anything that
 *  is not a known checklist key so conversational answers can never pollute
 *  pricing, spec_fix writes, or future scoring. */
function filterChecklistSpecs(
  specs: Record<string, string>,
  required: { attrKey: string }[],
): Record<string, string> {
  const keep = new Set(required.map((g) => g.attrKey));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(specs ?? {})) {
    if (keep.has(String(k))) out[String(k)] = v;
  }
  return out;
}

function resolveSpecKeys(
  specs: Record<string, string>,
  required: { attrKey: string; question: string }[],
): Record<string, string> {
  const byKey = new Map(required.map((g) => [normSpecKey(g.attrKey), g.attrKey]));
  const byQ = new Map(required.map((g) => [normSpecKey(g.question), g.attrKey]));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(specs ?? {})) {
    const val = String(v ?? '').trim().slice(0, 200);
    if (!val) continue;
    const nk = normSpecKey(k);
    if (!nk) continue;
    let hit = byKey.get(nk) ?? byQ.get(nk);
    if (!hit) {
      // loose fallback: key contained in (or containing) a question
      for (const g of required) {
        const nq = normSpecKey(g.question);
        if (nq && (nq.includes(nk) || nk.includes(nq))) { hit = g.attrKey; break; }
      }
    }
    out[hit ?? String(k)] = val;
  }
  return out;
}

/** Model-facing item numbers are 1-based (Item 1, Item 2 — exactly as the
 *  dashboard shows them). There is no Item 0. Convert to the internal 0-based
 *  array index here, in ONE place — proposals/actions keep 0-based indexes
 *  internally, but every number the MODEL sees or sends is 1-based. */
function itemIdx(args: Record<string, any>, count: number): { idx: number; num: number } | { error: string } {
  const num = Math.floor(Number(args.itemIndex) || 0);
  if (!(num >= 1) || num > count) {
    return { error: `no Item ${Math.floor(Number(args.itemIndex) || 0)} — this enquiry has ${count} item${count === 1 ? '' : 's'} (use Item 1–${count})` };
  }
  return { idx: num - 1, num };
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
    {
      type: 'function',
      function: {
        name: 'ask_question',
        description: 'Ask the user ANY question (choice, confirmation, free-text detail — anything that is not a catalogue spec checklist) as an answerable card. ALWAYS use this instead of asking in prose: prose questions have no answer box. Answers arrive as the next message; read them from history.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short card heading (not "Specs needed" — that title is reserved for spec checklists)' },
            questions: {
              type: 'array',
              description: 'Max 6 questions',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  label: { type: 'string' },
                  type: { type: 'string', description: "'options' (MCQ one-pick) or 'multiselect' (MSQ multi-pick, needs 2+ options) or 'number' or 'date' or 'text'" },
                  options: { type: 'array', items: { type: 'string' } },
                },
                required: ['key', 'label'],
              },
            },
          },
          required: ['title', 'questions'],
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
              itemIndex: { type: 'number', description: '1-based item number as shown in the chat (Item 1, Item 2, …)' },
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
          description: 'Start a price lookup for one enquiry item: resolves the item (via its kypItem/category mapping) to a live catalogue product and returns its required spec checklist + the item spec on file. Call this first whenever the user asks for a price/rate. If a previous call returned candidates, pass the user-picked productId to lock it in.',
          parameters: {
            type: 'object',
            properties: {
              itemIndex: { type: 'number', description: '1-based item number as shown in the chat (Item 1, Item 2, …)' },
              productId: { type: 'string', description: 'Catalogue product id picked by the user from a previous candidates list (skips matching)' },
            },
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
              itemIndex: { type: 'number', description: '1-based item number as shown in the chat (Item 1, Item 2, …)' },
              specs: { type: 'object', description: 'attrKey → collected spec value', additionalProperties: { type: 'string' } },
            },
            required: ['productId', 'itemIndex', 'specs'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'find_price_batch',
          description: 'BATCH price-lookup starter for MULTIPLE items in ONE call — use this (never find_price in a loop) whenever the user asks prices for several items. Resolves each item to a catalogue product, saves the price session, and returns per-item product + spec counts. Follow with one ask_specs per distinct product, then a single quote_price_batch.',
          parameters: {
            type: 'object',
            properties: {
              itemIndexes: { type: 'array', description: '1-based item numbers as shown in the chat (max 20)', items: { type: 'number' } },
            },
            required: ['itemIndexes'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'quote_price_batch',
          description: 'BATCH quoting for MULTIPLE items in ONE call — use this (never quote_price in a loop) after the specs are collected. Scores every item against its resolved product and returns per-item prices plus ONE combined price table (per-row Apply in the UI). Items without a resolved product or past rates route to procurement individually.',
          parameters: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                description: 'Max 20. specs may be omitted when already collected (session).',
                items: {
                  type: 'object',
                  properties: {
                    itemIndex: { type: 'number', description: '1-based item number' },
                    specs: { type: 'object', description: 'attrKey → collected spec value', additionalProperties: { type: 'string' } },
                  },
                  required: ['itemIndex'],
                },
              },
            },
            required: ['items'],
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
    case 'ask_question':
      return r.error ? 'Question failed' : `Asked ${typeof (r as any).questions === 'number' ? (r as any).questions : 'a'} question${(r as any).questions === 1 ? '' : 's'}`;
    case 'find_price': {
      if (r.error && Array.isArray((r as any).candidates)) return `Offered ${(r as any).candidates.length} picks`;
      return r.error ? 'Price lookup failed' : r.product ? `Matched ${r.product.name}` : 'No catalogue match';
    }
    case 'ask_specs':
      return r.error ? 'Spec form failed' : 'Asked missing specs';
    case 'quote_price': {
      if ((r as any).error) return 'Price lookup failed';
      if ((r as any).routed === 'procurement') return 'Low confidence · routed to procurement';
      return typeof (r as any).markedPrice === 'number' ? `Quoted ₹${(r as any).markedPrice}` : 'Drafted a price for confirm';
    }
    case 'find_price_batch': {
      const items = Array.isArray((r as any).items) ? (r as any).items : [];
      const matched = items.filter((it: any) => it && it.product).length;
      return (r as any).error ? 'Batch lookup failed' : `Batch matched ${matched}/${items.length} items`;
    }
    case 'quote_price_batch': {
      const items = Array.isArray((r as any).items) ? (r as any).items : [];
      const priced = items.filter((it: any) => it && typeof it.markedPrice === 'number').length;
      return (r as any).error ? 'Batch quote failed' : `Batch priced ${priced}/${items.length} items`;
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
      // 1-based: the model only ever sees/sends Item 1, Item 2, … (no Item 0).
      index: i + 1,
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
      const kypMissingAll = items.flatMap((it: any) => Array.isArray(it.kypMissing) ? it.kypMissing.map((m: string) => `Item ${it.index} — ${m}`) : []);
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
    const items0 = Array.isArray(enquiry.items) ? enquiry.items : [];
    const parsed0 = itemIdx(args, items0.length);
    if ('error' in parsed0) return { result: { error: parsed0.error } };
    const idx = parsed0.idx;
    const spec = String(args.spec ?? '').trim().slice(0, 2000);
    if (!spec) return { result: { error: 'empty spec' } };
    const proposal: ChatProposal = { kind: 'spec_fix', itemIndex: idx, spec, label: `Fix Item ${parsed0.num} spec` };
    return { result: { proposed: true }, proposals: [proposal] };
  }

  if (name === 'find_price') {
    if (ctx.restricted) return { result: { error: 'not permitted' } };
    const items = Array.isArray(enquiry.items) ? enquiry.items : [];
    const parsed = itemIdx(args, items.length);
    if ('error' in parsed) return { result: { error: parsed.error } };
    const idx = parsed.idx;
    const it = items[idx];
    if (!it) return { result: { error: `no Item ${parsed.num}` } };
    const kypItem = String((it as any)?.kypItem ?? '').slice(0, 120);
    const category = String((it as any)?.category ?? 'Uncategorized').slice(0, 120);
    const products = await liveProducts();
    // User-picked productId (from a previous candidates list) skips matching.
    const pickedId = String(args.productId ?? '').trim();
    const picked = pickedId ? products.find((p) => p.id === pickedId && p.active !== false) : null;
    if (pickedId && !picked) return { result: { error: 'unknown productId — ask the user to pick from the candidates list again' } };
    const resolved = picked
      ? { product: picked, exact: true }
      : resolveProduct(products, kypItem || String((it as any)?.name ?? ''), category);
    if (!resolved) {
      // Candidate fallback (mirrors intake): loose-bar top hits for the model
      // to offer the user — full catalogue never enters the prompt (20K-safe).
      // Loose here is safe: quoting still needs user pick + specs + the
      // confidence gate. Deterministic tiers miss typos/spec-only lines;
      // those still route out.
      const cands = rankProducts(products, `${kypItem} ${String((it as any)?.name ?? '')} ${category}`, 5, 1, 0.2)
        .map((c) => ({ id: c.product.id, name: c.product.name, category: c.product.category }));
      if (cands.length > 0) {
        return {
          result: {
            error: 'no confident catalogue match', kypItem, category,
            candidates: cands,
            hint: 'offer these candidates to the user to pick one, then call find_price again with the picked productId — or route to procurement if none fit',
          },
        };
      }
      return { result: { error: 'no catalogue match', kypItem, category, hint: 'tell the user this item is routed to procurement' } };
    }
    const required = requiredChecklist(await liveGuide(resolved.product.id));
    // Price session (per-item map): same item+product → keep collected specs; else reset.
    const who = priceWho(ctx.me);
    const prev = await loadPriceSession(ctx.enquiryId, who);
    const prevSt = getItemState(prev, idx);
    const kept = prevSt.productId === resolved.product.id ? prevSt.specs : {};
    const session: PriceSession = {
      items: { ...(prev.items ?? {}), [String(idx)]: { productId: resolved.product.id, productName: resolved.product.name, specs: kept } },
      activeItem: idx,
    };
    await savePriceSession(ctx.enquiryId, who, session);
    return {
      result: {
        itemIndex: parsed.num,
        product: { id: resolved.product.id, name: resolved.product.name, category: resolved.product.category, exact: resolved.exact },
        required: required.map((g) => ({ key: g.attrKey, question: g.question, note: g.guideNote ?? '' })),
        itemSpec: String((it as any)?.spec ?? '').slice(0, 800),
        intakeMissing: Array.isArray((it as any)?.kypMissing) ? (it as any).kypMissing.slice(0, 10) : [],
        sessionSpecs: kept,
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
    // Merge session specs (prior turns) with freshly passed knownSpecs.
    // ask_specs is per-product: merge across every session item on this product.
    const who = priceWho(ctx.me);
    const prev = await loadPriceSession(ctx.enquiryId, who);
    const sessionSpecs: Record<string, unknown> = {};
    for (const st of Object.values(prev.items ?? {})) {
      if ((st as PriceItemState)?.productId === pid) Object.assign(sessionSpecs, (st as PriceItemState).specs ?? {});
    }
    const knownRaw = { ...sessionSpecs, ...((args.knownSpecs && typeof args.knownSpecs === 'object' ? args.knownSpecs : {}) as Record<string, unknown>) };
    const known = filterChecklistSpecs(resolveSpecKeys(knownRaw as Record<string, string>, required.map((g) => ({ attrKey: g.attrKey, question: g.question }))), required);
    // Write merged known-specs back to every session item on this product.
    const nextItems: Record<string, PriceItemState> = { ...(prev.items ?? {}) };
    let touchedItem = false;
    for (const [k, st] of Object.entries(nextItems)) {
      if ((st as PriceItemState)?.productId === pid) {
        nextItems[k] = { ...(st as PriceItemState), specs: { ...((st as PriceItemState).specs ?? {}), ...known } };
        touchedItem = true;
      }
    }
    if (!touchedItem && prev.activeItem !== undefined) {
      const cur = getItemState(prev, prev.activeItem);
      nextItems[String(prev.activeItem)] = { productId: pid, productName: product.name, specs: { ...cur.specs, ...known } };
    }
    await savePriceSession(ctx.enquiryId, who, { items: nextItems, activeItem: prev.activeItem });
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

  if (name === 'ask_question') {
    const title = String(args.title ?? 'Quick question').slice(0, 120) || 'Quick question';
    const rawQ = Array.isArray(args.questions) ? args.questions : [];
    const questions: SpecQuestion[] = [];
    for (const q of rawQ.slice(0, 6)) {
      const label = String((q as any)?.label ?? '').trim().slice(0, 300);
      if (!label) continue;
      const opts = Array.isArray((q as any)?.options) ? (q as any).options.map((o: any) => String(o ?? '').trim()).filter(Boolean).slice(0, 8) : [];
      const want = String((q as any)?.type ?? 'text');
      // MCQ needs 2+ options, MSQ needs 2+ options — anything else degrades
      // to a text answer box rather than erroring.
      const type = (want === 'options' || want === 'multiselect') && opts.length >= 2
        ? (want as 'options' | 'multiselect')
        : want === 'number' ? 'number'
        : want === 'date' ? 'date'
        : 'text';
      questions.push({
        key: String((q as any)?.key ?? label).slice(0, 80),
        label,
        note: '',
        required: (q as any)?.required !== false,
        type,
        options: opts,
      });
    }
    if (questions.length === 0) return { result: { error: 'no valid questions given' } };
    const proposal: ChatProposal = { kind: 'spec_form', questions, productName: title, label: `${title} (${questions.length})` };
    return { result: { asked: true, questions: questions.length }, proposals: [proposal] };
  }

  if (name === 'quote_price') {
    if (ctx.restricted) return { result: { error: 'not permitted' } };
    const pid = String(args.productId ?? '').trim();
    const itemsQ = Array.isArray(enquiry.items) ? enquiry.items : [];
    const parsedQ = itemIdx(args, itemsQ.length);
    if ('error' in parsedQ) return { result: { error: parsedQ.error } };
    const idx = parsedQ.idx;
    const product = (await liveProducts()).find((p) => p.id === pid);
    if (!product) return { result: { error: 'unknown product' } };
    const required = requiredChecklist(await liveGuide(pid));
    // Merge order: session (prior turns) < explicit args (this turn wins).
    // Question-labeled answers (from the spec form) resolve to attrKeys.
    const who = priceWho(ctx.me);
    const prev = await loadPriceSession(ctx.enquiryId, who);
    const prevSt = getItemState(prev, idx);
    const specsIn = (args.specs && typeof args.specs === 'object' ? args.specs : {}) as Record<string, unknown>;
    const merged = filterChecklistSpecs(resolveSpecKeys(
      { ...((prevSt.productId === pid ? prevSt.specs : {}) as Record<string, string>), ...(specsIn as Record<string, string>) },
      required.map((g) => ({ attrKey: g.attrKey, question: g.question })),
    ), required);
    const specs: Record<string, string> = {};
    for (const [k, v] of Object.entries(merged)) {
      const s = String(v ?? '').trim().slice(0, 200);
      if (s) specs[String(k)] = s;
    }
    await savePriceSession(ctx.enquiryId, who, {
      items: { ...(prev.items ?? {}), [String(idx)]: { productId: pid, productName: product.name, specs } },
      activeItem: idx,
    });
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
        itemIndex: parsedQ.num,
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

  if (name === 'find_price_batch') {
    if (ctx.restricted) return { result: { error: 'not permitted' } };
    const rawList = Array.isArray(args.itemIndexes) ? args.itemIndexes : [];
    const nums = [...new Set(rawList.map((n: any) => Math.floor(Number(n) || 0)).filter((n: number) => n >= 1))].slice(0, 20);
    if (nums.length === 0) return { result: { error: 'no valid item numbers — use Item 1–N as shown in the chat' } };
    const allItems = Array.isArray(enquiry.items) ? enquiry.items : [];
    const products = await liveProducts();
    const who = priceWho(ctx.me);
    const prev = await loadPriceSession(ctx.enquiryId, who);
    const nextItems: Record<string, PriceItemState> = { ...(prev.items ?? {}) };
    const out: any[] = [];
    for (const num of nums) {
      if (num > allItems.length) {
        out.push({ itemIndex: num, error: `no Item ${num} — this enquiry has ${allItems.length} item${allItems.length === 1 ? '' : 's'}` });
        continue;
      }
      const idx = num - 1;
      const it = allItems[idx];
      const kypItem = String((it as any)?.kypItem ?? '').slice(0, 120);
      const category = String((it as any)?.category ?? 'Uncategorized').slice(0, 120);
      const resolved = resolveProduct(products, kypItem || String((it as any)?.name ?? ''), category);
      if (!resolved) {
        const cands = rankProducts(products, `${kypItem} ${String((it as any)?.name ?? '')} ${category}`, 3, 1, 0.2)
          .map((c) => ({ id: c.product.id, name: c.product.name }));
        out.push({ itemIndex: num, error: 'no confident catalogue match', candidates: cands });
        continue;
      }
      const required = requiredChecklist(await liveGuide(resolved.product.id));
      const prevSt = getItemState(prev, idx);
      const kept = prevSt.productId === resolved.product.id ? prevSt.specs : {};
      nextItems[String(idx)] = { productId: resolved.product.id, productName: resolved.product.name, specs: kept };
      const knownCount = Object.keys(kept).length;
      out.push({
        itemIndex: num,
        product: { id: resolved.product.id, name: resolved.product.name, category: resolved.product.category, exact: resolved.exact },
        requiredSpecs: required.length,
        knownSpecs: knownCount,
      });
    }
    await savePriceSession(ctx.enquiryId, who, { items: nextItems, activeItem: nums.length ? nums[nums.length - 1] - 1 : prev.activeItem });
    return { result: { items: out } };
  }

  if (name === 'quote_price_batch') {
    if (ctx.restricted) return { result: { error: 'not permitted' } };
    const rawList = Array.isArray(args.items) ? args.items : [];
    if (rawList.length === 0) return { result: { error: 'no items given' } };
    const allItems = Array.isArray(enquiry.items) ? enquiry.items : [];
    const products = await liveProducts();
    const who = priceWho(ctx.me);
    const prev = await loadPriceSession(ctx.enquiryId, who);
    const nextItems: Record<string, PriceItemState> = { ...(prev.items ?? {}) };
    const out: any[] = [];
    const rows: PriceTableRow[] = [];
    for (const entry of rawList.slice(0, 20)) {
      const num = Math.floor(Number((entry as any)?.itemIndex) || 0);
      if (!(num >= 1) || num > allItems.length) {
        out.push({ itemIndex: num || 0, error: `no Item ${num} — use Item 1–${allItems.length}` });
        continue;
      }
      const idx = num - 1;
      const st = getItemState({ items: nextItems, activeItem: prev.activeItem }, idx);
      const product = products.find((p) => p.id === st.productId && p.active !== false);
      if (!product) {
        out.push({ itemIndex: num, routed: 'procurement', note: 'no resolved product — run find_price_batch first' });
        continue;
      }
      const required = requiredChecklist(await liveGuide(product.id));
      const entrySpecs = ((entry as any)?.specs && typeof (entry as any).specs === 'object' ? (entry as any).specs : {}) as Record<string, unknown>;
      const merged = filterChecklistSpecs(resolveSpecKeys(
        { ...(st.specs ?? {}), ...(entrySpecs as Record<string, string>) },
        required.map((g) => ({ attrKey: g.attrKey, question: g.question })),
      ), required);
      const specs: Record<string, string> = {};
      for (const [k, v] of Object.entries(merged)) {
        const s = String(v ?? '').trim().slice(0, 200);
        if (s) specs[String(k)] = s;
      }
      nextItems[String(idx)] = { productId: product.id, productName: product.name, specs };
      const scored = scoreRates(await liveRates(product.id), product.id, specs, required);
      const itemName = String((allItems[idx] as any)?.name ?? `Item ${num}`).slice(0, 80);
      if (scored.length === 0) {
        out.push({ itemIndex: num, product: product.name, routed: 'procurement', note: 'no past rates for this product' });
        continue;
      }
      const best = scored[0];
      if (best.confidence < MIN_QUOTE_CONFIDENCE) {
        out.push({ itemIndex: num, product: product.name, routed: 'procurement', confidence: best.confidence, note: 'below confidence — manual procurement owns this item' });
        continue;
      }
      const quote = salesSafeQuote(product, best, specs, required);
      out.push({
        itemIndex: num, productId: product.id, productName: product.name,
        markedPrice: quote.markedPrice, unit: quote.unit, confidence: quote.confidence,
        quoteAgeDays: quote.quoteAgeDays, moq: quote.moq, deliveryDays: quote.deliveryDays,
      });
      // Top variation per item lands in the combined table (per-row Apply).
      const top = scored[0];
      const tq = salesSafeQuote(product, top, specs, required);
      const bits = Object.entries(top.rate.attrValues ?? {})
        .map(([, v]) => String(v ?? '').trim())
        .filter(Boolean)
        .filter((v, vi, arr) => arr.indexOf(v) === vi)
        .slice(0, 3);
      rows.push({
        variation: bits.length > 0 ? bits.join(' · ').slice(0, 120) : product.name,
        markedPrice: tq.markedPrice, unit: tq.unit, confidence: tq.confidence,
        quoteAgeDays: tq.quoteAgeDays, moq: tq.moq, deliveryDays: tq.deliveryDays,
        best: true, itemIndex: num, itemName,
      });
    }
    await savePriceSession(ctx.enquiryId, who, { items: nextItems, activeItem: prev.activeItem });
    const proposals: ChatProposal[] = rows.length > 0 ? [{
      kind: 'price_table',
      productName: 'Batch prices',
      rows, label: `Batch prices · ${out.filter((o) => typeof o.markedPrice === 'number').length}/${out.length} items priced`,
    }] : [];
    return { result: { items: out, proposed: rows.length > 0 }, proposals };
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
  return `You are the sales agent's assistant for ONE sales enquiry (ID ${ctx.enquiryId}). Fill gaps, draft notes, fix specs, find prices, and push the enquiry toward price-ready. Answer using the tools — never invent specs, rates, or statuses. You have full KYP catalogue context: each item has category/kypItem/kypMissing/kypComplete and completeness counts — use them to answer "what's missing". Keep replies short. Items are numbered from 1 exactly as shown (Item 1, Item 2, …) — always speak and accept item numbers 1-based; there is no Item 0, never say "index". ${langNote} Prior turns AND the price session are recalled automatically every turn — never claim to be a new session or to lack earlier context. When the user asks to send, post, or write anything to the enquiry thread, draft it via propose_comment so the sales agent can confirm with one tap — do not claim it is done until confirmed. ${scopeNote} When you need to compare items or specs, use a markdown table. PRICE LOOKUPS: when the user asks for a price/rate on an item, always start with find_price (it recalls the saved product + collected specs for the item) — never re-ask specs that are already collected. BATCH RULE: when prices are asked for MULTIPLE items, use find_price_batch ONCE for all of them (never find_price in a loop), then one ask_specs per distinct product, then quote_price_batch ONCE for all of them (never quote_price in a loop). If find_price returns candidates, offer them to the user to pick one, then call find_price again with the picked productId. Then ask_specs to collect missing specs through the stepped form (never interrogate in prose when the form can do it), then quote_price. QUESTIONS: whenever you need ANY answer, decision, or confirmation from the user — specs, choice between options, go-ahead, free-text detail — ask it through ask_specs (catalogue spec checklists) or ask_question (everything else), which render as answerable cards. NEVER leave a question buried in prose: prose questions have no answer box. Answers to ask_question cards are conversational — read them from history, never file them as specs. The user's spec-form answers arrive as the next message labeled by question text — file them via quote_price and continue. Quote ONLY from tool output — never invent rates. Prices from quote_price are final customer prices. NEVER mention, hint at, or discuss markup, margin, vendor cost, or how a price was derived — in no world does the sales agent hear about markup. If asked where a price comes from, say it is based on recent matching vendor quotes. Vendor identity is hidden from you and the user by design — never guess, name, or hint at vendors. When a lookup routes to procurement, say so plainly and stop — do not quote.`;
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
