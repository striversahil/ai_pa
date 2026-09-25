// automations/product-line/intake.ts — "Add vendor rates" intake copilot.
//
// Turns a pasted unstructured vendor quote into confirmed catalogue writes:
// vendor draft → product draft → rate draft, each confirmed in chat. Runs on
// the shared engine (src/copilot) with a KV-backed draft session (30 min TTL,
// one per user — bounded cart state, NOT chat history).
//
// KYP context discipline: the model only ever sees the REQUIRED questions of
// the ONE matched product (required_specs tool). The full sheet is never fed
// into a prompt.
import type { ToolDefinition } from '../../shared/ai-gateway';
import { cacheDel, cacheGet, cacheSet } from '../../shared/cache';
import type { CopilotDef, CopilotExecResult } from '../../copilot/types';
import { getProductLineData } from './service';
import { createProduct, createRate, createVendor } from './update';
import { invalidateProductLineCache } from './service';

interface IntakeCtx {
  env: Record<string, unknown>;
  me: any;
  who: string;
}

interface IntakeDraft {
  productId?: string;
  productName?: string;
  productCategory?: string;
  vendorId?: string;
  vendorName?: string;
  vendorType?: string;
  vendorPhone?: string;
  vendorLocation?: string;
  price?: number;
  unit?: string;
  discount?: number;
  moq?: string;
  delivery?: number;
  weight?: number;
  packQty?: string;
  packDims?: string;
  specs: Record<string, string>;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const BLANK: IntakeDraft = { specs: {} };

function sessionKey(who: string): string {
  return `copilot:intake:pl:${who}`;
}

async function loadDraft(who: string): Promise<IntakeDraft> {
  try {
    const d = await cacheGet<IntakeDraft>(sessionKey(who), SESSION_TTL_MS);
    if (d && typeof d === 'object') return { specs: {}, ...d, specs: { ...(d.specs ?? {}) } };
  } catch { /* ignore */ }
  return { specs: {} };
}

async function saveDraft(who: string, d: IntakeDraft): Promise<void> {
  try { await cacheSet(sessionKey(who), d, SESSION_TTL_MS); } catch { /* ignore */ }
}

async function clearDraft(who: string): Promise<void> {
  try { await cacheDel(sessionKey(who)); } catch { /* ignore */ }
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown, max = 300): string | undefined {
  const s = String(v ?? '').trim().slice(0, max);
  return s || undefined;
}

/** What's still missing: identity/commercials + required spec keys. */
function missing(d: IntakeDraft, required: { key: string; question: string }[]): string[] {
  const out: string[] = [];
  if (!d.productId && !d.productName) out.push('product');
  else if (!d.productId && d.productName && !d.productCategory) out.push('product category');
  if (!d.vendorId && !d.vendorName) out.push('vendor');
  if (d.price === undefined) out.push('price');
  if (!d.unit) out.push('unit');
  for (const q of required) {
    if (!String(d.specs[q.key] ?? '').trim()) out.push(`spec: ${q.question.slice(0, 80)}`);
  }
  return out;
}

async function requiredSpecs(productId: string): Promise<{ key: string; question: string }[]> {
  const data = await getProductLineData();
  return ((data.guide as any)?.[productId] ?? [])
    .filter((g: any) => g?.active && g?.isRequired)
    .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((g: any) => ({ key: String(g.attrKey), question: String(g.question) }));
}

function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

/** Scored catalogue match: exact name/alias (2) beats partial (1). */
function matchProducts(data: any, q: string): { row: any; exact: boolean }[] {
  const needle = norm(q);
  if (!needle) return [];
  const out: { row: any; exact: boolean }[] = [];
  for (const p of (data.products ?? []) as any[]) {
    const name = norm(p.name);
    const aliases = (Array.isArray(p.aliases) ? p.aliases : []).map(norm);
    const cat = norm(p.category);
    if (p.id === q.trim() || name === needle || aliases.includes(needle)) {
      out.push({ row: p, exact: true });
    } else if (name.includes(needle) || needle.includes(name) || aliases.some((a) => a && (a.includes(needle) || needle.includes(a))) || cat.includes(needle)) {
      out.push({ row: p, exact: false });
    }
  }
  out.sort((a, b) => Number(b.exact) - Number(a.exact));
  return out.slice(0, 5);
}

async function execTool(ctx: IntakeCtx, name: string, args: Record<string, any>): Promise<{ result: unknown; proposals?: any[] }> {
  const d = await loadDraft(ctx.who);

  if (name === 'get_draft') {
    const req = d.productId ? await requiredSpecs(d.productId).catch(() => []) : [];
    return { result: { draft: d, requiredSpecs: req, missing: missing(d, req) } };
  }

  if (name === 'clear_draft') {
    await clearDraft(ctx.who);
    return { result: { cleared: true } };
  }

  if (name === 'update_draft') {
    const nd: IntakeDraft = { ...d, specs: { ...d.specs } };
    for (const f of ['productId', 'productName', 'productCategory', 'vendorId', 'vendorName', 'vendorType', 'vendorPhone', 'vendorLocation', 'unit', 'moq', 'packQty', 'packDims'] as const) {
      const v = str((args as any)[f]);
      if (v !== undefined) (nd as any)[f] = v;
    }
    for (const f of ['price', 'discount', 'delivery', 'weight'] as const) {
      const v = num((args as any)[f]);
      if (v !== undefined) (nd as any)[f] = v;
    }
    const specs = (args as any).specs;
    if (specs && typeof specs === 'object') {
      for (const [k, v] of Object.entries(specs as Record<string, unknown>)) {
        const key = String(k).trim().slice(0, 120);
        const val = String(v ?? '').trim().slice(0, 500);
        if (key && val) nd.specs[key] = val;
      }
    }
    await saveDraft(ctx.who, nd);
    const req = nd.productId ? await requiredSpecs(nd.productId).catch(() => []) : [];
    return { result: { draft: nd, requiredSpecs: req, missing: missing(nd, req) } };
  }

  if (name === 'find_product') {
    const data = await getProductLineData();
    const found = matchProducts(data, String(args.query ?? ''));
    const exact = found.filter((f) => f.exact);
    return {
      result: {
        // Single exact name/alias hit = already resolved. Set productId via update_draft — never draft new.
        resolvedProductId: exact.length === 1 ? exact[0].row.id : null,
        products: found.map((f) => ({
          id: f.row.id, name: f.row.name, category: f.row.category,
          aliases: f.row.aliases ?? [], exact: f.exact,
        })),
      },
    };
  }

  if (name === 'required_specs') {
    const pid = String(args.productId ?? d.productId ?? '');
    if (!pid) return { result: { error: 'no product resolved yet' } };
    return { result: { specs: await requiredSpecs(pid) } };
  }

  if (name === 'find_vendor') {
    const needle = String(args.query ?? '').trim().toLowerCase();
    const data = await getProductLineData();
    const found = (data.vendors ?? [])
      .filter((v: any) => !needle || String(v.name ?? '').toLowerCase().includes(needle))
      .slice(0, 5);
    return {
      result: {
        vendors: found.map((v: any) => ({ id: v.id, name: v.name, type: v.vendorType || '', location: v.location, active: v.active })),
      },
    };
  }

  if (name === 'propose_vendor') {
    const nameArg = str(args.name) ?? d.vendorName;
    if (!nameArg) return { result: { error: 'vendor name needed' } };
    if (d.vendorId) return { result: { error: 'vendor already resolved' } };
    d.vendorName = nameArg;
    const tp = str(args.vendorType); if (tp) d.vendorType = tp;
    const ph = str(args.phone); if (ph) d.vendorPhone = ph;
    const lc = str(args.location); if (lc) d.vendorLocation = lc;
    await saveDraft(ctx.who, d);
    const lines = [nameArg];
    if (d.vendorType) lines.push(d.vendorType);
    if (d.vendorPhone) lines.push(`ph: ${d.vendorPhone}`);
    if (d.vendorLocation) lines.push(d.vendorLocation);
    return {
      result: { proposed: true },
      proposals: [{
        kind: 'vendor_draft', label: `New vendor: ${nameArg}`,
        text: lines.join(' · '),
        name: nameArg, vendorType: d.vendorType ?? '', phone: d.vendorPhone ?? '', location: d.vendorLocation ?? '',
      }],
    };
  }

  if (name === 'propose_product') {
    const nameArg = str(args.name) ?? d.productName;
    const catArg = str(args.category, 120) ?? d.productCategory;
    if (!nameArg) return { result: { error: 'product name needed' } };
    if (!catArg) return { result: { error: 'product category needed' } };
    if (d.productId) return { result: { error: 'product already resolved' } };
    // Safety: never draft-new when the catalogue already has it (name/alias).
    const data = await getProductLineData();
    const clash = matchProducts(data, nameArg)[0];
    if (clash) return { result: { error: `already exists as "${clash.row.name}" — set productId via update_draft instead`, productId: clash.row.id } };
    d.productName = nameArg;
    d.productCategory = catArg;
    await saveDraft(ctx.who, d);
    return {
      result: { proposed: true },
      proposals: [{
        kind: 'product_draft', label: `New product: ${nameArg}`,
        text: `${catArg} · ${nameArg}`,
        name: nameArg, category: catArg,
      }],
    };
  }

  if (name === 'propose_rate') {
    const hasProduct = !!(d.productId || (d.productName && d.productCategory));
    const hasVendor = !!(d.vendorId || d.vendorName);
    if (!hasProduct) return { result: { error: 'product unresolved — match or draft it first' } };
    if (!hasVendor) return { result: { error: 'vendor unresolved — match or draft it first' } };
    if (d.price === undefined) return { result: { error: 'price missing' } };
    if (!d.unit) return { result: { error: 'unit missing' } };
    const req = d.productId ? await requiredSpecs(d.productId).catch(() => []) : [];
    // KYP gate: EVERY required spec must be answered by the vendor quote
    // before the rate is draftable. Commercial gaps (MOQ/delivery/discount)
    // stay lenient — flagged, not blocking.
    const missingSpecs = req.filter((q) => !String(d.specs[q.key] ?? '').trim());
    if (missingSpecs.length > 0) {
      return { result: { error: 'required specs missing from the quote', missingSpecs: missingSpecs.map((q) => q.question) } };
    }
    const gaps = missing(d, req);
    const title = `${d.productName ?? d.productId} @ ₹${d.price}/${d.unit} — ${d.vendorName ?? d.vendorId}`;
    const specLines = Object.entries(d.specs ?? {}).map(([k, v]) => `${k}: ${v}`);
    const extraLines = [
      d.discount != null ? `discount ${d.discount}%` : null,
      d.moq ? `MOQ ${d.moq}` : null,
      d.delivery != null ? `delivery ${d.delivery}d` : null,
    ].filter(Boolean) as string[];
    const text = [title, ...specLines, ...extraLines,
      gaps.length ? `Gaps: ${gaps.join('; ')}` : 'No gaps — all required details captured.',
    ].join('\n');
    return {
      result: { proposed: true, gaps },
      proposals: [{
        kind: 'rate_draft', label: `Add rate: ${title}`,
        text,
        product: d.productName ?? d.productId, vendor: d.vendorName ?? d.vendorId,
        price: d.price, unit: d.unit, discount: d.discount ?? null,
        moq: d.moq ?? null, delivery: d.delivery ?? null,
        specs: { ...d.specs }, gaps,
      }],
    };
  }

  return { result: { error: `unknown tool ${name}` } };
}

async function executeProposal(ctx: IntakeCtx, action: Record<string, any>): Promise<CopilotExecResult> {
  const kind = String(action?.kind ?? '');
  const fail = (error: string, status = 400): CopilotExecResult => ({ result: { status, body: { error } }, applied: 'none' });

  if (kind === 'vendor_draft') {
    const nameV = str(action?.name);
    if (!nameV) return fail('vendor name required');
    try {
      const row: any = await createVendor({
        name: nameV,
        vendorType: str(action?.vendorType, 120) ?? '',
        contactPhone1: str(action?.phone, 120) ?? null,
        location: str(action?.location) ?? null,
      });
      const d = await loadDraft(ctx.who);
      d.vendorId = String(row.id);
      d.vendorName = String(row.name ?? nameV);
      await saveDraft(ctx.who, d);
      await invalidateProductLineCache().catch(() => {});
      return { result: { status: 201, body: { ok: true, id: row.id, live: 'product-line' } }, applied: 'vendor_draft' };
    } catch (e: any) {
      return fail(String(e?.message ?? 'vendor create failed').slice(0, 300));
    }
  }

  if (kind === 'product_draft') {
    const nameV = str(action?.name);
    const catV = str(action?.category, 120);
    if (!nameV || !catV) return fail('product name + category required');
    try {
      const row: any = await createProduct({ name: nameV, category: catV });
      const d = await loadDraft(ctx.who);
      d.productId = String(row.id);
      d.productName = String(row.name ?? nameV);
      d.productCategory = String(row.category ?? catV);
      await saveDraft(ctx.who, d);
      await invalidateProductLineCache().catch(() => {});
      return { result: { status: 201, body: { ok: true, id: row.id, live: 'product-line' } }, applied: 'product_draft' };
    } catch (e: any) {
      return fail(String(e?.message ?? 'product create failed').slice(0, 300));
    }
  }

  if (kind === 'rate_draft') {
    try {
      const d = await loadDraft(ctx.who);
      // Resolve ids (execute may follow vendor/product confirms in any order).
      let productId = d.productId;
      if (!productId && d.productName) {
        const data = await getProductLineData();
        productId = matchProducts(data, d.productName)[0]?.row.id;
      }
      let vendorId = d.vendorId;
      if (!vendorId && d.vendorName) {
        const data = await getProductLineData();
        vendorId = (data.vendors ?? []).find((v: any) => String(v.name ?? '').toLowerCase() === d.vendorName!.toLowerCase())?.id;
      }
      const price = d.price ?? num(action?.price);
      const unit = d.unit ?? str(action?.unit, 120);
      if (!productId) return fail('product unresolved');
      if (!vendorId) return fail('vendor unresolved');
      if (price === undefined) return fail('price missing');
      if (!unit) return fail('unit missing');
      const row: any = await createRate({
        vendorId, productId,
        attrValues: { ...(d.specs ?? {}) },
        pricePerUnit: price, unit,
        discountPercent: d.discount ?? null,
        moq: d.moq ?? null, deliveryDays: d.delivery ?? null,
        weightPerUnit: d.weight ?? null, packageQty: d.packQty ?? null, packageDims: d.packDims ?? null,
      });
      await clearDraft(ctx.who);
      await invalidateProductLineCache().catch(() => {});
      return { result: { status: 201, body: { ok: true, id: row.id, live: 'product-line' } }, applied: 'rate_draft' };
    } catch (e: any) {
      return fail(String(e?.message ?? 'rate create failed').slice(0, 300));
    }
  }

  return fail('unknown action');
}

const TOOL_DEFS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_draft',
      description: 'Recall the current intake draft + what is still missing. Call FIRST every turn.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_draft',
      description: 'Save extracted quote fields into the draft (product/vendor/price/unit/commercials/specs object).',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string' }, productName: { type: 'string' }, productCategory: { type: 'string' },
          vendorId: { type: 'string' }, vendorName: { type: 'string' }, vendorType: { type: 'string' },
          vendorPhone: { type: 'string' }, vendorLocation: { type: 'string' },
          price: { type: 'number' }, unit: { type: 'string' }, discount: { type: 'number' },
          moq: { type: 'string' }, delivery: { type: 'number' },
          weight: { type: 'number' }, packQty: { type: 'string' }, packDims: { type: 'string' },
          specs: { type: 'object', description: 'Spec key/value pairs quoted by the vendor' },
        },
      },
    },
  },
    {
      type: 'function',
      function: {
        name: 'find_product',
        description: 'Match catalogue products by name, alias, or category. Single exact name/alias hit returns resolvedProductId — set it via update_draft, never draft new.',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
    },
  {
    type: 'function',
    function: {
      name: 'required_specs',
      description: 'REQUIRED checklist questions for the resolved product ONLY. Ask the user only about these — never invent spec questions.',
      parameters: { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_vendor',
      description: 'Match vendors by name (top 5).',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_vendor',
      description: 'Draft a NEW vendor for user confirm (only when no catalogue match).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' }, vendorType: { type: 'string' },
          phone: { type: 'string' }, location: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_product',
      description: 'Draft a NEW product for user confirm (only when no catalogue match).',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, category: { type: 'string' } },
        required: ['name', 'category'],
      },
    },
  },
    {
      type: 'function',
      function: {
        name: 'propose_rate',
        description: 'Draft the rate for user confirm. BLOCKED until product + vendor + price + unit + EVERY required spec are captured (missing specs are returned as an error — ask the user). MOQ/delivery/discount gaps are allowed and flagged.',
        parameters: { type: 'object', properties: {} },
      },
    },
  {
    type: 'function',
    function: {
      name: 'clear_draft',
      description: 'Throw away the current draft and start over.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

/** Product-line intake department definition for the shared engine. */
export const productLineIntakeDef: CopilotDef<IntakeCtx> = {
  id: 'product-line-intake',
  // Same gate as quote writes: product-line scope, MIS, or admin.
  checkAccess: (me: any) => {
    if (!me) return { status: 401, error: 'Authentication required' };
    if ((me as any).isAdmin) return null;
    const scopes: string[] = (me as any).scopes ?? [];
    if (scopes.includes('product-line') || scopes.includes('mis')) return null;
    return { status: 403, error: "Requires 'product-line' permission" };
  },
  buildCtx: (env, me) => ({
    env, me,
    who: String(me?.user?.email ?? me?.user?.id ?? 'anon').toLowerCase(),
  }),
  sessionKey: (ctx) => `copilot:intake:pl:${ctx.who}`,
  historyKey: (ctx) => `copilot:hist:pli:${ctx.who}`,
  historyTtlMs: 30 * 60 * 1000,
  historyMaxMsgs: 100,
  clearExtra: async (ctx) => { await clearDraft(ctx.who); },
  countKey: () => 'copilot:count:product-line-intake',
  systemPrompt: () => (
    'You are the procurement intake assistant for the BUI product-line catalogue. The user pastes an unstructured vendor quote (usually a forwarded message). Turn it into a confirmed vendor rate in passes — NEVER pull the catalogue or the full KYP sheet into context; fetch only what you need, when you need it. ' +
    'Prior turns AND the draft are recalled automatically every turn — never claim to be a new session or to lack earlier context; call get_draft and continue. ' +
    'Every turn: 1) call get_draft FIRST to recall what is captured. 2) Extract new facts from the user message into update_draft (vendor name, product hints, price, unit, spec values like brand/material/size). ' +
    '3) Resolve the product with find_product — like the sales enquiry splitter, loosely infer the item and its category, then verify against the master: a single exact name/alias hit (resolvedProductId) means the product EXISTS — set productId via update_draft, never create. Several candidates: ask the user to pick one, never guess, never create. Zero candidates: ask for product name + category, then propose_product — and only then. ' +
    '4) Once productId is known, call required_specs ONCE — ask the user ONLY about those questions, plus price/unit/vendor if missing. ' +
    '5) Resolve the vendor with find_vendor — exact match: set vendorId; none: propose_vendor (ask only for missing name/phone/type). 6) When product + vendor + price + unit + EVERY required spec are known, call propose_vendor/propose_product first for anything new, then propose_rate. ' +
    'KYP gate: a rate is draftable ONLY when the vendor quote answers every required spec — missing specs block the draft (ask the user for them). MOQ/delivery/discount gaps are flagged inside the draft, not blockers. Keep replies short; confirm each created draft reports back before the next step.'
  ),
  toolDefs: () => TOOL_DEFS,
  execTool,
  activityLabel: (name, args, out) => {
    const r = (out.result ?? {}) as Record<string, any>;
    switch (name) {
      case 'get_draft': return 'Recalled intake draft';
      case 'update_draft': {
        const n = Array.isArray(r.missing) ? r.missing.length : 0;
        return `Captured quote details · ${n} gap${n === 1 ? '' : 's'} left`;
      }
      case 'find_product': {
        const n = Array.isArray(r.products) ? r.products.length : 0;
        return `Matched catalogue · ${n} product${n === 1 ? '' : 's'}`;
      }
      case 'required_specs': {
        const n = Array.isArray(r.specs) ? r.specs.length : 0;
        return r.error ? 'No product resolved' : `Pulled checklist · ${n} required`;
      }
      case 'find_vendor': {
        const n = Array.isArray(r.vendors) ? r.vendors.length : 0;
        return `Vendor lookup · ${n} match${n === 1 ? '' : 'es'}`;
      }
      case 'propose_vendor': return r.error ? 'Vendor draft failed' : 'Drafted new vendor for confirm';
      case 'propose_product': return r.error ? 'Product draft failed' : 'Drafted new product for confirm';
      case 'propose_rate': return r.error ? 'Rate draft blocked' : 'Drafted rate for confirm';
      case 'clear_draft': return 'Cleared draft';
      default:
        return `Ran ${name}`;
    }
  },
  executeProposal,
  modelEnvVar: 'COPILOT_MODEL',
  defaultModel: 'agnes-3.0-flash',
  emptyHint: 'I can’t help with that — paste a vendor quote, or tell me the product, vendor, price and unit.',
};
