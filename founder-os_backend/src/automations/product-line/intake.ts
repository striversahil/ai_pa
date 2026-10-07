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
import { numField, strField } from './normalize';

interface IntakeCtx {
  env: Record<string, unknown>;
  me: any;
  who: string;
  /** Volatile conversation id (client-minted; '' = legacy user-wide memory). */
  session: string;
}

interface IntakeDraft {
  /** Prior filing receipt: update this exact rate when present. */
  rateId?: string;
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

function parseAttrValues(raw: unknown): Record<string, string> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[String(k)] = String(v ?? '');
    return out;
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) return parseAttrValues(v);
    } catch { /* fall through */ }
  }
  return {};
}

function parseMissingList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.map(String).filter(Boolean);
    } catch { /* fall through */ }
  }
  return [];
}

/** Compact live-rate card for find_rate (ids + specs + gaps, never vendors' PII). */
function rateCard(r: any): Record<string, unknown> {
  return {
    rateId: String(r?.id ?? ''),
    vendor: String(r?.vendorName ?? r?.vendorId ?? ''),
    product: String(r?.productName ?? r?.productId ?? ''),
    price: r?.pricePerUnit ?? null,
    unit: r?.unit ?? '',
    specs: parseAttrValues(r?.attrValues),
    missingSpecs: parseMissingList(r?.missingSpecs),
    active: r?.active !== false,
    quotedAt: r?.quotedAt != null ? String(r.quotedAt).slice(0, 10) : null,
  };
}

/** Canonical spec identity — same algorithm as update.ts rateData: sorted
 *  `key=value` pairs joined by `|`. Equal keys = same quoted variant. */
export function canonicalAttrKey(specs: Record<string, unknown>): string {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(specs ?? {})) {
    const key = String(k).trim();
    const val = String(v ?? '').trim();
    if (key && val) clean[key] = val;
  }
  return Object.entries(clean).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('|').slice(0, 2000);
}

async function ensureVendorId(d: IntakeDraft): Promise<string | null> {
  if (d.vendorId) return d.vendorId;
  const name = String(d.vendorName ?? '').trim();
  if (!name) return null;
  const { getVendorIndex } = await import('./service');
  const vendors = await getVendorIndex().catch(() => []);
  const hit = (vendors ?? []).find((v: any) => String(v.name ?? '').toLowerCase() === name.toLowerCase());
  if (hit) return String((hit as any).id);
  const { createVendor } = await import('./update');
  const row: any = await createVendor({ name });
  return String(row.id);
}

async function ensureProductId(d: IntakeDraft): Promise<string | null> {
  if (d.productId) return d.productId;
  const name = String(d.productName ?? '').trim();
  if (!name) return null;
  const { getProductIndex } = await import('./service');
  const products = await getProductIndex().catch(() => []);
  const hit = matchProducts(products, name)[0];
  if (hit) return String(hit.row.id);
  const cat = String(d.productCategory ?? '').trim();
  if (!cat) return null;
  const cats = await liveCategories().catch(() => [] as string[]);
  const catHit = cats.find((c) => c.toLowerCase() === cat.toLowerCase());
  if (!catHit) return null;
  const { createProduct } = await import('./update');
  const row: any = await createProduct({ name, category: catHit });
  return String(row.id);
}

export interface FiledRate {
  rateId: string;
  updated: boolean;
  product: string;
  vendor: string;
  missing: string[];
}

/** File ONE draft object as a live rate — create or UPDATE (never duplicate).
 *  Stateless: the draft arrives whole (from trace/proposal), nothing is read
 *  from or written to any session. Relaxed gate: product + vendor + price +
 *  unit file the rate; everything else optional and reported as missing.
 *  Identity = same vendor + product + canonical spec key (spec-less rows:
 *  vendor + product + price + unit). Corrections re-file the same payload —
 *  the identity match turns them into updates, never second rates.
 */
async function fileDraft(d: IntakeDraft): Promise<FiledRate> {
  const vendorId = await ensureVendorId(d);
  if (!vendorId) throw new Error('vendor unresolved');
  const productId = await ensureProductId(d);
  if (!productId) throw new Error('product unresolved');
  const price = d.price;
  if (price === undefined || !(price > 0)) throw new Error('price missing');
  const unit = String(d.unit ?? '').trim();
  if (!unit) throw new Error('unit missing');
  const { createRate, updateRate } = await import('./update');
  const { getRatesForProduct } = await import('./service');
  const { prisma } = await import('../../shared/prisma');
  const req = await requiredSpecs(productId).catch(() => []);
  const missingSpecs = req.filter((q) => !String((d.specs ?? {})[q.key] ?? '').trim()).map((q) => q.question);
  const commercialMissing: string[] = [];
  if (d.discount === undefined) commercialMissing.push('discount');
  if (!d.moq) commercialMissing.push('MOQ');
  if (d.weight === undefined) commercialMissing.push('weight per unit');
  if (!d.packQty) commercialMissing.push('pack qty');
  if (!d.packDims) commercialMissing.push('pack dims');
  if (d.delivery === undefined) commercialMissing.push('delivery days');
  if (!validDate(d.quotedAt)) commercialMissing.push('quote date');
  const missing = [...missingSpecs.map((q) => `spec: ${q.slice(0, 80)}`), ...commercialMissing];
  const quoted = validDate(d.quotedAt) ?? new Date().toISOString();
  const rateBody = {
    vendorId, productId,
    attrValues: { ...(d.specs ?? {}) },
    pricePerUnit: price, unit,
    discountPercent: d.discount ?? null,
    moq: d.moq ?? null, deliveryDays: d.delivery ?? null,
    weightPerUnit: d.weight ?? null, packageQty: d.packQty ?? null, packageDims: d.packDims ?? null,
    quotedAt: quoted, missingSpecs: missingSpecs.slice(0, 50),
  };
  // 0) explicit rateId (a previous receipt, carried in-conversation) → update it.
  const priorId = String((d as any)?.rateId ?? '').trim();
  if (priorId) {
    const cur = await (prisma as any).vendorRate.findUnique({ where: { id: priorId } }).catch(() => null);
    if (cur) {
      await updateRate(priorId, rateBody);
      return { rateId: priorId, updated: true, product: d.productName ?? productId, vendor: d.vendorName ?? vendorId, missing };
    }
  }
  // Same vendor + product + COMPATIBLE specs → update, never duplicate. A
  // payload whose specs are a SUPERSET of a live rate (same values on every
  // shared key) is a refinement of that rate (missing info filled in) — not
  // a new variant. Genuinely different values still create. Best (most
  // shared keys) match wins.
  const key = canonicalAttrKey(d.specs ?? {});
  const live = await getRatesForProduct(productId).catch(() => []);
  const want = parseAttrValues(d.specs ?? {});
  let dup: any = null;
  let dupShared = -1;
  for (const r of (live ?? []) as any[]) {
    if (!r || r.active === false || String(r.vendorId ?? '') !== String(vendorId)) continue;
    if (key !== '' && String(r.attrKey ?? '') === key) { dup = r; break; }
    const have = parseAttrValues(r.attrValues);
    const keys = Object.keys(have);
    if (!keys.length) {
      if (key === '' && Number(r.pricePerUnit ?? NaN) === Number(price) &&
        String(r.unit ?? '').toLowerCase() === String(unit).toLowerCase() && dupShared < 0) {
        dup = r; dupShared = 0;
      }
      continue;
    }
    const shared = keys.filter((k) => String(want[k] ?? '').trim() !== '');
    if (!shared.length) continue;
    if (!shared.every((k) => String(want[k]).trim() === String(have[k]).trim())) continue;
    if (shared.length > dupShared) { dup = r; dupShared = shared.length; }
  }
  if (dup) {
    // Merge: keep live specs the payload didn't restate (partial refiles
    // must not wipe filled values), new values win. Single write.
    const merged = { ...parseAttrValues((dup as any).attrValues), ...want };
    const stillMissing = req.filter((q) => !String(merged[q.key] ?? '').trim()).map((q) => q.question);
    await updateRate(String((dup as any).id), {
      ...rateBody,
      attrValues: merged,
      missingSpecs: stillMissing.slice(0, 50),
    });
    return { rateId: String((dup as any).id), updated: true, product: d.productName ?? productId, vendor: d.vendorName ?? vendorId, missing: [...stillMissing.map((q) => `spec: ${q.slice(0, 80)}`), ...commercialMissing] };
  }
  // Empty specs (key '') never auto-merge — spec-less rows would collapse
  // distinct variants into one rate. They always create.
  const row: any = await createRate(rateBody);
  return { rateId: String(row.id), updated: false, product: d.productName ?? productId, vendor: d.vendorName ?? vendorId, missing };
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

/** Vendor canonical form: case/punctuation/whitespace folded, legal-entity
 *  prefixes stripped — "M/S FILTECH TEXTILES" and "Filtech Textiles" are
 *  the same vendor. Conservative: never drops content words, so "Global
 *  Rubber" and "Global Textiles" stay distinct. */
function vendorCanon(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(m\s*s|messrs|mr|smt|shri)\s+/, '');
}

/** Tolerant alias list parse (stored as JSON string or array). */
function aliasList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s)).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.map((s) => String(s)).filter(Boolean);
    } catch { /* fall through */ }
  }
  return [];
}

/** Scored vendor match (mirrors matchProducts tiers): canonical-exact,
 *  then substring, then token overlap. `why` explains the hit for dupe
 *  review. Never invents — ranks only. */
