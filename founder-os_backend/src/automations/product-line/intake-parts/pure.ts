// Extracted verbatim from intake.ts by scripts/refactor/split-module.mjs.
// intake.ts re-exports everything public here, so existing imports keep working.
import { matchTokens, tokenOverlap, TOKEN_MIN_SHARED, TOKEN_MIN_SCORE, matchCatalogueProducts } from "../match";
import type { IntakeDraft } from "./types";

export function parseAttrValues(raw: unknown): Record<string, string> {
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

export function parseMissingList(raw: unknown): string[] {
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
export function rateCard(r: any): Record<string, unknown> {
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

export const SPEC_FILLER = new Set(['ask', 'the', 'a', 'an', 'of', 'or', 'if', 'in', 'on', 'to', 'for', 'with', 'is', 'are', 'it', 'and', 'too', 'unsure', 'offer', 'usually']);

/** Cross-vocabulary synonyms: vendor says "size", checklist says "diameter".
 *  Milling-spares trade words included (jali = mesh, MS/SS shorthands) —
 *  matching only, stored values stay verbatim. */
export const SPEC_SYNONYMS: string[][] = [
  ['size', 'diameter', 'dia', 'dimension', 'dimensions'],
  ['width', 'w'],
  ['thickness', 'gauge', 'thick', 'gz'],
  ['length', 'len'],
  ['quantity', 'qty', 'quantities'],
  ['material', 'mtrl'],
  ['make', 'brand', 'manufacturer', 'model'],
  ['color', 'colour'],
  ['finish', 'finishing', 'laminate'],
  ['hole', 'holes', 'perforation'],
  ['mesh', 'screen', 'sieve', 'jali', 'net'],
  ['ms', 'mild'],
  ['ss', 'stainless'],
  ['weight', 'wt'],
];

export const SPEC_SYN_MAP = new Map<string, Set<string>>();

export function specTokens(s: unknown): string[] {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !SPEC_FILLER.has(w));
}

/** A raw input token hits the guide token set directly or via synonyms. */
export function specTokenHits(input: string[], guide: Set<string>): number {
  let hits = 0;
  for (const t of input) {
    if (guide.has(t)) { hits++; continue; }
    const syns = SPEC_SYN_MAP.get(t);
    if (syns) {
      for (const s of syns) {
        if (s !== t && guide.has(s)) { hits++; break; }
      }
    }
  }
  return hits;
}

/**
 * Map vendor-worded spec keys to real KYP attrKeys. Exact attrKey (or its
 * case/punctuation fold) always wins; otherwise token-overlap against
 * attrKey + question, requiring a UNIQUE best (score ≥ 0.5, ties abstain —
 * never guess between twins). Anything unresolvable is returned, never
 * stored as a spec. Two input keys hitting one attrKey with different
 * values = conflict: exact-key input wins, else first wins, loser noted.
 */
export function resolveSpecKeys(
  raw: Record<string, string>,
  guide: { attrKey: string; question: string }[],
): { mapped: Record<string, string>; unmapped: { key: string; value: string }[]; conflicts: string[] } {
  const mapped: Record<string, string> = {};
  const unmapped: { key: string; value: string }[] = [];
  const conflicts: string[] = [];
  const wonBy: Record<string, string[]> = {};
  const keys = (guide ?? []).filter((g) => g && g.attrKey).map((g) => ({
    attrKey: String(g.attrKey),
    // Anchor = attrKey tokens: question text carries incidental words
    // ("size" inside a picture question, "material" inside a confirm-the-
    // material question) that cause confident-but-wrong mappings. A
    // candidate must share at least one token with the attrKey slug itself;
    // scoring then uses the full vocabulary for long vendor keys.
    anchor: new Set(specTokens(g.attrKey)),
    toks: new Set([...specTokens(g.attrKey), ...specTokens(g.question)]),
  }));
  for (const [k, v] of Object.entries(raw ?? {})) {
    const val = String(v ?? '').trim();
    if (!String(k ?? '').trim() || !val) continue;
    const key = String(k).trim().slice(0, 120);
    let hit: string | null = null;
    if (keys.some((g) => g.attrKey === key)) {
      hit = key;
    } else {
      const nk = String(k).toLowerCase().replace(/[^a-z0-9]+/g, '');
      const fold = keys.find((g) => g.attrKey.toLowerCase().replace(/[^a-z0-9]+/g, '') === nk);
      if (fold) {
        hit = fold.attrKey;
      } else {
        const it = specTokens(k);
        if (it.length > 0 && keys.length > 0) {
          let best = '';
          let bestScore = 0;
          let tied = false;
          for (const g of keys) {
            // Anchor first (see above), then hit-rate over the INPUT's
            // tokens (direct or synonym): the vendor's word must land.
            if (specTokenHits(it, g.anchor) === 0) continue;
            const score = specTokenHits(it, g.toks) / it.length;
            if (score > bestScore + 1e-9) { bestScore = score; best = g.attrKey; tied = false; }
            else if (score > 0 && Math.abs(score - bestScore) < 1e-9) { tied = true; }
          }
          if (bestScore >= 0.5 && !tied) hit = best;
        }
      }
    }
    if (!hit) {
      unmapped.push({ key, value: val.slice(0, 200) });
      continue;
    }
    if (mapped[hit] !== undefined && mapped[hit] !== val && !(wonBy[hit] ?? []).includes(key)) {
      // Several inputs, one attrKey: DISTINCT facets (diameter + length +
      // quantity answering one combined question) join with ' / '; genuine
      // same-facet clashes stay visible in one value + flagged, never
      // silently dropped to notes and never stored as twin keys.
      const parts = String(mapped[hit]).split(' / ').map((s) => s.trim()).filter(Boolean);
      if (!parts.includes(val)) parts.push(val);
      conflicts.push(`"${key}" (${val}) merged into "${hit}" with "${wonBy[hit].join('", "')}"`);
      mapped[hit] = parts.join(' / ').slice(0, 500);
      wonBy[hit] = [...(wonBy[hit] ?? []), key];
      continue;
    }
    if (mapped[hit] === undefined) {
      mapped[hit] = val;
      wonBy[hit] = [key];
    }
  }
  return { mapped, unmapped, conflicts };
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

/** What's still missing: identity + EVERY mandatory commercial + required spec keys. */
export function missing(d: IntakeDraft, required: { key: string; question: string }[]): string[] {
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

export function validDate(v: unknown): string | undefined {
  const s = String(v ?? '').trim().slice(0, 100);
  if (!s) return undefined;
  const t = new Date(s);
  return isNaN(t.getTime()) ? undefined : t.toISOString();
}

export function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

/** Vendor canonical form: case/punctuation/whitespace folded, legal-entity
 *  prefixes stripped — "M/S FILTECH TEXTILES" and "Filtech Textiles" are
 *  the same vendor. Conservative: never drops content words, so "Global
 *  Rubber" and "Global Textiles" stay distinct. */
export function vendorCanon(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(m\s*s|messrs|mr|smt|shri)\s+/, '');
}

/** Tolerant alias list parse (stored as JSON string or array). */
export function aliasList(raw: unknown): string[] {
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
export function matchVendors(vendors: any[], q: string): { row: any; exact: boolean; score: number; why: string }[] {
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

/** Scored catalogue match (intake flavor): exact name/alias first, then
 *  substring/token score desc — category counts in the substring tier,
 *  inactive rows included, no category gate. Thin wrapper over the shared
 *  matchCatalogueProducts (single source of truth); behavior preserved
 *  exactly. Token tier catches reordered/noisy lines ("belt black rubber",
 *  "6in 4ply 100m nylon belt"); typos still need the LLM pick. */
export function matchProducts(products: any[], q: string): { row: any; exact: boolean }[] {
  return matchCatalogueProducts(products, q, { substringCategory: true, onlyActive: false, limit: 5 });
}

/** Paging args shared by the flexible reads: how much data the model wants.
 *  No caps on principle — limit only bounds one page, offset pages through,
 *  and every read reports total + truncated so big lists page cleanly. */
export function pageArgs(args: Record<string, any>, defLimit: number): { limit: number; offset: number } {
  return {
    limit: Math.min(500, Math.max(1, Math.floor(Number(args?.limit) || defLimit))),
    offset: Math.max(0, Math.floor(Number(args?.offset) || 0)),
  };
}

export function includes(args: Record<string, any>): string[] {
  return Array.isArray(args?.include) ? (args.include as unknown[]).map((s) => String(s)) : [];
}
