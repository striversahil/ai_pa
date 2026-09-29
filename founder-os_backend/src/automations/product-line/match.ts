// match.ts — sales-side price matching over the LIVE product-line tables.
//
// Pure + framework-free (no prisma, no KV, no fetch): callers load rows via
// the per-product service accessors (getProductIndex / getProductDetail /
// getRatesForProduct) and pass them in, so both the Worker and Express can
// import this. Mirror note: rounding (ceil5/finalRound) mirrors
// frontend/src/enquiry/pricing.ts — change both together, never drift.
//
// Reads live D1 tables ONLY (ProductItem / KypGuide / VendorRate) — never
// any static KYP sheet. Vendor identity is stripped in salesSafeQuote():
// the LLM only ever receives the stripped view, so it cannot leak vendors.

export interface MatchProduct {
  id: string;
  category: string;
  name: string;
  aliases: string[];
  active: boolean;
}

export interface MatchGuideRow {
  attrKey: string;
  question: string;
  guideNote: string | null;
  sortOrder: number;
  isRequired: boolean;
  active: boolean;
}

export interface MatchRate {
  id: string;
  productId: string | null;
  attrValues: Record<string, string>;
  pricePerUnit: number | null;
  unit: string;
  discountPercent: number | null;
  moq: string | null;
  deliveryDays: number | null;
  quotedAt: string;
  active: boolean;
}

/** Vendor-blind quote shown to sales + the LLM. NO vendor fields by design. */
export interface SalesQuote {
  productId: string;
  productName: string;
  unit: string;
  /** Effective vendor price (discount applied) — internal, for reference. */
  effectivePrice: number;
  /** Customer-facing price: +25% markup, finalRound applied. */
  markedPrice: number;
  confidence: number;
  moq: string | null;
  deliveryDays: number | null;
  quotedAt: string;
  quoteAgeDays: number | null;
  matchedSpecs: { key: string; question: string; value: string }[];
  missingSpecs: { key: string; question: string }[];
}

/** Flat sales markup over effective vendor rates (founder decision). */
export const SALES_MARKUP_PERCENT = 25;

/** Below this confidence the chat routes the item to procurement instead. */
export const MIN_QUOTE_CONFIDENCE = 0.6;

function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Token-overlap scorer (deterministic fuzzy tier) ─────────────────────
// Catches what substring matching cannot: word reordering ("belt black
// rubber"), noisy concatenations ("6\" 4ply 100mtr nylon belt"), unit/dim
// clutter, plurals. Deliberately NOT edit-distance: typos ("Nytal") still
// need the LLM fallback — this tier stays free, instant, and explainable.

/** Units/dims/filler stripped before scoring (never product identity). */
const TOKEN_STOP = new Set([
  'mm', 'cm', 'm', 'mtr', 'mtrs', 'meter', 'meters', 'metre', 'inch', 'inches',
  'ft', 'feet', 'pcs', 'pc', 'nos', 'qty', 'quantity', 'kg', 'gms', 'gm',
  'x', 'size', 'rate', 'required', 'new', 'length', 'width', 'thick', 'thickness',
  'the', 'a', 'an', 'of', 'for', 'with', 'and', 'per', 'uncategorized', 'unknown',
]);

/** Significant tokens: lowercase alnum; pure numbers and NxM dims dropped
 *  (quantities aren't identity), alphanumeric mixes kept (a70, 4ply, 58gg). */
export function matchTokens(s: unknown): string[] {
  const raw = String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
  const out: string[] = [];
  for (let t of raw) {
    if (/^\d+$/.test(t)) continue; // pure quantity
    if (/^\d+\s*[x×]\s*\d+$/.test(t)) continue; // dimension pair
    if (TOKEN_STOP.has(t)) continue;
    // plural normalize: buckets→bucket (skip ss-endings: glass, press)
    if (t.length > 4 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
    if (t) out.push(t);
  }
  return [...new Set(out)];
}

/**
 * Containment score 0–1: shared tokens ÷ smaller side. Containment (not
 * Jaccard) because enquiry lines are noisy supersets ("…70 nos") of short
 * catalogue names. Returns 0 when either side is token-empty.
 */
export function tokenOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let shared = 0;
  for (const t of a) if (setB.has(t)) shared++;
  return shared / Math.min(a.length, b.length);
}

/** Min shared tokens + min containment for a credible token-tier hit. */
export const TOKEN_MIN_SHARED = 2;
export const TOKEN_MIN_SCORE = 0.5;

/** Round UP to the next multiple of 5 (mirrors frontend pricing.ts). */
export function ceil5(x: number): number {
  return Math.ceil((x - 1e-6) / 5) * 5;
}