function matchVendors(vendors: any[], q: string): { row: any; exact: boolean; score: number; why: string }[] {
  const needle = norm(q);
  if (!needle) return [];
  const canon = vendorCanon(q);
  const needleToks = matchTokens(needle);
  const out: { row: any; exact: boolean; score: number; why: string }[] = [];
  for (const v of (vendors ?? []) as any[]) {
    const name = norm(v.name);
    if (!name) continue;
    if (canon && vendorCanon(v.name) === canon) {
      out.push({ row: v, exact: true, score: 3, why: 'same name after cleanup' });
      continue;
    }
    if (name === needle) {
      out.push({ row: v, exact: true, score: 2, why: 'exact name' });
      continue;
    }
    if (name.includes(needle) || needle.includes(name)) {
      out.push({ row: v, exact: false, score: 1, why: 'name contains' });
      continue;
    }
    if (needleToks.length > 0) {
      const hayToks = matchTokens(name);
      const shared = needleToks.filter((t) => hayToks.includes(t));
      const ov = tokenOverlap(needleToks, hayToks);
      if (shared.length >= TOKEN_MIN_SHARED && ov >= TOKEN_MIN_SCORE) {
        out.push({ row: v, exact: false, score: ov, why: `shares ${shared.slice(0, 3).join(', ')}` });
      }
    }
  }
  out.sort((a, b) => (Number(b.exact) - Number(a.exact)) || (b.score - a.score));
  return out.slice(0, 5);
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

/** Paging args shared by the flexible reads: how much data the model wants.
 *  No caps on principle — limit only bounds one page, offset pages through,
 *  and every read reports total + truncated so big lists page cleanly. */
function pageArgs(args: Record<string, any>, defLimit: number): { limit: number; offset: number } {
  return {
    limit: Math.min(500, Math.max(1, Math.floor(Number(args?.limit) || defLimit))),
    offset: Math.max(0, Math.floor(Number(args?.offset) || 0)),
  };
}
function includes(args: Record<string, any>): string[] {
  return Array.isArray(args?.include) ? (args.include as unknown[]).map((s) => String(s)) : [];
}

/** Post-move identity collapse: within one (product, vendor), rates sharing
 *  a canonical attrKey are the same quote — keep the newest quotedAt, drop
 *  the rest. Returns dropped count. Runs after every merge move. */
async function dedupeRates(productId: string, vendorId: string): Promise<number> {
  try {
    const { prisma } = await import('../../shared/prisma');
    const { deleteRate } = await import('./update');
    const rows = (await (prisma as any).vendorRate.findMany({ where: { productId, vendorId } }).catch(() => [])) as any[];
    const byKey = new Map<string, any[]>();
    for (const r of rows ?? []) {
      const k = String(r?.attrKey ?? '');
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(r);
    }
    let dropped = 0;
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => String(b?.quotedAt ?? '').localeCompare(String(a?.quotedAt ?? '')));
      for (const loser of group.slice(1)) {
        await deleteRate(String(loser.id)).catch(() => null);
        dropped++;
      }
    }
    return dropped;
  } catch {
    return 0;
  }
}

/** Recompute a moved rate's missing-spec flags against its NEW product's
 *  checklist (spec keys are attrKey-stable across products). */
async function refreshMissing(rateId: string, productId: string): Promise<void> {
  try {
    const { prisma } = await import('../../shared/prisma');
    const { updateRate } = await import('./update');
    const req = await requiredSpecs(productId).catch(() => []);
    const row = await (prisma as any).vendorRate.findUnique({ where: { id: rateId } }).catch(() => null);
    if (!row) return;
    const specs = parseAttrValues((row as any)?.attrValues);
    const missing = req.filter((r) => !String(specs[r.key] ?? '').trim()).map((r) => r.question);
    await updateRate(rateId, { missingSpecs: missing }).catch(() => null);
  } catch { /* best-effort */ }
}

