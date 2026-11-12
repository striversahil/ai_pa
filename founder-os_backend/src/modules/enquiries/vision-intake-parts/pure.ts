// Extracted verbatim from vision-intake.ts by scripts/refactor/split-module.mjs.
// vision-intake.ts re-exports everything public here, so existing imports keep working.
import { rankProducts, TOKEN_MIN_SHARED, TOKEN_MIN_SCORE } from "../../../automations/product-line/match";
import type { MatchProduct } from "../../../automations/product-line/match";
import { gradeRulesPrompt, FAMILY_PROMPT } from "../intake-grade-rules";
import type { KypKey } from "./types";

export const ROUTER_SYSTEM = `You are a B2B industrial-spare intake for flour-mill machinery. From the sales text + attached photos, split the enquiry into purchasable line items.
For EACH item return: {"verbatim": "client wording for the product, copied exactly as written/seen — NEVER rename", "qty": "quantity with unit or empty", "dims": "dimensions as written", "spec": "material/variant/spec detail as written", "name": "short product name derived from verbatim"}.
Also extract the lead block: {"lead": {"clientCompany": "customer company, or empty", "contactName": "contact person, or empty", "contactEmail": "or empty", "contactPhone": "mobile/phone, or empty", "location": "city/state, or empty", "sourceLead": "lead source like IndiaMART/reference, or empty"}} — NEVER invent; empty when not stated. The sales agent's own name ("Lead of ...") is NOT the customer — ignore it.
Rules: one entry per distinct product; a line containing ONLY a quantity (e.g. "QTY - 1") is NOT its own product — attach it to the product line directly above it; spec sub-lines (e.g. "• Thickness: 6mm", "• Size: L-10\", W-6\"") belong to the product line directly ABOVE them — copy them into that item's dims/spec, never drop them; a quantity trailing at the end of a spec line (e.g. "...H-4.5\" 100 Pc", "...2.5 suta 500 Pc") is that item's qty; quantities and dimensions hide behind dashes and spaces — "130 mm x 1500 mm- 36 - pc" splits to dims "130 mm x 1500 mm" + qty "36 pc", "70/90 mm - 20 pair" to dims "70/90 mm" + qty "20 pair"; "=" also separates ("Airlock Glass 150 mm = Qty 10 Pcs" → dims "150 mm", qty "10 Pcs"; "Airlock = 150mm = 10 pc" → dims "150mm", qty "10 pc"); leading item numbers ("1.", "11.") are NEVER quantities; NEVER drop or merge product lines — every product mentioned in the text or seen in a photo gets its own entry; qty ALWAYS keeps its number when one is written ("30 pcs", never a bare "pcs"); never invent quantities, dimensions or contact details — if absent, leave empty; return STRICT JSON {"lines":[...],"lead":{...}} with no other text.`;

/** ── Call-2 lookup: line → live catalogue product (verbatim never touched). ──
 *  Reads the LIVE ProductItem table via the KV-cached slim index — the same
 *  rows the sales chat matches against. No static artifact: catalogue edits
 *  (products, aliases) apply to the next intake automatically.
 */
export const normTok = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

/**
 * Deterministic tiers 1–3 (exact item → exact key → substring). `extra`
 * carries the router's name/dims/qty fields — matchers used to see only
 * verbatim+spec, so any line whose product noun landed in name/dims was
 * unmatchable and fell to Uncategorized. Tier 4 (token-overlap) lives in
 * lookupToken below so call sites can count it separately.
 */
export function lookupDeterministic(verbatim: string, spec: string, extra: string, index: KypKey[]): KypKey | null {
  const q = normTok(`${verbatim} ${spec} ${extra}`);
  for (const t of index) {
    if (normTok(t.item) === normTok(verbatim)) return t;
  }
  for (const t of index) {
    for (const key of t.keys) {
      if (!key) continue;
      if (q === key || normTok(verbatim) === key) return t;
    }
  }
  let best: KypKey | null = null;
  let bestScore = 0;
  for (const t of index) {
    for (const key of t.keys) {
      if (!key || key.length < 4) continue;
      if (q.includes(key) && key.length > bestScore) {
        bestScore = key.length;
        best = t;
      }
    }
  }
  return best;
}

/**
 * Tier 4 — token-overlap via the shared sales matcher (match.ts), same
 * strict bar the sales chat auto-resolves on (≥2 shared tokens, ≥0.5
 * containment). Catches reordering/noise the substring tier cannot
 * ("Elevator Bucket Plastic 8/5 Jindal" vs "Elevator Bucket - AA Type").
 * Single best only — null when nothing credible matches.
 */
export function lookupToken(q: string, products: MatchProduct[], index: KypKey[]): KypKey | null {
  const top = rankProducts(products, q, 1, TOKEN_MIN_SHARED, TOKEN_MIN_SCORE)[0];
  if (!top) return null;
  return index.find((t) => t.productId === top.product.id) ?? null;
}

// Fallback list for the LLM, built from the live catalogue:
// `1. Category: Item[alias,alias]; Item; ...`.
export function buildLookupList(cats: string[], products: MatchProduct[]): string {
  return cats.map((c, i) => `${i + 1}. ${c}: ${products.filter((p) => p.category === c).map((p) => {
    const al = (p.aliases || []).filter(Boolean);
    return al.length ? `${p.name}[${al.join(',')}]` : p.name;
  }).join('; ')}`).join('\n');
}

export const LOOKUP_FALLBACK_SYSTEM = `You are a product matcher for flour-mill spare parts. For EACH input line, pick the single best catalogue entry.
Rules: "category" is the category NUMBER as a bare number; "item" is the item_name copied EXACTLY (never an alias, never invented); "confidence" is 0-1 — below 0.65 when the line genuinely matches nothing (custom/fabricated/as-per-drawing must be 0-0.3, never force a catalogue item); return STRICT JSON {"matches":[{"category":"...","item":"...","confidence":0.9}, ...]} with exactly one entry per input line, in order, and no other text.
${gradeRulesPrompt()}
${FAMILY_PROMPT}`;

export const SPEC_CHECK_SYSTEM = `You are a spec-completeness checker for flour-mill spare parts. For EACH item you receive its collected spec text and its checklist (required_attributes). Return which checklist entries are STILL MISSING.
Rules: an entry is satisfied if the spec text contains a concrete value for it — e.g. "A70" satisfies V-belt number, "Fenner"/"Gates"/any brand token satisfies brand preference, "6 GG" satisfies grade, "115 cm" satisfies width, "2 pcs"/"10 meters"/"3m" satisfies quantity. A brand token anywhere (verbatim, spec, qty) counts; "as per sample" alone does NOT satisfy; return STRICT JSON {"checks":[{"missing":[0,2]}, ...]} where missing lists the 0-based indices of STILL-MISSING entries, one entry per input item, in order. Never invent checklist text — only return indices.`;

/** Rate-limit detector (shared by the attempt loop + the terminal branch):
 *  the gateway reports a drained pool as "All AI keys exhausted after 5
 *  attempts" with no 429/status attached — without the `exhausted` arm that
 *  verdict misclassifies as terminal failure and clears the flags, killing
 *  the sweeper's automatic retry during a storm. */
export function isRateLimited(e: any): boolean {
  const msg = String(e?.message ?? e ?? '');
  return /429|rate-limit|1015|exhausted/i.test(msg) || (e as any)?.status === 429;
}
