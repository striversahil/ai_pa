// client-segments.ts — final-consumer vs reseller classification.
//
// Founder decision (2026-11-02): each sales region owes ₹1L/day of ACCEPTED
// value from END CONSUMERS only. The customer master types every mill
// (Flour Mill / Chakki Mill / Maida Plant) but never flags resellers, and an
// Estimate carries only a free-text customerName — no customer id — so the
// join below is name-keyed and deterministic:
//
//   ClientTypeRule  one row per master customerTypeBase: which segment that
//                   whole family belongs to (sales-head editable; the three
//                   mill families seed as consumer).
//   ClientSegment   MANUAL overrides only, keyed by normalised client name.
//                   Auto matches are computed on read and never stored; a
//                   manual row always wins.
//
// Resolution order per client: manual override → auto master match (exact,
// then unique token-overlap ≥ 0.6) mapped through the type rules → unset.
// Ambiguous (2+ equal-best masters) and unmatched clients surface in the
// Controller queue with up to 5 candidates instead of being guessed.


// Pieces split into ./client-segments-parts/ (importable on their own); re-exported for compat.
export type { ClientSegmentKind, ClientCandidate, ClientClass, ClientQueueRow } from "./client-segments-parts/types";
export { normalizeClientKey } from "./client-segments-parts/pure";
export { classifyClients, loadClientQueue, setTypeRule, setManualSegment } from "./client-segments-parts/io";