async function execTool(ctx: IntakeCtx, name: string, args: Record<string, any>, message?: string): Promise<{ result: unknown; proposals?: any[] }> {
  // STATELESS: no draft session anywhere. The model carries working state in
  // the conversation (history + tool trace); every call ships what it needs.
  // NO input caps anywhere on this path (founder order): pastes, splits,
  // and commits ride whole — big price lists included.
  // `draft` (1-based) is the model's own bookkeeping for multi-quote blobs.

  if (name === 'split_quotes') {
    const quotes = Array.isArray(args?.quotes) ? args.quotes.map((q: any) => String(q?.text ?? q ?? '').trim()).filter(Boolean) : [];
    if (!quotes.length) return { result: { error: 'quotes array needed (each item one vendor quote)' } };
    return { result: { drafts: quotes.length, heads: quotes.map((q, i) => ({ draft: i + 1, head: q.slice(0, 200) })) } };
  }

  if (name === 'update_draft') {
    // Pure capture: normalize + validate, return the structured draft. NOT
    // stored — the conversation holds it; resend it (full) with the next call.
    const { normalizeSpecValue, normalizeUnit } = await import('./normalize');
    const nd: IntakeDraft = { specs: {} };
    for (const f of ['rateId', 'productId', 'productName', 'productCategory', 'vendorId', 'vendorName', 'vendorType', 'vendorPhone', 'vendorLocation', 'moq', 'packQty', 'packDims'] as const) {
      const v = strField((args as any)[f]);
      if (v !== undefined) (nd as any)[f] = v;
    }
    // Unit + spec values pass the normalizer (4" → 4 inch, mtr → meter…).
    const unitRaw = strField((args as any).unit, 120);
    if (unitRaw !== undefined) {
      const u = normalizeUnit(unitRaw);
      if (u !== undefined) nd.unit = u;
    }
    for (const f of ['price', 'discount', 'delivery', 'weight'] as const) {
      const v = numField((args as any)[f]);
      if (v !== undefined) (nd as any)[f] = v;
    }
    const qd = validDate((args as any).quotedAt);
    if (qd) nd.quotedAt = qd;
    const specs = (args as any).specs;
    if (specs && typeof specs === 'object') {
      for (const [k, v] of Object.entries(specs as Record<string, unknown>)) {
        const key = String(k).trim().slice(0, 120);
        const val = normalizeSpecValue(v);
        if (key && val) nd.specs[key] = val;
      }
    }
    const draftNo = Math.floor(Number(args?.draft));
    const req = nd.productId ? await requiredSpecs(nd.productId).catch(() => []) : [];
    const details = await specDetails(nd.productId, nd.specs);
    return { result: { draft: nd, ...(Number.isFinite(draftNo) && draftNo >= 1 ? { draftNumber: draftNo } : {}), specDetails: details, requiredSpecs: req, missing: missing(nd, req) } };
  }

  if (name === 'find_product') {
    // Flexible catalogue read: empty query lists everything (paged);
    // include expands rows — quotes (latest rate cards) and/or checklist
    // (full requirement list, replacing a required_specs round-trip).
    const q = String(args.query ?? '').trim();
    const { limit, offset } = pageArgs(args, 5);
    const inc = includes(args);
    const products = await getProductIndex().catch(() => []);
    const ranked = q ? matchProducts(products, q) : (products ?? []).map((row: any) => ({ row, exact: false }));
    const total = ranked.length;
    const page = ranked.slice(offset, offset + limit);
    const out: Record<string, unknown>[] = [];
    for (const f of page) {
      const row: Record<string, unknown> = {
        id: f.row.id, name: f.row.name, category: f.row.category,
        aliases: f.row.aliases ?? [], exact: !!(f as any).exact,
      };
      if (inc.includes('quotes')) {
        const { getRatesForProduct } = await import('./service');
        const rs = await getRatesForProduct(String(f.row.id)).catch(() => []);
        row.quotes = (rs ?? []).slice(0, 3).map((r) => rateCard(r));
      }
      if (inc.includes('checklist')) {
        row.checklist = await fullChecklist(String(f.row.id)).catch(() => []);
      }
      out.push(row);
    }
    const exact = ranked.filter((f) => (f as any).exact);
    return {
      result: {
        // Single exact name/alias hit = already resolved. Set productId via update_draft — never draft new.
        resolvedProductId: q && exact.length === 1 ? exact[0].row.id : null,
        products: out, total, truncated: offset + page.length < total,
      },
    };
  }

  if (name === 'required_specs') {
    const pid = String(args.productId ?? '');
    if (!pid) return { result: { error: 'productId needed' } };
    return { result: { specs: await fullChecklist(pid) } };
  }

  if (name === 'ask_specs') {
    // Rendered questionnaire: every still-unanswered required spec + every
    // still-missing commercial, typed for the UI (options / text / number /
    // date). Options are mined from this product's past quote values — never
    // invented. The frontend renders them one question at a time and posts
    // the answers back into chat; file them with update_draft as usual.
    // Stateless: pass productId + already-known answers (specs object,
    // commercials) so answered questions are skipped.
    if (!args?.productId && !(args as any)?.product) return { result: { error: 'productId needed — match or draft it first' } };
    const pid = String(args.productId ?? (args as any).product ?? '');
    const known: IntakeDraft = { specs: {} };
    {
      const { normalizeSpecValue } = await import('./normalize');
      const sp = (args as any)?.specs;
      if (sp && typeof sp === 'object') {
        for (const [k, v] of Object.entries(sp as Record<string, unknown>)) {
          const key = String(k).trim().slice(0, 120);
          const val = normalizeSpecValue(v);
          if (key && val) known.specs[key] = val;
        }
      }
      for (const f of ['price', 'discount', 'delivery', 'weight'] as const) {
        const v = numField((args as any)[f]);
        if (v !== undefined) (known as any)[f] = v;
      }
      for (const f of ['unit', 'moq', 'packQty', 'packDims'] as const) {
        const v = strField((args as any)[f]);
        if (v !== undefined) (known as any)[f] = v;
      }
      const qd = validDate((args as any).quotedAt);
      if (qd) known.quotedAt = qd;
    }
    const d = known;
    const detail = await getProductDetail(pid).catch(() => null);
    const guide = ((((detail as any)?.guide ?? []) as any[]))
      .filter((g: any) => g?.active && g?.isRequired)
      .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    // Distinct past values per spec key (most-used first) → option lists.
    // Reads ALL rates for this product (no take-cap) via the per-product cache.
    const past: Record<string, Map<string, number>> = {};
    for (const r of await getRatesForProduct(pid).catch(() => [])) {
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
    const draftNo = Math.floor(Number(args?.draft));
    const dlabel = String(args?.label ?? '').slice(0, 120);
    const title = `Details needed — ${Number.isFinite(draftNo) && draftNo >= 1 ? `#${draftNo} ` : ''}${dlabel || 'this rate'}`;
    return {
      result: { questions, complete: false },
      proposals: [{
        kind: 'spec_form', label: title, text: `${questions.length} question${questions.length === 1 ? '' : 's'} to file this rate.`,
        title, product: dlabel || pid, productId: pid, known, questions,
      }],
    };
  }

  if (name === 'commit_all') {
    // TABLE-FIRST FILING: validate every rate payload, then return ONE
    // consolidated Confirm proposal for the whole set (keeps confirms:
    // nothing writes until Confirm). Execute files each (create or update,
    // unknown specs flagged). Payload = full draft objects; the model holds
    // them in-conversation (no session anywhere).
    const raw = Array.isArray(args?.rates) ? args.rates : [];
    if (!raw.length) return { result: { error: 'rates array needed (each item: product + vendor + price + unit + specs + commercials)' } };
    const { normalizeSpecValue, normalizeUnit } = await import('./normalize');
    const rates: IntakeDraft[] = [];
    const problems: { index: number; error: string }[] = [];
    for (let i = 0; i < raw.length; i++) {
      const r = (raw[i] ?? {}) as Record<string, unknown>;
      const d: IntakeDraft = { specs: {} };
      for (const f of ['rateId', 'productId', 'productName', 'productCategory', 'vendorId', 'vendorName', 'vendorType', 'vendorPhone', 'vendorLocation', 'moq', 'packQty', 'packDims'] as const) {
        const v = strField(r[f]);
        if (v !== undefined) (d as any)[f] = v;
      }
      const u = normalizeUnit(strField(r.unit, 120) ?? '');
      if (u !== undefined) d.unit = u;
      for (const f of ['price', 'discount', 'delivery', 'weight'] as const) {
        const v = numField(r[f]);
        if (v !== undefined) (d as any)[f] = v;
      }
      const qd = validDate(r.quotedAt);
      if (qd) d.quotedAt = qd;
      const sp = r.specs;
      if (sp && typeof sp === 'object') {
        for (const [k, v] of Object.entries(sp as Record<string, unknown>)) {
          const key = String(k).trim().slice(0, 120);
          const val = normalizeSpecValue(v);
          if (key && val) d.specs[key] = val;
        }
      }
      if (!d.productId && !d.productName) { problems.push({ index: i + 1, error: 'product missing' }); continue; }
      if (!d.vendorId && !d.vendorName) { problems.push({ index: i + 1, error: 'vendor missing' }); continue; }
      if (d.price === undefined || !(d.price > 0)) { problems.push({ index: i + 1, error: 'price missing' }); continue; }
      if (!d.unit) { problems.push({ index: i + 1, error: 'unit missing' }); continue; }
      rates.push(d);
    }
    if (!rates.length) return { result: { error: 'no valid rates', problems } };
    const lines = rates.map((d, i) => {
      const n = i + 1;
      const specBits = Object.entries(d.specs ?? {}).map(([k, v]) => `${k}=${v}`).join(', ');
      return `${n}. ${d.productName ?? d.productId} @ ₹${d.price}/${d.unit} — ${d.vendorName ?? d.vendorId}${specBits ? ` (${specBits.slice(0, 100)})` : ''}`;
    });
    const tableRows = rates.map((d, i) => {
      const gaps: string[] = [];
      if (d.discount === undefined) gaps.push('discount');
      if (!d.moq) gaps.push('MOQ');
      if (d.weight === undefined) gaps.push('weight');
      if (!d.packQty) gaps.push('pack qty');
      if (!d.packDims) gaps.push('pack dims');
      if (d.delivery === undefined) gaps.push('delivery');
      if (!validDate(d.quotedAt)) gaps.push('date');
      return {
        '#': String(i + 1),
        Product: String(d.productName ?? d.productId ?? '—'),
        Vendor: String(d.vendorName ?? d.vendorId ?? '—'),
        Price: `₹${d.price}/${d.unit}`,
        Specs: Object.entries(d.specs ?? {}).map(([k, v]) => `${k}=${v}`).join(', ').slice(0, 80) || '—',
        Missing: gaps.join(', ') || '—',
      };
    });
    const label = `File ${rates.length} rate${rates.length === 1 ? '' : 's'} at once${problems.length ? ` (${problems.length} skipped)` : ''}`;
    const text = [...lines, ...problems.map((p) => `— #${p.index} skipped: ${p.error}`)].join('\n');
    return {
      result: { rates: rates.length, problems },
      proposals: [{
        kind: 'commit_all_draft', label, text,
        table: { columns: ['#', 'Product', 'Vendor', 'Price', 'Specs', 'Missing'], rows: tableRows },
        rates,
      }],
    };
  }

  if (name === 'find_rate') {
    // Flexible rate read: no filters = whole book newest-first (paged);
    // query/vendor narrow it. include commercials adds discount/MOQ/
    // delivery/weight/pack + ids to each card. total + truncated so big
    // lists page with offset (filtered totals are exact up to the page).
    const q = String(args?.query ?? '').trim().toLowerCase();
    const vendorQ = String(args?.vendor ?? '').trim().toLowerCase();
    const { limit, offset } = pageArgs(args, 10);
    const wantComm = includes(args).includes('commercials');
    const { getRatesForProduct } = await import('./service');
    const { prisma } = await import('../../shared/prisma');
    const withComm = (r: any): Record<string, unknown> => {
      const c = rateCard(r);
      if (wantComm) {
        const g = r as any;
        c.commercials = {
          discount: g?.discountPercent ?? g?.discount ?? null,
          moq: g?.moq ?? null,
          delivery: g?.deliveryDays ?? g?.delivery ?? null,
          weight: g?.weightPerUnit ?? g?.weight ?? null,
          packQty: g?.packageQty ?? g?.packQty ?? null,
          packDims: g?.packageDims ?? g?.packDims ?? null,
          vendorId: String(g?.vendorId ?? ''),
          productId: String(g?.productId ?? ''),
        };
      }
      return c;
    };
    if (!q && !vendorQ) {
      const total = await (prisma as any).vendorRate.count().catch(() => 0);
      const rows = await (prisma as any).vendorRate.findMany({ orderBy: [{ quotedAt: 'desc' }], skip: offset, take: limit }).catch(() => []);
      const prods = await getProductIndex().catch(() => []);
      const vendors = await getVendorIndex().catch(() => []);
      const pn = new Map(((prods ?? []) as any[]).map((p) => [String(p.id), String(p.name ?? '')]));
      const vn = new Map(((vendors ?? []) as any[]).map((v) => [String(v.id), String(v.name ?? '')]));
      const out = ((rows as any[]) ?? []).map((r) => withComm({
        ...r,
        productName: pn.get(String((r as any)?.productId ?? '')) ?? String((r as any)?.productId ?? ''),
        vendorName: vn.get(String((r as any)?.vendorId ?? '')) ?? String((r as any)?.vendorId ?? ''),
      }));
      return { result: { rates: out, total, truncated: offset + out.length < total } };
    }
    const cap = offset + limit;
    const index = await getProductIndex().catch(() => []);
    const hits = q ? matchProducts(index, q).slice(0, 3) : [];
    const pids = hits.map((h) => h.row.id);
    const out: Record<string, unknown>[] = [];
    if (!pids.length && vendorQ) {
      // Vendor-scoped: latest rates for the vendor across products.
      const vendors = await getVendorIndex().catch(() => []);
      const v = (vendors ?? []).find((x: any) => String(x.name ?? '').toLowerCase().includes(vendorQ));
      if (v) {
        const total = await (prisma as any).vendorRate.count({ where: { vendorId: String((v as any).id) } }).catch(() => 0);
        const rows = await (prisma as any).vendorRate.findMany({ where: { vendorId: String((v as any).id) }, orderBy: [{ quotedAt: 'desc' }], skip: offset, take: limit }).catch(() => []);
        const names = new Map<string, string>();
        try {
          const prods = await getProductIndex().catch(() => []);
          for (const p of (prods ?? []) as any[]) names.set(String(p.id), String(p.name ?? ''));
        } catch { /* names fall back to ids */ }
        const list = ((rows as any[]) ?? []).map((r) => withComm({
          ...r, vendorName: String((v as any).name ?? ''),
          productName: names.get(String((r as any)?.productId ?? '')) ?? String((r as any)?.productId ?? ''),
        }));
        return { result: { rates: list, total, truncated: offset + list.length < total } };
      }
      return { result: { rates: [], total: 0, truncated: false } };
    }
    for (const pid of pids.length ? pids : (await getProductIndex().catch(() => [])).slice(0, 1).map((p: any) => String(p.id))) {
      for (const r of await getRatesForProduct(String(pid)).catch(() => [])) {
        if (vendorQ && !(String((r as any)?.vendorName ?? '').toLowerCase().includes(vendorQ))) continue;
        if (q && !(JSON.stringify((r as any)?.attrValues ?? {}).toLowerCase().includes(q) || String((r as any)?.productName ?? '').toLowerCase().includes(q))) {
          if (pids.length) continue;
        }
        out.push(withComm(r));
        if (out.length >= cap) break;
      }
      if (out.length >= cap) break;
    }
    const page = out.slice(offset, offset + limit);
    return { result: { rates: page, total: out.length, truncated: out.length >= cap } };
  }

  if (name === 'update_rate') {
    // Direct live-rate patch (no confirm) — the agent's correction path for
    // already-filed rates. Specs merge; missingSpecs recomputed.
    const id = String(args?.rateId ?? '');
    if (!id) return { result: { error: 'rateId needed (find it with find_rate)' } };
    const { prisma } = await import('../../shared/prisma');
    const cur = await (prisma as any).vendorRate.findUnique({ where: { id } }).catch(() => null);
    if (!cur) return { result: { error: 'rate not found' } };
    const { normalizeSpecValue, normalizeUnit } = await import('./normalize');
    const patch: Record<string, unknown> = {};
    for (const f of ['pricePerUnit', 'discountPercent', 'moq', 'deliveryDays', 'weightPerUnit', 'packageQty', 'packageDims', 'unit'] as const) {
      if ((args as any)?.[f] !== undefined && (args as any)?.[f] !== null && (args as any)?.[f] !== '') {
        patch[f] = f === 'unit' ? (normalizeUnit((args as any)[f]) ?? String((args as any)[f]).slice(0, 120)) : (args as any)[f];
      }
    }
    const specs = (args as any)?.specs;
    let mergedSpecs: Record<string, string> | null = null;
    if (specs && typeof specs === 'object') {
      mergedSpecs = parseAttrValues(cur.attrValues);
      for (const [k, v] of Object.entries(specs as Record<string, unknown>)) {
        const key = String(k).trim().slice(0, 120);
        const val = normalizeSpecValue(v);
        if (key && val) mergedSpecs[key] = val;
      }
      patch.attrValues = mergedSpecs;
      patch.attrKey = canonicalAttrKey(mergedSpecs);
    }
    if ((args as any)?.quotedAt !== undefined) {
      const qd = validDate((args as any).quotedAt);
      if (qd) patch.quotedAt = qd;
    }
    // Recompute missing flags against the live checklist.
    const pid = String((cur as any)?.productId ?? '');
    const req = pid ? await requiredSpecs(pid).catch(() => []) : [];
    const finalSpecs = mergedSpecs ?? parseAttrValues(cur.attrValues);
    patch.missingSpecs = req.filter((r) => !String(finalSpecs[r.key] ?? '').trim()).map((r) => r.question);
    if (!Object.keys(patch).length) return { result: { error: 'nothing to update' } };
    const { updateRate } = await import('./update');
    await updateRate(id, patch);
    await invalidateProductLineCache().catch(() => {});
    return { result: { updated: true, rateId: id, missingSpecs: patch.missingSpecs } };
  }

  if (name === 'update_vendor') {
    // Direct vendor patch (no confirm) — the agent's correction path for
    // vendor details (phone/location from a newer quote). Mirrors update_rate.
    const id = String(args?.vendorId ?? '');
    if (!id) return { result: { error: 'vendorId needed (find it with find_vendor)' } };
    const { prisma } = await import('../../shared/prisma');
    const cur = await (prisma as any).vendor.findUnique({ where: { id } }).catch(() => null);
    if (!cur) return { result: { error: 'vendor not found' } };
    const patch: Record<string, unknown> = {};
    const nm = strField(args?.name, 300);
    if (nm !== undefined) patch.name = nm;
    const cp = strField(args?.contactPerson, 300);
    if (cp !== undefined) patch.contactPerson = cp;
    const ph = strField(args?.phone ?? args?.contactPhone1, 300);
    if (ph !== undefined) patch.contactPhone1 = ph;
    const ph2 = strField(args?.contactPhone2, 300);
    if (ph2 !== undefined) patch.contactPhone2 = ph2;
    const lc = strField(args?.location);
    if (lc !== undefined) patch.location = lc;
    const ad = strField(args?.address, 1000);
    if (ad !== undefined) patch.address = ad;
    const vt = strField(args?.vendorType, 120);
    if (vt !== undefined) patch.vendorType = vt;
    if (typeof args?.active === 'boolean') patch.active = args.active;
    if (!Object.keys(patch).length) return { result: { error: 'nothing to update' } };
    const { updateVendor } = await import('./update');
    try {
      await updateVendor(id, patch);
    } catch (e: any) {
      return { result: { error: String(e?.message ?? 'vendor update failed').slice(0, 200) } };
    }
    await invalidateProductLineCache().catch(() => {});
    return { result: { updated: true, vendorId: id, fields: Object.keys(patch) } };
  }

  if (name === 'delete_rate') {
    // Propose ONLY — the actual delete files on Confirm (executeProposal),
    // like every other write here. Shows exactly what will go.
    const id = String(args?.rateId ?? '');
    if (!id) return { result: { error: 'rateId needed (find it with find_rate)' } };
    const { prisma } = await import('../../shared/prisma');
    const cur = await (prisma as any).vendorRate.findUnique({ where: { id } }).catch(() => null);
    if (!cur) return { result: { error: 'rate not found' } };
    const prod = await (prisma as any).productItem.findUnique({ where: { id: String((cur as any)?.productId ?? '') } }).catch(() => null);
    const vend = await (prisma as any).vendor.findUnique({ where: { id: String((cur as any)?.vendorId ?? '') } }).catch(() => null);
    const title = `${String((prod as any)?.name ?? (cur as any)?.productId)} @ ₹${(cur as any)?.pricePerUnit}/${(cur as any)?.unit} — ${String((vend as any)?.name ?? (cur as any)?.vendorId)}`;
    return {
      result: { proposed: true },
      proposals: [{
        kind: 'delete_rate', label: `Delete rate: ${title}`,
        text: `Permanently deletes this live rate (hard delete, not hide):\n${title}`,
        rateId: id,
      }],
    };
  }

  if (name === 'delete_vendor') {
    // Propose ONLY (Confirm executes). Guarded: a vendor with live rates
    // cannot go — the error names the count so the agent routes to the
    // rates first instead of proposing something doomed.
    const id = String(args?.vendorId ?? '');
    if (!id) return { result: { error: 'vendorId needed (find it with find_vendor)' } };
    const { prisma } = await import('../../shared/prisma');
    const cur = await (prisma as any).vendor.findUnique({ where: { id } }).catch(() => null);
    if (!cur) return { result: { error: 'vendor not found' } };
    const refs = await (prisma as any).vendorRate.findMany({ where: { vendorId: id }, select: { id: true } }).catch(() => []);
    if ((refs as any[]).length > 0) {
      return { result: { error: `cannot delete — ${(refs as any[]).length} live rate(s) reference this vendor (merge into the surviving vendor with merge_vendor instead of deleting rates)`, rateCount: (refs as any[]).length } };
    }
    const title = String((cur as any)?.name ?? id);
    return {
      result: { proposed: true },
      proposals: [{
        kind: 'delete_vendor', label: `Delete vendor: ${title}`,
        text: `Permanently deletes vendor "${title}" (hard delete). No live rates reference it.`,
        vendorId: id,
      }],
    };
  }

  if (name === 'find_duplicates') {
    // Pairwise fuzzy scan over vendors and/or products: exact-after-cleanup
    // pairs plus strong token-overlap pairs, with plain-language reasons.
    // The dupe workflow starts here — then merge, never delete-rates-first.
    const scope = String(args?.scope ?? 'both').toLowerCase();
    const groups: Array<{ scope: string; a: { id: string; name: string }; b: { id: string; name: string }; reason: string }> = [];
    const pairScore = (ta: string[], tb: string[]): number => {
      if (!ta.length || !tb.length) return 0;
      const shared = ta.filter((t) => tb.includes(t));
      return shared.length >= TOKEN_MIN_SHARED ? tokenOverlap(ta, tb) : 0;
    };
    if (scope !== 'products') {
      const vendors = (await getVendorIndex().catch(() => [])) ?? [];
      for (let i = 0; i < vendors.length && groups.length < 20; i++) {
        for (let j = i + 1; j < vendors.length && groups.length < 20; j++) {
          const a = vendors[i] as any; const b = vendors[j] as any;
          if (!a?.name || !b?.name) continue;
          if (vendorCanon(a.name) && vendorCanon(a.name) === vendorCanon(b.name)) {
            groups.push({ scope: 'vendors', a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name }, reason: 'same name after cleanup' });
            continue;
          }
          const ov = pairScore(matchTokens(a.name), matchTokens(b.name));
          if (ov >= Math.max(TOKEN_MIN_SCORE, 0.6)) {
            groups.push({ scope: 'vendors', a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name }, reason: `similar names (overlap ${ov.toFixed(2)})` });
          }
        }
      }
    }
    if (scope !== 'vendors') {
      const products = (await getProductIndex().catch(() => [])) ?? [];
      const pname = (p: any): string[] => [String(p.name ?? ''), ...aliasList((p as any).aliases)];
      for (let i = 0; i < products.length && groups.length < 20; i++) {
        for (let j = i + 1; j < products.length && groups.length < 20; j++) {
          const a = products[i] as any; const b = products[j] as any;
          const an = pname(a).map((s) => norm(s)).filter(Boolean);
          const bn = pname(b).map((s) => String(s)).filter(Boolean);
          if (!an.length || !bn.length) continue;
          if (an.some((x) => bn.map((s) => norm(s)).includes(x))) {
            groups.push({ scope: 'products', a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name }, reason: 'shared name/alias' });
            continue;
          }
          const ov = pairScore(matchTokens(an.join(' ')), matchTokens(bn.join(' ')));
          if (ov >= Math.max(TOKEN_MIN_SCORE, 0.6)) {
            groups.push({ scope: 'products', a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name }, reason: `similar names (overlap ${ov.toFixed(2)})` });
          }
        }
      }
    }
    return { result: { groups, count: groups.length } };
  }

  if (name === 'merge_vendor') {
    // Propose ONLY (Confirm executes): move every rate to the survivor,
    // collapse exact-duplicate rates (newest kept), delete the loser.
    // This is THE answer to "vendor has rates so it can't delete" — merge
    // preserves the data instead of forcing rate deletion.
    const from = String(args?.fromVendorId ?? ''); const into = String(args?.intoVendorId ?? '');
    if (!from || !into) return { result: { error: 'fromVendorId + intoVendorId needed (pick both with find_vendor)' } };
    if (from === into) return { result: { error: 'same vendor on both sides' } };
    const { prisma } = await import('../../shared/prisma');
    const [src, dst] = await Promise.all([
      (prisma as any).vendor.findUnique({ where: { id: from } }).catch(() => null),
      (prisma as any).vendor.findUnique({ where: { id: into } }).catch(() => null),
    ]);
    if (!src) return { result: { error: 'source vendor not found' } };
    if (!dst) return { result: { error: 'target vendor not found' } };
    const rows = await (prisma as any).vendorRate.findMany({ where: { vendorId: from }, select: { id: true } }).catch(() => []);
    const n = (rows as any[]).length;
    return {
      result: { proposed: true, rateCount: n },
      proposals: [{
        kind: 'merge_vendor', label: `Merge ${src.name} → ${dst.name}`,
        text: `Moves ${n} rate(s) from "${src.name}" to "${dst.name}", collapses exact-duplicate rates (newest kept), then deletes "${src.name}".`,
        fromVendorId: from, intoVendorId: into,
      }],
    };
  }

  if (name === 'merge_product') {
    // Propose ONLY (Confirm executes): move rates to the survivor, union
    // aliases (+loser name), carry over non-clashing checklist questions,
    // collapse exact-duplicate rates, recompute missing flags, delete loser.
    const from = String(args?.fromProductId ?? ''); const into = String(args?.intoProductId ?? '');
    if (!from || !into) return { result: { error: 'fromProductId + intoProductId needed (pick both with find_product)' } };
    if (from === into) return { result: { error: 'same product on both sides' } };
    const { prisma } = await import('../../shared/prisma');
    const [src, dst] = await Promise.all([
      (prisma as any).productItem.findUnique({ where: { id: from } }).catch(() => null),
      (prisma as any).productItem.findUnique({ where: { id: into } }).catch(() => null),
    ]);
    if (!src) return { result: { error: 'source product not found' } };
    if (!dst) return { result: { error: 'target product not found' } };
    const rows = await (prisma as any).vendorRate.findMany({ where: { productId: from }, select: { id: true } }).catch(() => []);
    const have = new Set(aliasList((dst as any)?.aliases).map((s) => s.toLowerCase()));
    const adds = [...aliasList((src as any)?.aliases), String((src as any)?.name ?? '')].filter((s) => s && !have.has(s.toLowerCase()));
    const srcGuides = await (prisma as any).kypGuide.findMany({ where: { productId: from }, select: { attrKey: true } }).catch(() => []);
    const dstKeys = new Set((((await (prisma as any).kypGuide.findMany({ where: { productId: into }, select: { attrKey: true } }).catch(() => [])) as any[])).map((g) => String(g.attrKey)));
    const carry = (srcGuides as any[]).filter((g) => !dstKeys.has(String(g.attrKey))).length;
    const n = (rows as any[]).length;
    return {
      result: { proposed: true, rateCount: n, aliasAdds: adds, guideCarry: carry },
      proposals: [{
        kind: 'merge_product', label: `Merge ${src.name} → ${dst.name}`,
        text: `Moves ${n} rate(s) to "${dst.name}", adds aliases [${adds.join(', ') || 'none new'}], carries ${carry} checklist question(s) (survivor wins clashes), collapses duplicate rates, then deletes "${src.name}".`,
        fromProductId: from, intoProductId: into,
      }],
    };
  }

  if (name === 'delete_product') {
    // Propose ONLY (Confirm executes). Blocked by live rates — merge into
    // the surviving product (merge_product) instead of deleting rates.
    // WARNING: its checklist is deleted with it (merge preserves it).
    const id = String(args?.productId ?? '');
    if (!id) return { result: { error: 'productId needed (find it with find_product)' } };
    const { prisma } = await import('../../shared/prisma');
    const cur = await (prisma as any).productItem.findUnique({ where: { id } }).catch(() => null);
    if (!cur) return { result: { error: 'product not found' } };
    const refs = await (prisma as any).vendorRate.findMany({ where: { productId: id }, select: { id: true } }).catch(() => []);
    if ((refs as any[]).length > 0) {
      return { result: { error: `cannot delete — ${(refs as any[]).length} live rate(s) reference this product (merge into the surviving product with merge_product instead of deleting rates)`, rateCount: (refs as any[]).length } };
    }
    const title = String((cur as any)?.name ?? id);
    return {
      result: { proposed: true },
      proposals: [{
        kind: 'delete_product', label: `Delete product: ${title}`,
        text: `Permanently deletes product "${title}" AND its checklist (hard delete). No live rates reference it. To preserve the checklist, merge instead.`,
        productId: id,
      }],
    };
  }

  if (name === 'find_vendor') {
    // Flexible vendor read: fuzzy-ranked matches (near-dupe spellings surface
    // together so the agent picks the survivor instead of drafting a second
    // vendor); empty query lists everything (paged). Include expands rows —
    // rates (latest rate cards) and/or contact (phones + contact person).
    const q = String(args.query ?? '').trim();
    const { limit, offset } = pageArgs(args, 5);
    const inc = includes(args);
    const vendors = await getVendorIndex().catch(() => []);
    const ranked = q ? matchVendors(vendors ?? [], q) : (vendors ?? []).map((v: any) => ({ row: v, exact: false, score: 0, why: 'list' }));
    const total = ranked.length;
    const page = ranked.slice(offset, offset + limit);
    const { prisma } = await import('../../shared/prisma');
    let nameOf: Map<string, string> | null = null;
    if (inc.includes('rates')) {
      const prods = await getProductIndex().catch(() => []);
      nameOf = new Map(((prods ?? []) as any[]).map((p) => [String(p.id), String(p.name ?? '')]));
    }
    const out: Record<string, unknown>[] = [];
    for (const f of page) {
      const v = (f as any).row as any;
      const row: Record<string, unknown> = {
        id: v.id, name: v.name, type: v.vendorType || '', location: v.location,
        active: v.active, match: (f as any).exact ? 'exact' : 'fuzzy', why: (f as any).why,
      };
      if (inc.includes('contact')) {
        const full = await (prisma as any).vendor.findUnique({ where: { id: String(v.id) } }).catch(() => null);
        row.contactPerson = (full as any)?.contactPerson ?? null;
        row.contactPhone1 = (full as any)?.contactPhone1 ?? null;
        row.contactPhone2 = (full as any)?.contactPhone2 ?? null;
      }
      if (inc.includes('rates')) {
        const rows = await (prisma as any).vendorRate.findMany({ where: { vendorId: String(v.id) }, orderBy: [{ quotedAt: 'desc' }], take: 5 }).catch(() => []);
        row.rates = ((rows as any[]) ?? []).map((r) => rateCard({
          ...r, vendorName: v.name,
          productName: nameOf?.get(String((r as any)?.productId ?? '')) ?? String((r as any)?.productId ?? ''),
        }));
      }
      out.push(row);
    }
    return {
      result: { vendors: out, total, truncated: offset + page.length < total },
    };
  }

