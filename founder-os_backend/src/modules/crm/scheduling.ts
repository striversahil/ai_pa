// ── CRM order workflow: pure state machine + validators ────────────────────
//
// NO I/O, NO framework imports — safe in the Worker bundle, and mirrored
// verbatim in semantics by the frontend copy at
// `founder-os_frontend/src/crm/lifecycle.ts`.
// `scripts/guards/crm-lifecycle.test.mjs` runs both against the same fixtures.
//
// The floor works like this:
//   new SO                      → unscheduled          (red)
//   some items dated            → partially_scheduled  (amber)
//   every item dated            → scheduled            (blue)
//   some items dispatched       → partially_dispatched (violet)
//   every item dispatched       → dispatched           (green)
//   Zoho status cancelled/void  → cancelled            (out of queues, kept)
//
// A scheduled item whose date has passed and is still not dispatched is
// OVERDUE — the UI forces the reschedule dialog (mandatory reason) before the
// floor can move on.


// Pieces split into ./scheduling-parts/ (importable on their own); re-exported for compat.
export type { ItemLike, OrderLike, ValidationOk, ValidationFail, Validation, ScheduleEntry, ScheduleArgs, RescheduleEntry, RescheduleArgs, DispatchEntry, DispatchProof, DispatchArgs, AmendQtyChange, AmendRemove, AmendAdd, AmendArgs, LocalCancelArgs } from "./scheduling-parts/types";
export { effectiveQty, isRemovedItem, isCancelledOrder, deriveLifecycle, isOverdueItem, isDueTodayItem, isOrderOverdue, countDueToday, validateReason, validateSchedule, validateReschedule, validateDispatch, resolveDispatchQty, validateAmend, validateLocalCancel } from "./scheduling-parts/pure";


