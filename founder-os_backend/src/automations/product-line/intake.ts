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
import { getProductDetail, getProductIndex, getRatesForProduct, getVendorIndex } from './service';
import { matchTokens, tokenOverlap, TOKEN_MIN_SCORE, TOKEN_MIN_SHARED } from './match';
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
  quotedAt?: string;
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
    if (d && typeof d === 'object') return { ...d, specs: { ...(d.specs ?? {}) } };
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

/** What's still missing: identity + EVERY mandatory commercial + required spec keys. */
function missing(d: IntakeDraft, required: { key: string; question: string }[]): string[] {
  const out: string[] = [];
  if (!d.productId && !d.productName) out.push('product');
  else if (!d.productId && d.productName && !d.productCategory) out.push('product category');
  if (!d.vendorId && !d.vendorName) out.push('vendor');
  if (d.price === undefined) out.push('price');
  if (!d.unit) out.push('unit');
  if (d.discount === undefined) out.push('discount (0 if none)');
  if (!d.moq) out.push('MOQ');
  if (d.weight === undefined) out.push('weight per unit');
  if (!d.packQty) out.push('pack qty');
  if (!d.packDims) out.push('pack dims');
  if (d.delivery === undefined) out.push('delivery days');
  if (!d.quotedAt) out.push('quote date');
  for (const q of required) {
    if (!String(d.specs[q.key] ?? '').trim()) out.push(`spec: ${q.question.slice(0, 80)}`);
  }
  return out;
}