/** Per-chat draft registry: one draft per distinct payload per chat. Returns
 *  false when this EXACT draft was already proposed — the model must reuse
 *  the existing card, never re-fire. Backs the DEDUPE prompt rule with a
 *  hard server-side guard (kills the 19-duplicate-cards re-fire loop even
 *  when the model disobeys). Keys include the distinguishing fields, so a
 *  genuine correction (new phone) still drafts while an identical re-fire
 *  is refused. Expires with history; wiped on new-chat. */
async function claimDraft(ctx: IntakeCtx, kind: string, key: string): Promise<boolean> {
  try {
    const hk = `copilot:hist:pli:${ctx.who}${ctx.session ? `:${ctx.session}` : ''}:prop`;
    const k = `${kind}:${String(key).trim().toLowerCase()}`;
    const ttl = 30 * 60 * 1000;
    const seen = (await cacheGet<string[]>(hk, ttl).catch(() => null)) ?? [];
    if (seen.includes(k)) return false;
    await cacheSet(hk, [...seen, k].slice(-200), ttl);
    return true;
  } catch {
    return true;
  }
}

  if (name === 'propose_vendor') {
    const nameArg = strField(args.name);
    if (!nameArg) return { result: { error: 'vendor name needed' } };
    const tp = strField(args.vendorType) ?? '';
    const ph = strField(args.phone) ?? '';
    const lc = strField(args.location) ?? '';
    // Catalogue clash (mirrors propose_product): canonical-equal names are
    // the same vendor ("M/S FILTECH" = "Filtech") — never draft-new those.
    const vendors = await getVendorIndex().catch(() => []);
    const canon = vendorCanon(nameArg);
    const clash = (vendors ?? []).find((v: any) => canon && vendorCanon(v.name) === canon);
    if (clash) return { result: { error: `already exists as "${clash.name}" — use its id via find_vendor instead`, vendorId: (clash as any).id } };
    // Strong fuzzy (not canon-equal): warn but still draft — the user
    // confirms identity at Confirm time, or merges afterwards.
    const near = matchVendors(vendors ?? [], nameArg).filter((m) => !m.exact)[0];
    const dupNote = near ? { id: near.row.id, name: near.row.name, why: near.why } : null;
    // Same-chat dupe: identical re-fire refused, reuse the existing card.
    if (!(await claimDraft(ctx, 'vendor', [nameArg, tp, ph, lc].join('|')))) {
      return { result: { error: `already drafted "${nameArg}" this chat — reuse that card, never draft it again`, duplicate: true } };
    }
    const lines = [nameArg];
    if (tp) lines.push(tp);
    if (ph) lines.push(`ph: ${ph}`);
    if (lc) lines.push(lc);
    if (dupNote) lines.push(`⚠ possible duplicate of "${dupNote.name}" (${dupNote.why}) — confirm same, or keep both`);
    return {
      result: { proposed: true, ...(dupNote ? { possibleDuplicateOf: dupNote } : {}) },
      proposals: [{
        kind: 'vendor_draft', label: `New vendor: ${nameArg}`,
        text: lines.join(' · '),
        name: nameArg, vendorType: tp, phone: ph, location: lc,
      }],
    };
  }

  if (name === 'propose_product') {
    const nameArg = strField(args.name);
    const catArg = strField(args.category, 120);
    if (!nameArg) return { result: { error: 'product name needed — ask the user' } };
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
    // Same-chat dupe: identical re-fire refused, reuse the existing card.
    if (!(await claimDraft(ctx, 'product', [nameArg, catHit].join('|')))) {
      return { result: { error: `already drafted "${nameArg}" this chat — reuse that card, never draft it again`, duplicate: true } };
    }
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
    // Stateless: the full draft arrives in args (the model holds working
    // state in-conversation). Normalize here so the card shows clean values.
    const { normalizeSpecValue: nsv, normalizeUnit: nu } = await import('./normalize');
    const d: IntakeDraft = { specs: {} };
    for (const f of ['rateId', 'productId', 'productName', 'productCategory', 'vendorId', 'vendorName', 'vendorType', 'vendorPhone', 'vendorLocation', 'moq', 'packQty', 'packDims'] as const) {
      const v = strField((args as any)[f]);
      if (v !== undefined) (d as any)[f] = v;
    }
    const u0 = nu(strField((args as any).unit, 120) ?? '');
    if (u0 !== undefined) d.unit = u0;
    for (const f of ['price', 'discount', 'delivery', 'weight'] as const) {
      const v = numField((args as any)[f]);
      if (v !== undefined) (d as any)[f] = v;
    }
    const qd0 = validDate((args as any).quotedAt);
    if (qd0) d.quotedAt = qd0;
    const sp0 = (args as any).specs;
    if (sp0 && typeof sp0 === 'object') {
      for (const [k, v] of Object.entries(sp0 as Record<string, unknown>)) {
        const key = String(k).trim().slice(0, 120);
        const val = nsv(v);
        if (key && val) d.specs[key] = val;
      }
    }
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
    // Specs are OPTIONAL at filing: unanswered required questions ride along
    // as missingSpecs on the rate (flagged, never silently complete).
    const missingSpecQs = req.filter((q) => !String(d.specs[q.key] ?? '').trim());
    if (missingFields.length > 0) {
      return { result: { error: 'commercial details missing from the quote', missingFields } };
    }
    const gaps = missing(d, req);
    // Same-chat dupe: identical rate re-fire refused (identity = vendor +
    // product + price + unit + sorted specs). Filing itself also upserts,
    // so this guard only kills the duplicate CARD.
    const specKey = Object.keys(d.specs ?? {}).sort().map((k) => `${k}=${(d.specs as any)[k]}`).join('|');
    if (!(await claimDraft(ctx, 'rate', [d.vendorId ?? d.vendorName, d.productId ?? d.productName, d.price, d.unit, specKey].join('|')))) {
      return { result: { error: 'already drafted this exact rate this chat — reuse that card, never draft it again', duplicate: true } };
    }
    const draftTag = String(args?.label ?? '').slice(0, 40);
    const title = `${draftTag ? `${draftTag} · ` : ''}${d.productName ?? d.productId} @ ₹${d.price}/${d.unit} — ${d.vendorName ?? d.vendorId}`;
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
    const specNote = missingSpecQs.length
      ? `Specs missing (${missingSpecQs.length}) — filed anyway, flagged: ${missingSpecQs.map((q) => q.question.slice(0, 60)).join('; ')}`
      : 'No gaps — all required details captured.';
    const text = [title, ...specLines, ...extraLines, specNote].join('\n');
    return {
      result: { proposed: true, gaps, missingSpecs: missingSpecQs.map((q) => q.question) },
      proposals: [{
        kind: 'rate_draft', label: `Add rate: ${title}`,
        text,
        draft: {
          rateId: (d as any).rateId, productId: d.productId, productName: d.productName, productCategory: d.productCategory,
          vendorId: d.vendorId, vendorName: d.vendorName,
          price: d.price, unit: d.unit, discount: d.discount, moq: d.moq, delivery: d.delivery,
          weight: d.weight, packQty: d.packQty, packDims: d.packDims, quotedAt: d.quotedAt,
          specs: { ...d.specs },
        },
        missingSpecs: missingSpecQs.map((q) => q.question),
      }],
    };
  }

  return { result: { error: `unknown tool ${name}` } };
}

