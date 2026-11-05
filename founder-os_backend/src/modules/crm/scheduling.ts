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
import {
  CANCELLED_STATUSES,
  REASON_MIN,
  isDayString,
  type ItemState,
  type Lifecycle,
} from './types';

/** The minimum an item must expose for lifecycle/overdue logic. */
export interface ItemLike {
  id: string;
  dispatchState: ItemState;
  tentativeDispatchDate?: string | null;
  delayReason?: string | null;
  qty?: number;
  dispatchedQty?: number;
}

/** Order-level inputs that can override the derived lifecycle. */
export interface OrderLike {
  status?: string | null;
  orderStatus?: string | null;
}

/** Zoho says this order was cancelled/voided → it leaves the working queues. */
export function isCancelledOrder(order?: OrderLike | null): boolean {
  const status = String(order?.status ?? '').toLowerCase();
  return CANCELLED_STATUSES.has(status);
}

/**
 * Derive the local lifecycle from item state. `cancelled` wins over everything
 * (kept for audit — never silently dropped).
 */
export function deriveLifecycle(items: readonly ItemLike[], order?: OrderLike | null): Lifecycle {
  if (isCancelledOrder(order)) return 'cancelled';
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return 'unscheduled';

  let dispatched = 0;
  let scheduled = 0;
  for (const it of list) {
    if (it?.dispatchState === 'dispatched') dispatched++;
    else if (it?.dispatchState === 'scheduled' && isDayString(it?.tentativeDispatchDate)) scheduled++;
  }
  const total = list.length;
  if (dispatched === total) return 'dispatched';
  if (dispatched > 0) return 'partially_dispatched';
  if (scheduled === total) return 'scheduled';
  if (scheduled > 0) return 'partially_scheduled';
  return 'unscheduled';
}

/** A scheduled item whose committed date is before today and not dispatched. */
export function isOverdueItem(item: ItemLike, today: string): boolean {
  if (!item || item.dispatchState !== 'scheduled') return false;
  if (!isDayString(item.tentativeDispatchDate)) return false;
  return item.tentativeDispatchDate < today;
}

/** Scheduled exactly for today. */
export function isDueTodayItem(item: ItemLike, today: string): boolean {
  if (!item || item.dispatchState !== 'scheduled') return false;
  return item.tentativeDispatchDate === today;
}

/** Any scheduled-but-missed item on the order. */
export function isOrderOverdue(items: readonly ItemLike[], today: string): boolean {
  return (items || []).some((it) => isOverdueItem(it, today));
}

/** Scheduled items dated today — the Dispatch Floor counter. */
export function countDueToday(items: readonly ItemLike[], today: string): number {
  return (items || []).filter((it) => isDueTodayItem(it, today)).length;
}

// ── Validation ──────────────────────────────────────────────────────────────

export type ValidationOk = { ok: true };
export type ValidationFail = { ok: false; code: string; message: string; itemId?: string };
export type Validation = ValidationOk | ValidationFail;

const ok: ValidationOk = { ok: true };

function fail(code: string, message: string, itemId?: string): ValidationFail {
  return itemId ? { ok: false, code, message, itemId } : { ok: false, code, message };
}

/** Non-blank string (proof IDs, dates) — trims so whitespace can't pass. */
function str3(v: unknown): string {
  return String(v ?? '').trim();
}

/** Reasons must clear REASON_MIN so "na" can't become a delay reason. */
export function validateReason(reason: unknown, label = 'Reason'): Validation {
  const text = String(reason ?? '').trim();
  if (text.length < REASON_MIN) {
    return fail('reason_required', `${label} is mandatory — at least ${REASON_MIN} characters.`);
  }
  return ok;
}

export interface ScheduleEntry {
  itemId: string;
  /** YYYY-MM-DD tentative dispatch date; omit/null when the item can't go today. */
  date?: string | null;
  /** Item-level delay reason (required for every undated item). */
  reason?: string | null;
}

export interface ScheduleArgs {
  /** IST today (YYYY-MM-DD). */
  today: string;
  /** Every item currently on the order. */
  items: readonly ItemLike[];
  /** Items the dispatch executive touched in this call. */
  entries: readonly ScheduleEntry[];
  /** Whole-order delay reason — only valid when NOTHING is scheduled. */
  soReason?: string | null;
}

/**
 * Validate a scheduling call.
 *
 * - every date must be a real day and today or later
 * - dispatched items cannot be re-scheduled
 * - all items dated      → `scheduled`
 * - some items dated     → each remaining item needs its own reason (`partially_scheduled`)
 * - nothing dated        → the SO-level reason is mandatory (`unscheduled`)
 */
export function validateSchedule(args: ScheduleArgs): Validation {
  const { today } = args;
  const items = args.items || [];
  const entries = (args.entries || []).filter((e) => e && e.itemId);
  if (entries.length === 0) {
    return fail('no_items', 'Select at least one item to schedule, or record an order-level delay reason.');
  }
  const byId = new Map(items.map((it) => [it.id, it]));
  const dated: string[] = [];
  for (const e of entries) {
    const item = byId.get(e.itemId);
    if (!item) return fail('unknown_item', 'That item is not on this sales order.', e.itemId);
    if (item.dispatchState === 'dispatched') {
      return fail('already_dispatched', 'Item is already dispatched — it cannot be scheduled again.', e.itemId);
    }
    if (e.date === undefined || e.date === null || e.date === '') continue;
    if (!isDayString(e.date)) {
      return fail('bad_date', 'Pick a valid dispatch date (YYYY-MM-DD).', e.itemId);
    }
    if (e.date < today) {
      return fail('past_date', 'Dispatch date cannot be in the past.', e.itemId);
    }
    dated.push(e.itemId);
  }

  if (dated.length === 0) {
    // Whole order stays unscheduled — the reason is the entire audit trail.
    return validateReason(args.soReason, 'Order delay reason');
  }

  // Partial scheduling: every entry left undated needs its own reason.
  for (const e of entries) {
    if (dated.includes(e.itemId)) continue;
    const item = byId.get(e.itemId);
    if (item?.dispatchState === 'dispatched') continue;
    if (!String(e.reason ?? '').trim() && !String(args.soReason ?? '').trim()) {
      return fail('reason_required', 'Every item you cannot schedule needs a delay reason.', e.itemId);
    }
  }
  return ok;
}

