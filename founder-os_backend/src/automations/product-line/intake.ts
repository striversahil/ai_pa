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
import { SPEC_SYNONYMS, SPEC_SYN_MAP } from "./intake-parts/pure";

// Pieces split into ./intake-parts/ (importable on their own); re-exported for compat.
export { resolveSpecKeys, captureSpecs, canonicalAttrKey } from "./intake-parts/pure";
export type { FiledRate } from "./intake-parts/types";
export { productLineIntakeDef } from "./intake-parts/io";

for (const g of SPEC_SYNONYMS) {
  const all = new Set(g);
  for (const w of g) SPEC_SYN_MAP.set(w, all);
}