async function executeProposal(ctx: IntakeCtx, action: Record<string, any>): Promise<CopilotExecResult> {
  const kind = String(action?.kind ?? '');
  const fail = (error: string, status = 400): CopilotExecResult => ({ result: { status, body: { error } }, applied: 'none' });
  // STATELESS: every proposal carries its full payload — execute never reads
  // a session. Draft fields arrive under action.draft (rate_draft) or
  // action.rates[] (commit_all_draft).

  if (kind === 'vendor_draft') {
    const nameV = strField(action?.name);
    if (!nameV) return fail('vendor name required');
    try {
      const vendors = await getVendorIndex().catch(() => []);
      const existing = (vendors ?? []).find((v: any) => String(v.name ?? '').toLowerCase() === nameV.toLowerCase());
      if (existing) {
        return { result: { status: 200, body: { ok: true, id: String((existing as any).id), existed: true, live: 'product-line' } }, applied: 'vendor_draft' };
      }
      const row: any = await createVendor({
        name: nameV,
        vendorType: strField(action?.vendorType, 120) ?? '',
        contactPhone1: strField(action?.phone, 120) ?? null,
        location: strField(action?.location) ?? null,
      });
      await invalidateProductLineCache().catch(() => {});
      return { result: { status: 201, body: { ok: true, id: row.id, live: 'product-line' } }, applied: 'vendor_draft' };
    } catch (e: any) {
      return fail(String(e?.message ?? 'vendor create failed').slice(0, 300));
    }
  }

  if (kind === 'product_draft') {
    const nameV = strField(action?.name);
    const catRaw = strField(action?.category, 120);
    if (!nameV || !catRaw) return fail('product name + category required');
    const cats = await liveCategories().catch(() => [] as string[]);
    const cat = cats.find((c) => c.toLowerCase() === catRaw.toLowerCase());
    if (!cat) return fail(`unknown category "${catRaw}"`);
    try {
      const products = await getProductIndex().catch(() => []);
      const clash = matchProducts(products, nameV)[0];
      if (clash) {
        return { result: { status: 200, body: { ok: true, id: clash.row.id, existed: true, live: 'product-line' } }, applied: 'product_draft' };
      }
      const row: any = await createProduct({ name: nameV, category: cat });
      await invalidateProductLineCache().catch(() => {});
      return { result: { status: 201, body: { ok: true, id: row.id, live: 'product-line' } }, applied: 'product_draft' };
    } catch (e: any) {
      return fail(String(e?.message ?? 'product create failed').slice(0, 300));
    }
  }

  if (kind === 'rate_draft') {
    try {
      const d = { specs: {}, ...((action?.draft ?? {}) as Record<string, unknown>) } as IntakeDraft;
      if (!d.specs || typeof d.specs !== 'object') d.specs = {};
      const receipt = await fileDraft(d);
      await invalidateProductLineCache().catch(() => {});
      return { result: { status: 201, body: { ok: true, id: receipt.rateId, updated: receipt.updated, missing: receipt.missing, live: 'product-line' } }, applied: 'rate_draft' };
    } catch (e: any) {
      return fail(String(e?.message ?? 'rate create failed').slice(0, 300));
    }
  }

  if (kind === 'commit_all_draft') {
    // One Confirm for the whole table: file each payload rate (create or
    // update via identity match), collect receipts + failures.
    try {
      const rates = Array.isArray(action?.rates) ? action.rates : [];
      if (!rates.length) return fail('no rates in proposal');
      const filed: FiledRate[] = [];
      const failed: { index: number; error: string }[] = [];
      for (let i = 0; i < rates.length; i++) {
        try {
          const d = { specs: {}, ...((rates[i] ?? {}) as Record<string, unknown>) } as IntakeDraft;
          if (!d.specs || typeof d.specs !== 'object') d.specs = {};
          filed.push(await fileDraft(d));
        } catch (e: any) {
          failed.push({ index: i + 1, error: String(e?.message ?? 'file failed').slice(0, 200) });
        }
      }
      await invalidateProductLineCache().catch(() => {});
      return { result: { status: 201, body: { ok: true, filed, failed, live: 'product-line' } }, applied: 'commit_all_draft' };
    } catch (e: any) {
      return fail(String(e?.message ?? 'commit failed').slice(0, 300));
    }
  }

  if (kind === 'delete_rate') {
    const id = String((action as any)?.rateId ?? '');
    if (!id) return fail('rateId required');
    try {
      const { deleteRate } = await import('./update');
      await deleteRate(id);
      await invalidateProductLineCache().catch(() => {});
      return { result: { status: 200, body: { ok: true, id, live: 'product-line' } }, applied: 'delete_rate' };
    } catch (e: any) {
      return fail(String(e?.message ?? 'rate delete failed').slice(0, 300));
    }
  }

  if (kind === 'delete_vendor') {
    const id = String((action as any)?.vendorId ?? '');
    if (!id) return fail('vendorId required');
    try {
      const { deleteVendor } = await import('./update');
      await deleteVendor(id);
      await invalidateProductLineCache().catch(() => {});
      return { result: { status: 200, body: { ok: true, id, live: 'product-line' } }, applied: 'delete_vendor' };
    } catch (e: any) {
      return fail(String(e?.message ?? 'vendor delete failed').slice(0, 300));
    }
  }

  if (kind === 'delete_product') {
    const id = String((action as any)?.productId ?? '');
    if (!id) return fail('productId required');
    try {
      const { deleteProduct } = await import('./update');
      await deleteProduct(id);
      await invalidateProductLineCache().catch(() => {});
      return { result: { status: 200, body: { ok: true, id, live: 'product-line' } }, applied: 'delete_product' };
    } catch (e: any) {
      return fail(String(e?.message ?? 'product delete failed').slice(0, 300));
    }
  }

  if (kind === 'merge_vendor') {
    const from = String((action as any)?.fromVendorId ?? '');
    const into = String((action as any)?.intoVendorId ?? '');
    if (!from || !into) return fail('fromVendorId + intoVendorId required');
    if (from === into) return fail('same vendor');
    try {
      const { prisma } = await import('../../shared/prisma');
      const { updateRate, deleteVendor } = await import('./update');
      const src = await (prisma as any).vendor.findUnique({ where: { id: from } }).catch(() => null);
      const dst = await (prisma as any).vendor.findUnique({ where: { id: into } }).catch(() => null);
      if (!src) return fail('source vendor not found');
      if (!dst) return fail('target vendor not found');
      const rows = ((await (prisma as any).vendorRate.findMany({ where: { vendorId: from }, select: { id: true, productId: true } }).catch(() => [])) as any[]);
      const pids = new Set<string>();
      for (const r of rows) {
        await updateRate(String(r.id), { vendorId: into }).catch(() => null);
        if (r?.productId) pids.add(String(r.productId));
      }
      let dropped = 0;
      for (const pid of pids) dropped += await dedupeRates(pid, into);
      await deleteVendor(from);
      await invalidateProductLineCache().catch(() => {});
      return { result: { status: 200, body: { ok: true, moved: rows.length, droppedDuplicates: dropped, live: 'product-line' } }, applied: 'merge_vendor' };
    } catch (e: any) {
      return fail(String(e?.message ?? 'vendor merge failed').slice(0, 300));
    }
  }

  if (kind === 'merge_product') {
    const from = String((action as any)?.fromProductId ?? '');
    const into = String((action as any)?.intoProductId ?? '');
    if (!from || !into) return fail('fromProductId + intoProductId required');
    if (from === into) return fail('same product');
    try {
      const { prisma } = await import('../../shared/prisma');
      const { updateRate, deleteProduct, updateProduct } = await import('./update');
      const src = await (prisma as any).productItem.findUnique({ where: { id: from } }).catch(() => null);
      const dst = await (prisma as any).productItem.findUnique({ where: { id: into } }).catch(() => null);
      if (!src) return fail('source product not found');
      if (!dst) return fail('target product not found');
      // Aliases union (+loser name) onto the survivor.
      const have = new Set(aliasList((dst as any)?.aliases).map((s) => s.toLowerCase()));
      const adds = [...aliasList((src as any)?.aliases), String((src as any)?.name ?? '')].filter((s) => s && !have.has(s.toLowerCase()));
      if (adds.length) {
        await updateProduct(into, { aliases: [...aliasList((dst as any)?.aliases), ...adds] }).catch(() => null);
      }
      // Non-clashing checklist questions ride along (survivor wins clashes).
      const dstKeys = new Set((((await (prisma as any).kypGuide.findMany({ where: { productId: into }, select: { attrKey: true } }).catch(() => [])) as any[])).map((g) => String(g.attrKey)));
      const srcGuides = ((await (prisma as any).kypGuide.findMany({ where: { productId: from } }).catch(() => [])) as any[]);
      let carried = 0;
      for (const g of srcGuides) {
        if (dstKeys.has(String(g.attrKey))) continue;
        await (prisma as any).kypGuide.update({ where: { id: String(g.id) }, data: { productId: into } }).catch(() => null);
        carried++;
      }
      // Rates move + missing flags recomputed against the survivor checklist.
      const rows = ((await (prisma as any).vendorRate.findMany({ where: { productId: from }, select: { id: true } }).catch(() => [])) as any[]);
      for (const r of rows) {
        await updateRate(String(r.id), { productId: into }).catch(() => null);
        await refreshMissing(String(r.id), into);
      }
      // Identity collapse per vendor, then the loser (now rate-free) goes.
      const vendors = new Set<string>();
      const moved = ((await (prisma as any).vendorRate.findMany({ where: { productId: into }, select: { id: true, vendorId: true } }).catch(() => [])) as any[]);
      for (const r of moved) if (r?.vendorId) vendors.add(String(r.vendorId));
      let dropped = 0;
      for (const vid of vendors) dropped += await dedupeRates(into, vid);
      await deleteProduct(from);
      await invalidateProductLineCache().catch(() => {});
      return { result: { status: 200, body: { ok: true, moved: rows.length, droppedDuplicates: dropped, aliasAdds: adds, guideCarry: carried, live: 'product-line' } }, applied: 'merge_product' };
    } catch (e: any) {
      return fail(String(e?.message ?? 'product merge failed').slice(0, 300));
    }
  }

  return fail('unknown action');
}

