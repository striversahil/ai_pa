// loops.ts — deterministic enquiry loop engine (single source of truth).
//
// Every back-and-forth on an item (spec flags, sales queries, rate requests,
// not-available asks, notes) is an explicit LoopRecord with a holder (who must
// act) and a status. Queues read ONLY holder + status — no last-entry
// inference, so a message for one desk can never surface in another's queue.
//
// Clients send verbs (loopOpen/loopAnswer/loopForward/loopWithdraw/loopReject),
// validated in pickEnquiryFields and applied here. Legacy text fields from
// older clients are bridged to the same verbs, so a stale tab can never
// strand or misroute a loop. Stored legacy rows migrate on read
// (migrateItemLoops — pure, idempotent).


// Pieces split into ./loops-parts/ (importable on their own); re-exported for compat.
export { LOOP_KINDS, LOOP_PARTIES, parseLoopRecords, openLoops, migrateItemLoops, answerAllOpen, answerOpen, applyLoopOps, auditNote } from "./loops-parts/pure";
export type { LoopWriter } from "./loops-parts/types";


