/**
 * vision-intake.ts — Worker-native vision intake (no GH Actions).
 *
 * Awaited inline by the write routes (no waitUntil, no sweeper), paid DeepSeek lane primary
 * (deepseek-v4.1-flash for text; the lane's vision model for photo passes),
 * Agnes → OpenRouter free as fallbacks.
 *   Call 1 SEGMENT (vision+text, NO catalogue): splits unstructured text +
 *   enquiry/item images into verbatim line items. The model never sees KYP
 *   so it cannot hallucinate catalogue names or drop lines to fit them.
 *   Imageless enquiries already ride text-only here (buildVisionUserContent
 *   returns plain text with no image parts — same model, zero image tokens).
 *   Call 2 LOOKUP (text-only, per line): deterministic alias-index match
 *   first (exact → key → substring over verbatim+spec+name+dims+qty), the
 *   shared token-overlap tier from match.ts second (one implementation for
 *   intake + sales chat), one batched LLM fallback for the misses only
 *   (<0.65 confidence stays Uncategorized; alias/near-name answers are
 *   resolved back instead of discarded). All tiers read the LIVE ProductItem
 *   table (KV-cached slim index) — catalogue edits apply to the next intake
 *   with no codegen step. Lookup fills the category side-field only —
 *   verbatim wording is untouched.
 *
 * This path is fast (<4s typical, edge), handles the same `aiBulkText` vs
 * description branching as the legacy GH runner, and applies fill-empty-only
 * semantics via the shared `applyIntakeBulkResult` helper.
 *
 * RETIRED: Pinecone price-memory (embeddings + per-category namespaces) was
 * removed — pricing now comes exclusively from live product-line VendorRates
 * via the sales chat matcher (match.ts). The intake KV payload keeps
 * `suggestions: []` / `candidates: []` so the sales UI contract is unchanged.
 */


// Pieces split into ./vision-intake-parts/ (importable on their own); re-exported for compat.
export { runAgnesVisionIntake } from "./vision-intake-parts/io";


