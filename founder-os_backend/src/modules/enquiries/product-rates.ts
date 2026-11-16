// product-rates.ts — known Product Line vendor rates for one enquiry item.
//
// Privileged desks only (procurement scope or Management Review — the same
// gate as canSeeProcurementRequests, enforced at the route). Resolution:
// confident deterministic hit → rates (free, no LLM); miss → the shared AI
// catalogue resolver (catalogue-resolve.ts: text only, 0.65 gate, KV-cached);
// AI miss → rankProducts candidates for the user to pick by hand, no match
// returns empty (the item view simply shows no picker — quiet, never
// blocking).
// Reads the live tables through the cached product-line accessors; vendor
// identity is included on purpose (both desks already see vendors) — sales
// never reaches this module (no picker on the sales surface, redaction
// unchanged).
//
// Mirror: founder-os_frontend/src/enquiry/api.ts (KnownRateRow wire shape).
import { getProductDetail, getProductIndex, getRatesForProduct } from '../../automations/product-line/service';
import { rankProducts, resolveProduct, type MatchProduct } from '../../automations/product-line/match';
import { resolveCatalogueItem } from './catalogue-resolve';

export interface KnownRateRow {
  id: string;
  vendorName: string;
  vendorType: string;
  pricePerUnit: number;
  unit: string;
  discountPercent: number | null;
  moq: string | null;
  deliveryDays: number | null;
  quotedAt: string;
  /** Captured spec snapshot (attrKey → value), displayed as-is. */
  specs: Record<string, string>;
}

export interface KnownProductHit {
  id: string;
  name: string;
  category: string;
  exact: boolean;
}

export interface KnownRateCandidate {
  id: string;
  name: string;
  category: string;
  score: number;
}

export interface KnownRatesResult {
  product: KnownProductHit | null;
  exact: boolean;
  /** How the product was found: confident deterministic tiers, or the AI
   *  fallback (the picker may label AI-matched rows for trust). */
  source: 'exact' | 'llm' | null;
  rates: KnownRateRow[];
  /** attrKey → guide question, so the picker labels specs (not raw slugs). */
  specLabels: Record<string, string>;
  candidates: KnownRateCandidate[];
}

function toMatchProducts(rows: any[]): MatchProduct[] {
  return (rows ?? []).map((p: any) => ({
    id: String(p?.id ?? ''),
    category: String(p?.category ?? ''),
    name: String(p?.name ?? ''),
    aliases: Array.isArray(p?.aliases) ? p.aliases.map((s: any) => String(s)) : [],
    active: (p as any)?.active !== false,
  })).filter((p) => p.id);
}

function toKnownRates(rows: any[]): KnownRateRow[] {
  return ((rows as any[]) ?? [])
    .filter((r) => r && (r as any).active !== false && (r as any).pricePerUnit != null)
    .map((r: any) => ({
      id: String(r.id ?? ''),
      vendorName: String((r as any).vendorName ?? ''),
      vendorType: String((r as any).vendorType ?? ''),
      pricePerUnit: Number((r as any).pricePerUnit),
      unit: String((r as any).unit ?? ''),
      discountPercent: (r as any).discountPercent != null ? Number((r as any).discountPercent) : null,
      moq: (r as any).moq != null ? String((r as any).moq) : null,
      deliveryDays: (r as any).deliveryDays != null ? Number((r as any).deliveryDays) : null,
      quotedAt: String((r as any).quotedAt ?? ''),
      specs: ((r as any).attrValues && typeof (r as any).attrValues === 'object' ? (r as any).attrValues : {}) as Record<string, string>,
    }))
    .filter((r) => r.id && r.vendorName && Number.isFinite(r.pricePerUnit));
}

async function specLabelsFor(productId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const detail = await getProductDetail(String(productId));
    for (const g of ((detail as any)?.guide ?? []) as any[]) {
      if (g && g.active !== false && g.active !== 0 && g.attrKey) out[String(g.attrKey)] = String(g.question ?? g.attrKey);
    }
  } catch { /* product without a guide — specs still display raw */ }
  return out;
}

async function ratesFor(productId: string): Promise<{ rates: KnownRateRow[]; specLabels: Record<string, string> }> {
  const [rows, specLabels] = await Promise.all([
    getRatesForProduct(String(productId)).catch(() => []),
    specLabelsFor(productId),
  ]);
  return { rates: toKnownRates(rows), specLabels };
}

/** Known rates for an enquiry item name (or a chosen productId).
 *  Resolution: confident deterministic hit → rates (free, no LLM); miss →
 *  the shared AI catalogue resolver (text only, 0.65 gate, KV-cached);
 *  AI miss → rankProducts candidates for the user to pick. */
export async function lookupKnownRates(
  env: any,
  input: { name?: unknown; spec?: unknown; dims?: unknown; qty?: unknown; productId?: unknown },
): Promise<KnownRatesResult> {
  const pid = String(input?.productId ?? '').trim();
  const products = toMatchProducts(await getProductIndex().catch(() => []));

  if (pid) {
    const row = products.find((p) => p.id === pid);
    if (!row) return { product: null, exact: false, source: null, rates: [], specLabels: {}, candidates: [] };
    const { rates, specLabels } = await ratesFor(pid);
    return {
      product: { id: row.id, name: row.name, category: row.category, exact: true },
      exact: true,
      source: 'exact',
      rates,
      specLabels,
      candidates: [],
    };
  }

  const name = String(input?.name ?? '').trim();
  if (!name) return { product: null, exact: false, source: null, rates: [], specLabels: {}, candidates: [] };

  // Confident deterministic hit only — anything fuzzy goes to AI, never
  // straight to rates.
  const hit = resolveProduct(products, name, '');
  if (hit?.exact) {
    const { rates, specLabels } = await ratesFor(hit.product.id);
    return {
      product: { id: hit.product.id, name: hit.product.name, category: hit.product.category, exact: true },
      exact: true,
      source: 'exact',
      rates,
      specLabels,
      candidates: [],
    };
  }

  // AI fallback for the miss (text only: name + spec + qty + dims).
  const ai = await resolveCatalogueItem(env, {
    name,
    spec: String(input?.spec ?? ''),
    dims: String(input?.dims ?? ''),
    qty: String(input?.qty ?? ''),
  }).catch((): { product: null; confidence: number; source: null } => ({ product: null, confidence: 0, source: null }));
  if (ai.product) {
    const { rates, specLabels } = await ratesFor(ai.product.id);
    return {
      product: { ...ai.product, exact: false },
      exact: false,
      source: 'llm',
      rates,
      specLabels,
      candidates: [],
    };
  }

  // Last resort: fuzzy candidates for the user to pick by hand.
  const candidates = rankProducts(products, name, 5).map((m) => ({
    id: m.product.id,
    name: m.product.name,
    category: m.product.category,
    score: m.score,
  }));
  return { product: null, exact: false, source: null, rates: [], specLabels: {}, candidates };
}
