// ── CRM order workflow: persistence (D1 through the prisma shim) ───────────
//
// Exactly two jobs live here:
//   1. map rows ↔ API shapes
//   2. perform write lifecycles (schedule / reschedule / dispatch / confirm
//      removal / sync) with validation, audit rows and score credits
//
// No HTTP, no authz — those are the route module's problem (routes.ts).
// Pure rules live in scheduling.ts; queue predicates in queues.ts.


// Pieces split into ./store-parts/ (importable on their own); re-exported for compat.
export { toItemView, toOrderView, CrmError, PROOF_DOC_RULES, isChargeLine } from "./store-parts/pure";
export type { ListArgs, ProofFile, ActionResult, ProofDocSlot, SyncedOrder, SyncVerify, SyncResult } from "./store-parts/types";
export { listOrders, sortNewestFirst, orderRegion, getOrder, syncState, scheduleOrder, rescheduleOrder, dispatchOrder, attachProofDocs, attachProofPhotos, hasDispatchCredit, confirmSourceDeletion, updateAddresses, amendOrderItems, cancelOrderLocal, reopenOrderLocal, syncOrders, dispatchSummary } from "./store-parts/io";