const TOOL_DEFS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'split_quotes',
      description: 'The pasted blob holds SEVERAL vendor quotes: split into numbered items (no limit — a 200-line price list splits into 200) and work each by number. Values the vendor did not state are left empty — never invented. Nothing is stored; the conversation holds the list.',
      parameters: {
        type: 'object',
        properties: { quotes: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' } } } } },
        required: ['quotes'],
      },
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
          label: { type: 'string', description: 'Your own tag for this quote (e.g. #3) — echoed back so multi-quote threads stay readable' },
        },
      },
    },
  },
    {
      type: 'function',
      function: {
        name: 'find_product',
        description: 'Flexible catalogue read: match by name/alias/category, or empty query to list everything (paged). include expands rows: quotes (latest rate cards) and/or checklist (full requirement list — replaces a required_specs round-trip). Reports total + truncated; page with offset. Single exact hit returns resolvedProductId — set it via update_draft, never draft new.',
        parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' }, offset: { type: 'number' }, include: { type: 'array', items: { type: 'string' } } } },
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
      description: 'Render the missing-details form as an interactive questionnaire — call this instead of asking for specs in prose. Pass productId + already-known answers so answered questions are skipped; options come from past quote values. The user fills it and the answers arrive as their next message — file them with update_draft.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string' }, label: { type: 'string' },
          specs: { type: 'object' },
          price: { type: 'number' }, unit: { type: 'string' }, discount: { type: 'number' },
          moq: { type: 'string' }, delivery: { type: 'number' },
          weight: { type: 'number' }, packQty: { type: 'string' }, packDims: { type: 'string' },
          quotedAt: { type: 'string' },
        },
        required: ['productId'],
      },
    },
  },
  {
    type: 'function',
    function: {
        name: 'find_vendor',
        description: 'Flexible vendor read: fuzzy match by name, or empty query to list all vendors (paged). include expands rows: rates (latest rate cards) and/or contact (phones + contact person). Reports total + truncated; page with offset.',
        parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' }, offset: { type: 'number' }, include: { type: 'array', items: { type: 'string' } } } },
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
      description: 'Draft ONE rate for user confirm. Pass the complete captured state (product + vendor + commercials + specs) — it is validated here: missing commercials are returned as errors (ask the user), unknown SPECS do NOT block (they file flagged as missing).',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          rateId: { type: 'string', description: 'Prior filing receipt: updates that exact rate' },
          productId: { type: 'string' }, productName: { type: 'string' }, productCategory: { type: 'string' },
          vendorId: { type: 'string' }, vendorName: { type: 'string' },
          price: { type: 'number' }, unit: { type: 'string' }, discount: { type: 'number' },
          moq: { type: 'string' }, delivery: { type: 'number' },
          weight: { type: 'number' }, packQty: { type: 'string' }, packDims: { type: 'string' },
          quotedAt: { type: 'string' }, specs: { type: 'object' },
        },
      },
      },
    },
  {
    type: 'function',
    function: {
      name: 'commit_all',
      description: 'Present the WHOLE table for one Confirm: pass every captured rate (product + vendor + price + unit + specs + commercials each). Returns a single consolidated proposal listing each row + what is missing per row. On Confirm, each files (create or update via vendor+product+spec identity — never duplicates; unknown specs flagged). Use after split_quotes + extraction, when the user pastes several prices or says file/add everything.',
      parameters: {
        type: 'object',
        properties: {
          rates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                rateId: { type: 'string', description: 'Prior filing receipt: updates that exact rate' },
                productId: { type: 'string' }, productName: { type: 'string' }, productCategory: { type: 'string' },
                vendorId: { type: 'string' }, vendorName: { type: 'string' },
                price: { type: 'number' }, unit: { type: 'string' }, discount: { type: 'number' },
                moq: { type: 'string' }, delivery: { type: 'number' },
                weight: { type: 'number' }, packQty: { type: 'string' }, packDims: { type: 'string' },
                quotedAt: { type: 'string' }, specs: { type: 'object' },
              },
              required: ['price', 'unit'],
            },
          },
        },
        required: ['rates'],
      },
    },
  },
  {
    type: 'function',
    function: {
        name: 'find_rate',
        description: 'Flexible live-rate read: no filters = whole book newest-first (paged); query/vendor narrow it. include commercials adds discount/MOQ/delivery/weight/pack + ids to each card. Reports total + truncated; page with offset. Use before correcting an already-filed rate.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' }, vendor: { type: 'string' }, limit: { type: 'number' }, offset: { type: 'number' }, include: { type: 'array', items: { type: 'string' } } },
        },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_rate',
      description: 'Patch a LIVE rate directly (no confirm): price, unit, discount, moq, delivery, weight, packQty, packDims, quotedAt, specs object (merged). Missing-spec flags recompute automatically. Use when the user supplies missing info for rates you already filed — updates in place, never creates a second rate.',
      parameters: {
        type: 'object',
        properties: {
          rateId: { type: 'string' },
          pricePerUnit: { type: 'number' }, unit: { type: 'string' }, discountPercent: { type: 'number' },
          moq: { type: 'string' }, deliveryDays: { type: 'number' },
          weightPerUnit: { type: 'number' }, packageQty: { type: 'string' }, packageDims: { type: 'string' },
          quotedAt: { type: 'string' }, specs: { type: 'object' },
        },
        required: ['rateId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_vendor',
      description: 'Patch a LIVE vendor directly (no confirm): name, phone, contactPerson, contactPhone2, location, address, vendorType, active. Use when a newer quote corrects vendor details — updates in place, never creates a second vendor.',
      parameters: {
        type: 'object',
        properties: {
          vendorId: { type: 'string' },
          name: { type: 'string' }, phone: { type: 'string' }, contactPerson: { type: 'string' },
          contactPhone2: { type: 'string' }, location: { type: 'string' }, address: { type: 'string' },
          vendorType: { type: 'string' }, active: { type: 'boolean' },
        },
        required: ['vendorId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_rate',
      description: 'Propose deleting a LIVE rate (files ONLY on user Confirm — hard delete, not hide). Find it with find_rate first and show the user exactly what will go.',
      parameters: {
        type: 'object',
        properties: { rateId: { type: 'string' } },
        required: ['rateId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_vendor',
      description: 'Propose deleting a vendor (files ONLY on user Confirm — hard delete). Blocked while any live rate references the vendor — merge_vendor into the survivor instead. Find it with find_vendor first.',
      parameters: {
        type: 'object',
        properties: { vendorId: { type: 'string' } },
        required: ['vendorId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_product',
      description: 'Propose deleting a product AND its checklist (files ONLY on user Confirm — hard delete). Blocked while any live rate references it — merge_product into the survivor instead. To preserve the checklist, always prefer merge.',
      parameters: {
        type: 'object',
        properties: { productId: { type: 'string' } },
        required: ['productId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_duplicates',
      description: 'Scan vendors and/or products for likely duplicates (exact-after-cleanup + fuzzy name matches with reasons). Run whenever two similar names appear, before drafting a second copy. Scope: vendors, products, or both.',
      parameters: {
        type: 'object',
        properties: { scope: { type: 'string', description: 'vendors | products | both' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'merge_vendor',
      description: 'Propose merging a duplicate vendor into its survivor (files ONLY on Confirm): moves every rate to the survivor, collapses exact-duplicate rates (newest kept), deletes the loser. THE answer to "vendor has rates so it cannot delete" — data preserved, never deleted.',
      parameters: {
        type: 'object',
        properties: { fromVendorId: { type: 'string' }, intoVendorId: { type: 'string' } },
        required: ['fromVendorId', 'intoVendorId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'merge_product',
      description: 'Propose merging a duplicate product into its survivor (files ONLY on Confirm): moves rates, unions aliases (+loser name), carries non-clashing checklist questions, collapses duplicate rates, recomputes missing flags, deletes the loser.',
      parameters: {
        type: 'object',
        properties: { fromProductId: { type: 'string' }, intoProductId: { type: 'string' } },
        required: ['fromProductId', 'intoProductId'],
      },
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
  buildCtx: (env, me, extra) => ({
    env, me,
    who: String(me?.user?.email ?? me?.user?.id ?? 'anon').toLowerCase(),
    // Volatile conversation id (client-minted per visible chat). Present =
    // memory is scoped to this conversation and dies with it; absent =
    // legacy user-wide memory (old bundles, curl).
    session: String((extra as any)?.session ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64),
  }),
  sessionKey: (ctx) => `copilot:intake:pl:${ctx.who}${ctx.session ? `:${ctx.session}` : ''}`,
  historyKey: (ctx) => `copilot:hist:pli:${ctx.who}${ctx.session ? `:${ctx.session}` : ''}`,
  historyTtlMs: 30 * 60 * 1000,
  historyMaxMsgs: 100,
  countKey: () => 'copilot:count:product-line-intake',
  systemPrompt: () => (
    'You are the procurement intake assistant for the BUI catalogue. The user pastes vendor quotes — one, or a blob with several. Your job: extract, show a table of what you got + what is missing, then file on Confirm. NEVER pull the catalogue or the full KYP sheet into context; fetch only what you need. Your tool outputs automatically carry into the next turn — on "continue", pick up exactly where the trace ends (captured drafts, matches, checklists); never restart, never claim the thread is empty. ' +
    'How a turn goes — 1) READ the message (prior turns are recalled automatically; never claim to be new). 2) If it holds SEVERAL quotes, call split_quotes first (no limit — 200 lines split into 200), then work items by number (#1, #2…). For very large pastes, work through the blob in order across turns and say "done through #N of M" after each stretch so progress survives; commit each finished stretch with commit_all (no per-call limit — one table per stretch keeps Confirms reviewable). SPEED: fire independent calls TOGETHER in one block — all captures at once, all product matches at once, all vendor lookups at once — instead of one item per round; they execute in parallel. Reads pull what you ask: empty query + high limit lists everything at once; include expands each row (products: quotes/checklist; vendors: rates/contact; rates: commercials); every search reports total + truncated, so page big lists with offset. 3) Extract facts with update_draft — write values AS the vendor wrote them (4", mtr, nos auto-normalize to 4 inch / meter / pcs). 4) Resolve each product with find_product: single exact hit = EXISTS (use its id, never create); several = ask the user to pick, never guess; zero = ask name + category, then propose_product (category from the live list only — invented ones are rejected). 5) required_specs ONCE per product, then ask_specs renders the missing-details form (options come from past quotes) instead of prose questions. 6) find_vendor: exact hit = use id; none = propose_vendor. 7) propose_vendor/propose_product first for anything new, then propose_rate per item — or ONE commit_all with the whole table when several items are ready. TALLIES FROM RECEIPTS ONLY: filed/blocked counts come strictly from execute + commit tool results in this session — never estimate, never restate totals from memory; if unsure, say exactly what is and is not confirmed. If the user says "continue" but you have NO trace and NO blob in history, the earlier work died before it was saved — say so plainly and ask them to re-paste; never answer empty. ' +
    'TABLE FIRST: before filing multiple items, show a compact table — one row per item (product, vendor, price/unit, missing). Then the proposal(s). After Confirm, report per-rate results (created vs updated) + what is still missing per rate. Later corrections (user supplies missing info for some or all) UPDATE the same rates via commit_all again or update_rate — never second rates. ' +
    'DATA FIDELITY (highest rule): maintain data accuracy — NEVER hallucinate, invent, guess, or fill gaps with plausible-looking values. Every filed value must come from the vendor text or the user; anything unstated stays missing and flagged, never fabricated. EXTRACTION TO THE END: read each quote fully and capture EVERYTHING present — product, vendor + vendor type, phone, location/address, price, unit, discount, MOQ, weight, pack qty + pack dims, delivery days, quote date, and every spec — not just name + price. A new vendor without its phone/location, or a quote without its commercials, is an incomplete capture: go back to the text before drafting. ' +
    'Gates: filing needs product + vendor + price + unit. Unknown SPECS do not block — they file flagged as missing (say which). Missing commercials block the card — ask the user. Use raw question text in replies, never attrKey slugs. Keep replies short. ' +
    'Updates: rate corrections → update_rate directly; vendor detail corrections (phone/location from a newer quote) → update_vendor directly. Deletes: find the item first (find_rate / find_vendor), show the user exactly what will go, then propose the delete (delete_rate / delete_vendor / delete_product) — it files ONLY on Confirm, like creates. DEDUPE + RECEIPTS (hard rule): ONE draft per distinct vendor / product / rate per chat — check your trace before proposing; an identical draft already proposed MUST be reused, never re-fired (the tool refuses duplicates — that error means the card already exists, use it). A tool result of {proposed:true} IS the delivery receipt: the card is with the user. Re-firing never fixes anything, it only multiplies cards. Past ~5 new drafts, pause and present the table for Confirm before drafting more. DUPLICATES (the designed flow): same vendor spelled two ways or same product twice → run find_duplicates, show the pairs, then MERGE into the survivor (merge_vendor / merge_product: rates move over, aliases + checklist questions union, exact-duplicate rates collapse newest-kept, loser deleted — all on Confirm). A delete blocked by live rates is a MERGE signal, never a reason to delete rates. Never keep known duplicates side by side.'
  ),
  toolDefs: () => TOOL_DEFS,
  execTool,
  activityLabel: (name, args, out) => {
    const r = (out.result ?? {}) as Record<string, any>;
    switch (name) {
      case 'split_quotes': return `Split ${(r as any)?.drafts ?? 0} quotes`;
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
      case 'commit_all': {
        const n = Number((r as any)?.rates ?? 0);
        return r.error ? 'Table failed' : `Tabled ${n} rate${n === 1 ? '' : 's'} for confirm`;
      }
      case 'find_rate': {
        const n = Array.isArray(r.rates) ? r.rates.length : 0;
        return `Rate lookup · ${n} match${n === 1 ? '' : 'es'}`;
      }
      case 'update_rate': return r.error ? 'Rate update failed' : 'Updated live rate';
      case 'update_vendor': return r.error ? 'Vendor update failed' : 'Updated vendor';
      case 'delete_rate': return r.error ? 'Rate delete blocked' : 'Drafted rate delete for confirm';
      case 'delete_vendor': return r.error ? 'Vendor delete blocked' : 'Drafted vendor delete for confirm';
      case 'delete_product': return r.error ? 'Product delete blocked' : 'Drafted product delete for confirm';
      case 'find_duplicates': {
        const n = Number((r as any)?.count ?? 0);
        return n ? `Found ${n} possible duplicate${n === 1 ? '' : 's'}` : 'No duplicates found';
      }
      case 'merge_vendor': return r.error ? 'Vendor merge blocked' : `Drafted vendor merge for confirm (${Number((r as any)?.rateCount ?? 0)} rates)`;
      case 'merge_product': return r.error ? 'Product merge blocked' : `Drafted product merge for confirm (${Number((r as any)?.rateCount ?? 0)} rates)`;
      default:
        return `Ran ${name}`;
    }
  },
  executeProposal,
  activityStartLabel: (name) => {
    switch (name) {
      case 'split_quotes': return 'Splitting quotes…';
      case 'update_draft': return 'Capturing details…';
      case 'find_product': return 'Matching catalogue…';
      case 'required_specs': return 'Pulling checklist…';
      case 'ask_specs': return 'Preparing questions…';
      case 'find_vendor': return 'Looking up vendors…';
      case 'propose_vendor': return 'Drafting vendor…';
      case 'propose_product': return 'Drafting product…';
      case 'propose_rate': return 'Drafting rate…';
      case 'commit_all': return 'Building table…';
      case 'find_rate': return 'Checking existing rates…';
      case 'update_rate': return 'Updating rate…';
      case 'update_vendor': return 'Updating vendor…';
      case 'delete_rate': return 'Drafting rate delete…';
      case 'delete_vendor': return 'Drafting vendor delete…';
      case 'delete_product': return 'Drafting product delete…';
      case 'find_duplicates': return 'Scanning for duplicates…';
      case 'merge_vendor': return 'Drafting vendor merge…';
      case 'merge_product': return 'Drafting product merge…';
      default: return `Running ${name}…`;
    }
  },
  modelEnvVar: 'COPILOT_MODEL',
  defaultModel: 'deepseek/deepseek-v4.1-flash',
  // Shown ONLY when the model returns literally nothing (no text, no tool
  // calls) — almost always "continue" into a chat that holds no earlier
  // work (fresh panel = fresh memory by design), or a one-off empty model
  // response. Worded to say that instead of sounding like a refusal.
  emptyHint: 'Nothing came back for that — this chat holds no earlier quote (a fresh panel starts with a clean memory). Paste the vendor quote and I’ll work it; if we were mid-blob, re-paste it and I’ll pick up from there.',
  // NO step ceiling (founder order): the turn runs until the model answers,
  // however many tool calls that takes. Only guard is the hourly turn cap
  // (root bypasses it), which bounds spend without bounding the AI mid-turn.
  maxSteps: Number.POSITIVE_INFINITY,
  // NO input caps (founder order): 200-line pastes ride whole through every
  // stage — per-result, trace, and history caps are sized so nothing is
  // ever sliced. Price: big blobs mean big prompts; that is accepted.
  toolResultCap: 64_000,
  traceCap: 128_000,
  historyRecentCap: 64_000,
  historyStoreCap: 100_000,
  historyTotalCap: 200_000,
  // Wide parallel fan-out: intake tools are pure + stateless, so batched
  // calls resolve together instead of one round-trip per quote.
  maxParallelTools: 8,
  keepToolOutputs: true,
};
