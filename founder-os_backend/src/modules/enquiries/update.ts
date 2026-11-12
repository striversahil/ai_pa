// update.ts — enquiryUpdate lifecycles, extracted verbatim from routes.ts.
// One concern per helper; routes.ts orchestrates (flags → helpers → store).
// No behavior change: same branches, same order, same writes.


// Pieces split into ./update-parts/ (importable on their own); re-exported for compat.
export type { ItemWriteCtx, RateWriteCtx } from "./update-parts/types";
export { normalizeItemWrites, applyIntakeBulkResult, applyLateQuoteReopen, applySentRevision, applyRateLifecycles, assertFinalizeGate, retitleOnSourceChange } from "./update-parts/pure";