/** Under 100 → rupee-round; >= 100 → ceil5 (mirrors frontend pricing.ts). */
export function finalRound(x: number): number {
  return x < 100 ? Math.round(x) : ceil5(x);
}

/** Vendor effective price: price → vendor discount (mirrors copilot.ts). */
export function effectivePrice(pricePerUnit: number | null, discountPercent: number | null): number | null {
  if (pricePerUnit == null || !Number.isFinite(pricePerUnit) || pricePerUnit <= 0) return null;
  const d = discountPercent != null && Number.isFinite(discountPercent) ? discountPercent : 0;
  return pricePerUnit * (1 - d / 100);
}

/** Customer price: effective → +25% → finalRound. */
export function applyMarkup(eff: number): number {
  return finalRound(eff * (1 + SALES_MARKUP_PERCENT / 100));
}

/**
 * Resolve an intake-written kypItem (+ category hint) to a live catalogue
 * product. Tiers: exact name/alias (id, name, alias equality) → substring
 * either-way → token-overlap (reorder/noise tolerant). Partial/token tiers
 * need category agreement (skipped when the item is Uncategorized).
 * Returns null when nothing credible matches — callers fall through to the
 * LLM/candidate fallback, never guess.
 */
export function resolveProduct(
  products: MatchProduct[],
  kypItem: string,
  category: string,
): { product: MatchProduct; exact: boolean } | null {
  const needle = norm(kypItem);
  if (!needle) return null;
  const cat = norm(category);
  const gated = (p: MatchProduct): boolean => {
    // Partial/token tiers only count with category agreement (avoids
    // cross-category junk). Uncategorized items skip the gate.
    if (!cat || cat === 'uncategorized') return true;
    return norm(p.category) === cat;
  };
  for (const p of products ?? []) {
    if (!p || p.active === false) continue;
    if (String((p as any).id ?? '') === kypItem.trim()) return { product: p, exact: true };
    const name = norm(p.name);
    const aliases = (Array.isArray(p.aliases) ? p.aliases : []).map(norm);
    if (name === needle || aliases.includes(needle)) return { product: p, exact: true };
  }
  const needleToks = matchTokens(needle);
  let best: MatchProduct | null = null;
  let bestScore = 0;
  for (const p of products ?? []) {
    if (!p || p.active === false) continue;
    const name = norm(p.name);
    const aliases = (Array.isArray(p.aliases) ? p.aliases : []).map(norm);
    const subHit =
      (name && (name.includes(needle) || needle.includes(name))) ||
      aliases.some((a) => a && (a.includes(needle) || needle.includes(a)));
    let score = subHit ? 1 : 0;
    if (!subHit && needleToks.length > 0) {
      const hayToks = matchTokens([name, ...aliases].join(' '));
      const shared = needleToks.filter((t) => hayToks.includes(t)).length;
      const ov = tokenOverlap(needleToks, hayToks);
      if (shared >= TOKEN_MIN_SHARED && ov >= TOKEN_MIN_SCORE) score = ov;
    }
    if (score <= 0 || score <= bestScore) continue;
    if (!gated(p)) continue;
    best = p;
    bestScore = score;
  }
  return best ? { product: best, exact: false } : null;
}

/**
 * Ranked candidate list for model/user pick (intake + sales fallback):
 * exact tier first, then token/substring score desc. Never the full
 * catalogue — top-N only, safe at 20K rows. Thresholds are tunable per
 * caller: strict (auto-resolve quality) vs loose (pick-list suggestions
 * the user confirms — safe because quoting still needs pick + specs +
 * the confidence gate).
 */
export function rankProducts(
  products: MatchProduct[],
  q: string,
  limit = 5,
  minShared = TOKEN_MIN_SHARED,
  minScore = TOKEN_MIN_SCORE,
): { product: MatchProduct; exact: boolean; score: number }[] {
  const needle = norm(q);
  if (!needle) return [];
  const needleToks = matchTokens(needle);
  const out: { product: MatchProduct; exact: boolean; score: number }[] = [];
  for (const p of products ?? []) {
    if (!p || p.active === false) continue;
    const name = norm(p.name);
    const aliases = (Array.isArray(p.aliases) ? p.aliases : []).map(norm);
    if (String((p as any).id ?? '') === q.trim() || name === needle || aliases.includes(needle)) {
      out.push({ product: p, exact: true, score: 2 });
      continue;
    }
    const subHit =
      (name && (name.includes(needle) || needle.includes(name))) ||
      aliases.some((a) => a && (a.includes(needle) || needle.includes(a)));
    let score = subHit ? 1 : 0;
    if (!subHit && needleToks.length > 0) {
      const hayToks = matchTokens([name, ...aliases].join(' '));
      const shared = needleToks.filter((t) => hayToks.includes(t)).length;
      const ov = tokenOverlap(needleToks, hayToks);
      if (shared >= minShared && ov >= minScore) score = ov;
    }
    if (score > 0) out.push({ product: p, exact: false, score });
  }
  out.sort((a, b) => (Number(b.exact) - Number(a.exact)) || (b.score - a.score));
  return out.slice(0, Math.max(1, Math.min(10, limit)));
}

