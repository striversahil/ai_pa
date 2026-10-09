// chat-tools.ts — sales copilot tool definitions, chimes, and dispatcher.
//
// Verbatim extract from chat.ts (Phase-1 split): the model-facing tool
// schemas (toolDefs), the UI chime labels (activityLabel), the read/propose
// implementations, and the execTool router. Price-lookup implementations
// live in chat-tools-pricing.ts; the router is the only coupling point.
import type { ToolDefinition } from '../../shared/ai-gateway';
import { cacheGet } from '../../shared/cache';
import type { ChatProposal, SalesCtx } from './chat-types';
import { THREAD_TTL_MS, itemIdx } from './chat-prices';
import { canSeeProcurementRequests, stripMarginFields } from './routes';
import {
  execAskQuestion, execAskSpecs, execFindPrice, execFindPriceBatch,
  execListEnquiryRates, execLookupPrice, execQuotePrice, execQuotePriceBatch,
  type ToolOut,
} from './chat-tools-pricing';

export function toolDefs(ctx: SalesCtx): ToolDefinition[] {
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
          description: 'Start a price lookup for one enquiry item: resolves the item (via its kypItem/category mapping) to a live catalogue product and returns its required spec checklist + the item spec on file + the FULL vendor-blind past-rate list (no top-N cut — every rate with specs, price, age). YOU rank those rates against the client\'s verbatim wording (itemSpec): deterministic confidence is only a signal, your language judgment picks the right variation when wording is loose. Call this first whenever the user asks for a price/rate. If a previous call returned candidates, pass the user-picked productId to lock it in.',
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
          description: 'Show the sales agent a stepped spec questionnaire (spec_form card) for the still-missing required specs of a catalogue product. Every question is OPTIONAL and skippable — the form also offers "Quote with what we have". Prefer this over asking spec questions in prose. You may skip this entirely and call quote_price directly when the user wants a price now.',
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
          description: 'Look up past vendor rates for a catalogue product, score them against the collected specs, and draft a customer price (final price; cost basis and vendor hidden) for confirm. GUIDE-FIRST: with zero usable specs collected it returns needSpecs instead of quoting — call ask_specs/ask_question first, then quote. Pass skipSpecs:true only when the user says quote with what we have. Vague whole-value words (small/normal/standard) are auto-dropped and returned as vague for targeted questions. Below-confidence still quotes with caveats. Only no-past-rates routes to procurement.',
          parameters: {
            type: 'object',
            properties: {
              productId: { type: 'string' },
              itemIndex: { type: 'number', description: '1-based item number as shown in the chat (Item 1, Item 2, …)' },
              specs: { type: 'object', description: 'attrKey → collected spec value', additionalProperties: { type: 'string' } },
              skipSpecs: { type: 'boolean', description: 'Quote now with collected specs, flagging the missing ones as caveats' },
            },
            required: ['productId', 'itemIndex'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'lookup_price',
          description: 'Catalogue price lookup for ANY product by name — no enquiry item needed. Use the moment the user asks the rate of something that is NOT on this enquiry (or before any item exists). Resolves the product, scores past vendor rates against optional specs, and shows the vendor-blind table (view-only: no apply, no procurement — there is no item to attach to). NEVER tell the user to add the item first.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Product name as the user said it ("V belt", "Damru", …)' },
              productId: { type: 'string', description: 'Catalogue product id picked from a previous candidates list (skips matching)' },
              specs: { type: 'object', description: 'attrKey → known spec value (optional)', additionalProperties: { type: 'string' } },
            },
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
          name: 'list_enquiry_rates',
          description: 'Show the OTHER prices already on one enquiry item: every rate quoted on it before (vendor-blind — no vendor names), plus its expected and final rate. Use when the user asks what was quoted earlier, what other prices exist, or the price history of an item. Never invent — only stored rows.',
          parameters: {
            type: 'object',
            properties: {
              itemIndex: { type: 'number', description: '1-based item number as shown in the chat (Item 1, Item 2, …)' },
            },
            required: ['itemIndex'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'quote_price_batch',
          description: 'BATCH quoting for MULTIPLE items in ONE call — use this (never quote_price in a loop) after the specs are collected. GUIDE-FIRST per item: zero usable specs returns needSpecs for that item (ask first, then quote); pass top-level skipSpecs:true only when the user says quote with what we have. Scores every item against its resolved product and returns per-item prices plus ONE combined price table (per-row Apply in the UI). Below-confidence items still quote with caveats. Only items without a resolved product or past rates route to procurement individually.',
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
export function activityLabel(name: string, args: Record<string, any>, out: { result: unknown }): string {
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

async function execEnquirySummary(ctx: SalesCtx, view: any, enquiry: any): Promise<ToolOut> {
  const items = (Array.isArray(view.items) ? view.items : []).map((it: any, i: number) => ({
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

async function execProposeComment(ctx: SalesCtx, args: Record<string, any>): Promise<ToolOut> {
  const text = String(args.text ?? '').trim().slice(0, 2000);
  if (!text) return { result: { error: 'empty text' } };
  const scope = ctx.restricted ? 'procurement' : (String(args.scope ?? '').toLowerCase() === 'procurement' ? 'procurement' : 'sales');
  const proposal: ChatProposal = { kind: 'comment', text, scope: scope as 'sales' | 'procurement', label: `Post to ${scope} thread` };
  return { result: { proposed: true }, proposals: [proposal] };
}

async function execProposeSpecFix(ctx: SalesCtx, enquiry: any, args: Record<string, any>): Promise<ToolOut> {
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

/** Router: one branch per tool; price-lookup bodies live in chat-tools-pricing. */
export async function execTool(ctx: SalesCtx, name: string, args: Record<string, any>): Promise<ToolOut> {
  const enquiry: any = await ctx.store.getEnquiry(ctx.enquiryId).catch(() => null);
  if (!enquiry) return { result: { error: 'enquiry not found' } };
  const view = ctx.privileged ? enquiry : stripMarginFields(enquiry, { hideRequests: !canSeeProcurementRequests(ctx.me) });
  switch (name) {
    case 'get_enquiry_summary': return execEnquirySummary(ctx, view, enquiry);
    case 'propose_comment': return execProposeComment(ctx, args);
    case 'propose_spec_fix': return execProposeSpecFix(ctx, enquiry, args);
    case 'find_price': return execFindPrice(ctx, view, enquiry, args);
    case 'ask_specs': return execAskSpecs(ctx, view, enquiry, args);
    case 'ask_question': return execAskQuestion(ctx, view, enquiry, args);
    case 'quote_price': return execQuotePrice(ctx, view, enquiry, args);
    case 'lookup_price': return execLookupPrice(ctx, view, enquiry, args);
    case 'find_price_batch': return execFindPriceBatch(ctx, view, enquiry, args);
    case 'list_enquiry_rates': return execListEnquiryRates(ctx, view, enquiry, args);
    case 'quote_price_batch': return execQuotePriceBatch(ctx, view, enquiry, args);
    default: return { result: { error: `unknown tool ${name}` } };
  }
}