export interface RescheduleEntry {
  itemId: string;
  /** New committed date (YYYY-MM-DD). */
  date?: string | null;
}

export interface RescheduleArgs {
  today: string;
  items: readonly ItemLike[];
  entries: readonly RescheduleEntry[];
  /** Comprehensive reason for the slip — always mandatory. */
  reason?: string | null;
}

/**
 * Validate a reschedule: only items that are currently `scheduled` (committed
 * but not yet dispatched) can move, each to a valid future/today date, and the
 * whole call requires a comprehensive reason.
 */
export function validateReschedule(args: RescheduleArgs): Validation {
  const reasonCheck = validateReason(args.reason, 'Reschedule reason');
  if (!reasonCheck.ok) return reasonCheck;
  const entries = (args.entries || []).filter((e) => e && e.itemId);
  if (entries.length === 0) return fail('no_items', 'Select at least one scheduled item to reschedule.');
  const byId = new Map((args.items || []).map((it) => [it.id, it]));
  for (const e of entries) {
    const item = byId.get(e.itemId);
    if (!item) return fail('unknown_item', 'That item is not on this sales order.', e.itemId);
    if (item.dispatchState !== 'scheduled') {
      return fail('not_scheduled', 'Only scheduled, undispatched items can be rescheduled.', e.itemId);
    }
    if (!isDayString(e.date)) {
      return fail('bad_date', 'Pick the new dispatch date (YYYY-MM-DD).', e.itemId);
    }
    if (e.date < args.today) {
      return fail('past_date', 'The new dispatch date cannot be in the past.', e.itemId);
    }
  }
  return ok;
}

export interface DispatchEntry {
  itemId: string;
  /** Quantity going out now; defaults to the full remaining quantity. */
  qty?: number | null;
}

/**
 * Fresh proof for one dispatch action (decided 2026-11-04): every Mark
 * dispatched — full or partial — consumes a fresh INVOICE PDF. Before/after
 * packing photos and the transport receipt / courier receipt / packing list are
 * optional and ride along when the floor has them. IDs reference SoAttachment
 * rows; the store verifies ownership/kind/mime/freshness (shape-only here).
 */
export interface DispatchProof {
  invoiceId?: string | null;
  beforeId?: string | null;
  afterId?: string | null;
  transportId?: string | null;
  courierId?: string | null;
  packingListId?: string | null;
}

export interface DispatchArgs {
  items: readonly ItemLike[];
  entries: readonly DispatchEntry[];
  /** Required: no proof, no dispatch (even partial). */
  proof?: DispatchProof | null;
}

/**
 * Validate a dispatch: only scheduled items can go out, quantity must be
 * positive and no more than what remains. Early dispatch (before the committed
 * date) is allowed and recorded with the actual date.
 *
 * PROOF GATE (2026-11-04): every dispatch needs a fresh invoice PDF;
 * before/after packing photos are optional extras. Shape-only here (invoice
 * ID present); the store verifies the files exist, belong to this SO, have
 * the right kind/mime and were never used before.
 */
export function validateDispatch(args: DispatchArgs): Validation {
  const entries = (args.entries || []).filter((e) => e && e.itemId);
  if (entries.length === 0) return fail('no_items', 'Select at least one item to dispatch.');
  const p = args.proof || null;
  if (!p || !str3(p.invoiceId)) {
    return fail(
      'proof_required',
      'Add the invoice PDF before dispatching. Packing photos can be added if available.',
    );
  }
  const byId = new Map((args.items || []).map((it) => [it.id, it]));
  for (const e of entries) {
    const item = byId.get(e.itemId);
    if (!item) return fail('unknown_item', 'That item is not on this sales order.', e.itemId);
    if (item.dispatchState === 'dispatched') {
      return fail('already_dispatched', 'Item is already fully dispatched.', e.itemId);
    }
    if (item.dispatchState !== 'scheduled') {
      return fail('not_scheduled', 'Schedule the item before dispatching it.', e.itemId);
    }
    const qty = Number(item.qty ?? 0);
    const done = Number(item.dispatchedQty ?? 0);
    const remaining = Math.max(0, qty - done);
    if (e.qty === undefined || e.qty === null) continue;
    const want = Number(e.qty);
    if (!Number.isFinite(want) || want <= 0) {
      return fail('bad_qty', 'Dispatch quantity must be greater than zero.', e.itemId);
    }
    if (remaining > 0 && want > remaining + 1e-6) {
      return fail('bad_qty', `Only ${remaining} left on this item.`, e.itemId);
    }
  }
  return ok;
}

/** Effective dispatch quantity for an entry (defaults to full remaining). */
export function resolveDispatchQty(item: ItemLike | undefined, entry: DispatchEntry | undefined): number {
  if (!item) return 0;
  const remaining = Math.max(0, Number(item.qty ?? 0) - Number(item.dispatchedQty ?? 0));
  const wanted = entry?.qty;
  if (wanted === undefined || wanted === null) return remaining;
  const n = Number(wanted);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, remaining);
}