/** Active required checklist for one product, sortOrder ascending. */
export function requiredChecklist(guide: MatchGuideRow[] | undefined): MatchGuideRow[] {
  return ((guide ?? []) as MatchGuideRow[])
    .filter((g) => g && g.active && g.isRequired)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function ageDays(quotedAt: string): number | null {
  const t = new Date(String(quotedAt ?? '')).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, (Date.now() - t) / 86_400_000);
}

/** Per-spec credit: exact-after-normalize = 1, either-contains = 0.5, else 0. */
function specCredit(want: string, got: string): number {
  const w = norm(want);
  const g = norm(got);
  if (!w || !g) return 0;
  if (w === g) return 1;
  if (w.includes(g) || g.includes(w)) return 0.5;
  return 0;
}

export interface ScoredRate {
  rate: MatchRate;
  confidence: number;
  overlap: number;
  recency: number;
}

/**
 * Score active priced rates for a product against collected specs.
 * confidence = 0.7 × required-spec overlap + 0.2 × recency + 0.1 × exact-hit
 * ratio. Sorted best-first.
 */
export function scoreRates(
  rates: MatchRate[],
  productId: string,
  specs: Record<string, string>,
  required: MatchGuideRow[],
): ScoredRate[] {
  const want: Record<string, string> = {};
  for (const [k, v] of Object.entries(specs ?? {})) {
    const s = String(v ?? '').trim();
    if (s) want[String(k)] = s;
  }
  const out: ScoredRate[] = [];
  for (const r of rates ?? []) {
    if (!r || r.active === false) continue;
    if (r.productId !== productId) continue;
    const eff = effectivePrice(r.pricePerUnit, r.discountPercent);
    if (eff == null) continue;
    const vals = r.attrValues ?? {};
    let got = 0;
    let exact = 0;
    let counted = 0;
    for (const g of required) {
      const rv = String(vals[g.attrKey] ?? '').trim();
      if (!rv) continue; // rate doesn't quote this spec — not penalized
      const wv = want[g.attrKey];
      if (!wv) continue; // we don't know this spec yet — not penalized
      counted++;
      const c = specCredit(wv, rv);
      got += c;
      if (c === 1) exact++;
    }
    const overlap = counted > 0 ? got / counted : 0.5; // no comparable specs → neutral
    const age = ageDays(r.quotedAt);
    const recency = age == null ? 0.5 : 1 / (1 + age / 180);
    const exactRatio = counted > 0 ? exact / counted : 0;
    const confidence = Math.round((0.7 * overlap + 0.2 * recency + 0.1 * exactRatio) * 100) / 100;
    out.push({ rate: r, confidence, overlap, recency });
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}

/**
 * Build the vendor-blind sales view of the best-scoring rate. Vendor
 * identity (id/name/type/contact/location) is dropped here — callers must
 * never pass the raw RateRow to the LLM.
 */
export function salesSafeQuote(
  product: MatchProduct,
  scored: ScoredRate,
  specs: Record<string, string>,
  required: MatchGuideRow[],
): SalesQuote {
  const r = scored.rate;
  const eff = effectivePrice(r.pricePerUnit, r.discountPercent) ?? 0;
  const labels = new Map<string, string>();
  for (const g of required) labels.set(g.attrKey, g.question);
  const matchedSpecs: SalesQuote['matchedSpecs'] = [];
  const missingSpecs: SalesQuote['missingSpecs'] = [];
  for (const g of required) {
    const v = String(specs?.[g.attrKey] ?? '').trim();
    if (v) matchedSpecs.push({ key: g.attrKey, question: g.question, value: v.slice(0, 200) });
    else missingSpecs.push({ key: g.attrKey, question: g.question });
  }
  return {
    productId: product.id,
    productName: product.name,
    unit: String(r.unit ?? ''),
    effectivePrice: Math.round(eff * 100) / 100,
    markedPrice: applyMarkup(eff),
    confidence: scored.confidence,
    moq: r.moq,
    deliveryDays: r.deliveryDays,
    quotedAt: String(r.quotedAt ?? ''),
    quoteAgeDays: ageDays(r.quotedAt) != null ? Math.round(ageDays(r.quotedAt) as number) : null,
    matchedSpecs,
    missingSpecs,
  };
}