/** Live catalogue categories (canonical spelling) — new products may ONLY use one of these. */
async function liveCategories(): Promise<string[]> {
  const products = await getProductIndex().catch(() => []);
  const seen = new Map<string, string>();
  for (const p of (products ?? []) as any[]) {
    if (p?.active === false) continue;
    const c = String(p?.category ?? '').trim();
    if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  return [...seen.values()].sort();
}

function validDate(v: unknown): string | undefined {
  const s = String(v ?? '').trim().slice(0, 100);
  if (!s) return undefined;
  const t = new Date(s);
  return isNaN(t.getTime()) ? undefined : t.toISOString();
}

async function requiredSpecs(productId: string): Promise<{ key: string; question: string }[]> {
  const detail = await getProductDetail(String(productId)).catch(() => null);
  return (((detail as any)?.guide ?? []) as any[])
    .filter((g: any) => g?.active && g?.isRequired)
    .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((g: any) => ({ key: String(g.attrKey), question: String(g.question) }));
}

/** FULL checklist for the matched product (required + optional) — the model
 *  gets complete raw questions, never bare keys. */
async function fullChecklist(productId: string): Promise<{ key: string; question: string; note: string; required: boolean }[]> {
  const detail = await getProductDetail(String(productId)).catch(() => null);
  return ((((detail as any)?.guide ?? []) as any[]) as any[])
    .filter((g: any) => g?.active)
    .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((g: any) => ({
      key: String(g.attrKey),
      question: String(g.question),
      note: g.guideNote != null ? String(g.guideNote).slice(0, 300) : '',
      required: g?.isRequired === true || g?.isRequired === 1,
    }));
}

/** Draft's captured specs paired with their raw questions (for model context). */
async function specDetails(productId: string | undefined, specs: Record<string, string>): Promise<{ key: string; question: string; value: string }[]> {
  if (!productId) return [];
  const labels = await specLabels(productId).catch(() => new Map<string, string>());
  return Object.entries(specs ?? {})
    .filter(([, v]) => String(v ?? '').trim())
    .map(([k, v]) => ({ key: k, question: labels.get(k) ?? k, value: String(v) }));
}

/** attrKey → raw question text for DISPLAY (storage keeps keying off attrKey). */
async function specLabels(productId: string): Promise<Map<string, string>> {
  const detail = await getProductDetail(String(productId)).catch(() => null);
  const m = new Map<string, string>();
  for (const g of ((((detail as any)?.guide ?? []) as any[]))) {
    if (g?.active) m.set(String(g.attrKey), String(g.question));
  }
  return m;
}

function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

/** Scored catalogue match: exact name/alias first, then substring/token
 *  score desc. Token tier catches reordered/noisy lines ("belt black
 *  rubber", "6in 4ply 100m nylon belt"); typos still need the LLM pick. */
function matchProducts(products: any[], q: string): { row: any; exact: boolean }[] {
  const needle = norm(q);
  if (!needle) return [];
  const needleToks = matchTokens(needle);
  const out: { row: any; exact: boolean; score: number }[] = [];
  for (const p of (products ?? []) as any[]) {
    const name = norm(p.name);
    const aliases = (Array.isArray(p.aliases) ? p.aliases : []).map(norm);
    const cat = norm(p.category);
    if (p.id === q.trim() || name === needle || aliases.includes(needle)) {
      out.push({ row: p, exact: true, score: 2 });
    } else {
      const sub =
        (name.includes(needle) || needle.includes(name) ||
          aliases.some((a) => a && (a.includes(needle) || needle.includes(a))) ||
          cat.includes(needle)) ? 1 : 0;
      let score = sub;
      if (!sub && needleToks.length > 0) {
        const hayToks = matchTokens([name, ...aliases].join(' '));
        const shared = needleToks.filter((t) => hayToks.includes(t)).length;
        const ov = tokenOverlap(needleToks, hayToks);
        if (shared >= TOKEN_MIN_SHARED && ov >= TOKEN_MIN_SCORE) score = ov;
      }
      if (score > 0) out.push({ row: p, exact: false, score });
    }
  }
  out.sort((a, b) => (Number(b.exact) - Number(a.exact)) || (b.score - a.score));
  return out.slice(0, 5);
}

async function execTool(ctx: IntakeCtx, name: string, args: Record<string, any>): Promise<{ result: unknown; proposals?: any[] }> {
  const d = await loadDraft(ctx.who);

  if (name === 'get_draft') {
    const req = d.productId ? await requiredSpecs(d.productId).catch(() => []) : [];
    const details = await specDetails(d.productId, d.specs);
    return { result: { draft: d, specDetails: details, requiredSpecs: req, missing: missing(d, req) } };
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
    const qd = validDate((args as any).quotedAt);
    if (qd) nd.quotedAt = qd;
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
    const details = await specDetails(nd.productId, nd.specs);
    return { result: { draft: nd, specDetails: details, requiredSpecs: req, missing: missing(nd, req) } };
  }

  if (name === 'find_product') {
    const products = await getProductIndex().catch(() => []);
    const found = matchProducts(products, String(args.query ?? ''));
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
    return { result: { specs: await fullChecklist(pid) } };
  }

  if (name === 'ask_specs') {
    // Rendered questionnaire: every still-unanswered required spec + every
    // still-missing commercial, typed for the UI (options / text / number /
    // date). Options are mined from this product's past quote values — never
    // invented. The frontend renders them one question at a time and posts
    // the answers back into chat; file them with update_draft as usual.
    if (!d.productId) return { result: { error: 'no product resolved yet — match or draft it first' } };
    const detail = await getProductDetail(d.productId).catch(() => null);
    const guide = ((((detail as any)?.guide ?? []) as any[]))
      .filter((g: any) => g?.active && g?.isRequired)
      .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    // Distinct past values per spec key (most-used first) → option lists.
    // Reads ALL rates for this product (no take-cap) via the per-product cache.
    const past: Record<string, Map<string, number>> = {};
    for (const r of await getRatesForProduct(d.productId).catch(() => [])) {
      const vals = (r as any)?.attrValues;
      if (!vals || typeof vals !== 'object') continue;
      for (const [k, v] of Object.entries(vals as Record<string, unknown>)) {
        const val = String(v ?? '').trim().slice(0, 120);
        if (!k || !val) continue;
        (past[k] ??= new Map());
        past[k].set(val, (past[k].get(val) ?? 0) + 1);
      }
    }
    const questions: Record<string, any>[] = [];
    for (const g of guide) {
      const key = String(g.attrKey);
      if (String(d.specs[key] ?? '').trim()) continue;
      const opts = [...(past[key] ?? new Map()).entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v]) => v);
      questions.push({
        key, label: String(g.question), hint: g.guideNote != null ? String(g.guideNote).slice(0, 200) : '',
        type: opts.length >= 2 ? 'options' : 'text',
        ...(opts.length >= 2 ? { options: opts } : {}),
        required: true, section: 'spec',
      });
    }
    const commercials: Record<string, any>[] = [
      d.price === undefined ? { key: 'price', label: 'Price (₹)', type: 'number' } : null,
      !d.unit ? { key: 'unit', label: 'Unit (sqft/kg/meter/PCS/…)', type: 'text' } : null,
      d.discount === undefined ? { key: 'discount', label: 'Discount % (0 if none)', type: 'number' } : null,
      !d.moq ? { key: 'moq', label: 'MOQ', type: 'text' } : null,
      d.weight === undefined ? { key: 'weight', label: 'Weight per unit (kg)', type: 'number' } : null,
      !d.packQty ? { key: 'packQty', label: 'Pack qty', type: 'text' } : null,
      !d.packDims ? { key: 'packDims', label: 'Pack dims', type: 'text' } : null,
      d.delivery === undefined ? { key: 'delivery', label: 'Delivery (days)', type: 'number' } : null,
      !validDate(d.quotedAt) ? { key: 'quotedAt', label: 'Quote date', type: 'date' } : null,
    ].filter(Boolean).map((q: any) => ({ ...q, hint: '', required: true, section: 'commercial' }));
    questions.push(...commercials);
    if (!questions.length) return { result: { questions: [], complete: true } };
    const title = `Details needed — ${d.productName ?? 'new product'}`;
    return {
      result: { questions, complete: false },
      proposals: [{
        kind: 'spec_form', label: title, text: `${questions.length} question${questions.length === 1 ? '' : 's'} to file this rate.`,
        title, product: d.productName ?? d.productId, questions,
      }],
    };
  }

  if (name === 'find_vendor') {
    const needle = String(args.query ?? '').trim().toLowerCase();
    const vendors = await getVendorIndex().catch(() => []);
    const found = vendors
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
    if (!nameArg) return { result: { error: 'product name needed — ask the user' } };
    if (d.productId) return { result: { error: 'product already resolved' } };
    // Category is NEVER invented: it must be picked by the user from the live list.
    const cats = await liveCategories().catch(() => [] as string[]);
    const catHit = catArg ? cats.find((c) => c.toLowerCase() === catArg.toLowerCase()) : undefined;
    if (!catHit) {
      return { result: { error: 'product category needed — ask the user to pick one', validCategories: cats } };
    }
    // Safety: never draft-new when the catalogue already has it (name/alias).
    const products = await getProductIndex().catch(() => []);
    const clash = matchProducts(products, nameArg)[0];
    if (clash) return { result: { error: `already exists as "${clash.row.name}" — set productId via update_draft instead`, productId: clash.row.id } };
    d.productName = nameArg;
    d.productCategory = catHit;
    await saveDraft(ctx.who, d);
    return {
      result: { proposed: true },
      proposals: [{
        kind: 'product_draft', label: `New product: ${nameArg}`,
        text: `${catHit} · ${nameArg}`,
        name: nameArg, category: catHit,
      }],
    };
  }

  if (name === 'propose_rate') {
    const hasProduct = !!(d.productId || (d.productName && d.productCategory));
    const hasVendor = !!(d.vendorId || d.vendorName);
    if (!hasProduct) return { result: { error: 'product unresolved — match or draft it first' } };
    if (!hasVendor) return { result: { error: 'vendor unresolved — match or draft it first' } };
    // FULL commercial gate: nothing on the quote card is optional. Base rate
    // is computed (price − discount), everything else must be filed — ask the
    // user for each missing field instead of drafting around it.
    const missingFields: string[] = [];
    if (d.price === undefined || !(d.price > 0)) missingFields.push('price (must be > 0)');
    if (!d.unit) missingFields.push('unit');
    if (d.discount === undefined || d.discount < 0 || d.discount > 100) missingFields.push('discount (0–100, use 0 when none)');
    if (!d.moq) missingFields.push('MOQ');
    if (d.weight === undefined || d.weight < 0) missingFields.push('weight per unit');
    if (!d.packQty) missingFields.push('pack qty');
    if (!d.packDims) missingFields.push('pack dims');
    if (d.delivery === undefined || d.delivery < 0) missingFields.push('delivery days');
    if (!validDate(d.quotedAt)) missingFields.push('quote date');
    const req = d.productId ? await requiredSpecs(d.productId).catch(() => []) : [];
    // KYP gate: EVERY required spec must be answered by the vendor quote
    // before the rate is draftable.
    const missingSpecs = req.filter((q) => !String(d.specs[q.key] ?? '').trim());
    if (missingSpecs.length > 0) {
      return { result: { error: 'required specs missing from the quote', missingSpecs: missingSpecs.map((q) => q.question) } };
    }
    if (missingFields.length > 0) {
      return { result: { error: 'commercial details missing from the quote', missingFields } };
    }
    const gaps = missing(d, req);
    const title = `${d.productName ?? d.productId} @ ₹${d.price}/${d.unit} — ${d.vendorName ?? d.vendorId}`;
    // Display raw questions, never attrKey slugs (keys stay storage-only).
    const labels = d.productId ? await specLabels(d.productId).catch(() => new Map<string, string>()) : new Map<string, string>();
    const specLines = Object.entries(d.specs ?? {}).map(([k, v]) => `${labels.get(k) ?? k}: ${v}`);
    const extraLines = [
      `discount ${d.discount}%`,
      `MOQ ${d.moq}`,
      `weight ${d.weight} per ${d.unit}`,
      `pack ${d.packQty} · ${d.packDims}`,
      `delivery ${d.delivery}d`,
      `quoted ${String(d.quotedAt).slice(0, 10)}`,
    ];
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
    const catRaw = str(action?.category, 120);
    if (!nameV || !catRaw) return fail('product name + category required');
    // Category must be a live catalogue category — never invent one at execute time.
    const cats = await liveCategories().catch(() => [] as string[]);
    const cat = cats.find((c) => c.toLowerCase() === catRaw.toLowerCase());
    if (!cat) return fail(`unknown category "${catRaw}"`);
    try {
      const row: any = await createProduct({ name: nameV, category: cat });
      const d = await loadDraft(ctx.who);
      d.productId = String(row.id);
      d.productName = String(row.name ?? nameV);
      d.productCategory = String(row.category ?? cat);
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
        const products = await getProductIndex().catch(() => []);
        productId = matchProducts(products, d.productName)[0]?.row.id;
      }
      let vendorId = d.vendorId;
      if (!vendorId && d.vendorName) {
        const vendors = await getVendorIndex().catch(() => []);
        vendorId = vendors.find((v: any) => String(v.name ?? '').toLowerCase() === d.vendorName!.toLowerCase())?.id;
      }
      const price = d.price ?? num(action?.price);
      const unit = d.unit ?? str(action?.unit, 120);
      if (!productId) return fail('product unresolved — confirm the product draft first');
      if (!vendorId) return fail('vendor unresolved — confirm the vendor draft first');
      if (price === undefined || !(price > 0)) return fail('price missing');
      if (!unit) return fail('unit missing');
      // Same full-commercial gate as propose_rate — execute never files a partial card.
      if (d.discount === undefined || d.discount < 0 || d.discount > 100) return fail('discount missing (0–100)');
      if (!d.moq) return fail('MOQ missing');
      if (d.weight === undefined || d.weight < 0) return fail('weight per unit missing');
      if (!d.packQty) return fail('pack qty missing');
      if (!d.packDims) return fail('pack dims missing');
      if (d.delivery === undefined || d.delivery < 0) return fail('delivery days missing');
      const quoted = validDate(d.quotedAt);
      if (!quoted) return fail('quote date missing');
      const row: any = await createRate({
        vendorId, productId,
        attrValues: { ...(d.specs ?? {}) },
        pricePerUnit: price, unit,
        discountPercent: d.discount,
        moq: d.moq, deliveryDays: d.delivery,
        weightPerUnit: d.weight, packageQty: d.packQty, packageDims: d.packDims,
        quotedAt: quoted,
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
          quotedAt: { type: 'string', description: 'Quote date (any parseable date; ask the user, "today" is fine)' },
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
        description: 'FULL checklist (required + optional) for the resolved product — complete raw questions with guide notes, each flagged required true/false. Ask the user ONLY about required ones (via ask_specs) — never invent spec questions.',
      parameters: { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_specs',
      description: 'Render the missing-details form (unanswered required specs + missing commercials) as an interactive questionnaire — call this instead of asking for specs in prose. Options come from past quote values. The user fills it and the answers arrive as their next message; file them with update_draft.',
      parameters: { type: 'object', properties: {} },
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
        description: 'Draft a NEW product for user confirm (only when no catalogue match). The category MUST be picked by the user from the live list — never invent one; a wrong category is rejected with the valid list, so ask first.',
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
        description: 'Draft the rate for user confirm. BLOCKED until product + vendor + EVERY required spec + ALL commercials (price, unit, discount, MOQ, weight per unit, pack qty, pack dims, delivery days, quote date) are captured — anything missing is returned as an error naming the fields, so ask the user for them. Nothing on the quote card is optional.',
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
    'Every turn: 1) call get_draft FIRST to recall what is captured. 2) Extract new facts from the user message into update_draft (vendor name, product hints, price, unit, discount, MOQ, weight, pack qty/dims, delivery days, quote date, spec values like brand/material/size). ' +
    '3) Resolve the product with find_product — like the sales enquiry splitter, loosely infer the item and its category, then verify against the master: a single exact name/alias hit (resolvedProductId) means the product EXISTS — set productId via update_draft, never create. Several candidates: ask the user to pick one, never guess, never create. Zero candidates: ask the user for the product name AND ask them to pick the category, then propose_product — never invent a category; a made-up category is rejected. ' +
    '4) Once productId is known, call required_specs ONCE to see the FULL checklist (required + optional, with guide notes) — then call ask_specs to render the missing required details as an interactive form INSTEAD of asking spec/commercial questions in chat text. The user fills the form; their answers arrive as the next message — file them with update_draft (specs object for spec keys, plain fields for commercials). ' +
    '5) Resolve the vendor with find_vendor — exact match: set vendorId; none: propose_vendor (ask only for missing name/phone/type). 6) When product + vendor + EVERY required spec + ALL commercials are known, call propose_vendor/propose_product first for anything new, then propose_rate. ' +
    'Gates: a rate is draftable ONLY when the vendor quote answers every required spec AND every commercial (price, unit, discount — ask and record 0 when none, MOQ, weight per unit, pack qty, pack dims, delivery days, quote date) is filed — missing items block the draft (ask the user for them). Nothing on the quote card is optional. When listing captured specs to the user in replies or summaries, always use the raw question text from required_specs — never show attrKey slugs (e.g. ask_width_required, spec_sss); slugs are storage-only. Keep replies short; confirm each created draft reports back before the next step. ' +
    'Deletes are NEVER done here: if the user asks to delete a rate or vendor, point them to the Product Line dashboard (Rates/Vendors tabs → Delete button). There are no delete tools — do not propose, stage, or execute any deletion.'
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
      case 'ask_specs': {
        const n = Array.isArray(r.questions) ? r.questions.length : 0;
        return r.error ? 'Form unavailable' : r.complete ? 'Nothing missing' : `Asked ${n} question${n === 1 ? '' : 's'}`;
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
  defaultModel: 'deepseek/deepseek-v4.1-flash',
  emptyHint: 'I can’t help with that — paste a vendor quote, or tell me the product, vendor, price and unit.',
};
