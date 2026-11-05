// crm/lifecycle.ts — the dispatch floor's state machine, frontend copy.
//
// MIRROR of `founder-os_backend/src/modules/crm/scheduling.ts`. Same names,
// same semantics — change both together. `scripts/guards/crm-lifecycle.test.mjs`
// runs both over a shared fixture corpus and fails on any disagreement.
//
// Lifecycle:
//   unscheduled → partially_scheduled → scheduled → partially_dispatched → dispatched
//   cancelled  (Zoho said cancelled/void — out of the queues, kept for audit)
import type { ItemState, Lifecycle } from "./types";

export const REASON_MIN = 10;

export interface ItemLike {
  id: string;
  dispatchState: ItemState;
  tentativeDispatchDate?: string | null;
  delayReason?: string | null;
  qty?: number;
  dispatchedQty?: number;
}

export interface OrderLike {
  status?: string | null;
  orderStatus?: string | null;
}

const isDayString = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function isCancelledOrder(order?: OrderLike | null): boolean {
  const status = String(order?.status ?? "").toLowerCase();
  return status === "cancelled" || status === "void";
}

export function deriveLifecycle(items: readonly ItemLike[], order?: OrderLike | null): Lifecycle {
  if (isCancelledOrder(order)) return "cancelled";
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return "unscheduled";

  let dispatched = 0;
  let scheduled = 0;
  for (const it of list) {
    if (it?.dispatchState === "dispatched") dispatched++;
    else if (it?.dispatchState === "scheduled" && isDayString(it?.tentativeDispatchDate)) scheduled++;
  }
  const total = list.length;
  if (dispatched === total) return "dispatched";
  if (dispatched > 0) return "partially_dispatched";
  if (scheduled === total) return "scheduled";
  if (scheduled > 0) return "partially_scheduled";
  return "unscheduled";
}

export function isOverdueItem(item: ItemLike, today: string): boolean {
  if (!item || item.dispatchState !== "scheduled") return false;
  if (!isDayString(item.tentativeDispatchDate)) return false;
  return item.tentativeDispatchDate < today;
}

export function isDueTodayItem(item: ItemLike, today: string): boolean {
  if (!item || item.dispatchState !== "scheduled") return false;
  return item.tentativeDispatchDate === today;
}

export function isOrderOverdue(items: readonly ItemLike[], today: string): boolean {
  return (items || []).some((it) => isOverdueItem(it, today));
}

export function countDueToday(items: readonly ItemLike[], today: string): number {
  return (items || []).filter((it) => isDueTodayItem(it, today)).length;
}

// ── Validation (same rules the server enforces — the UI shows them early) ───

export type Validation =
  | { ok: true }
  | { ok: false; code: string; message: string; itemId?: string };

const ok: Validation = { ok: true };

function fail(code: string, message: string, itemId?: string): Validation {
  return itemId ? { ok: false, code, message, itemId } : { ok: false, code, message };
}

export function validateReason(reason: unknown, label = "Reason"): Validation {
  const text = String(reason ?? "").trim();
  if (text.length < REASON_MIN) {
    return fail("reason_required", `${label} is mandatory — at least ${REASON_MIN} characters.`);
  }
  return ok;
}

export interface ScheduleEntry {
  itemId: string;
  date?: string | null;
  reason?: string | null;
}

export function validateSchedule(args: {
  today: string;
  items: readonly ItemLike[];
  entries: readonly ScheduleEntry[];
  soReason?: string | null;
}): Validation {
  const { today } = args;
  const entries = (args.entries || []).filter((e) => e && e.itemId);
  if (entries.length === 0) {
    return fail("no_items", "Select at least one item to schedule, or record an order-level delay reason.");
  }
  const byId = new Map((args.items || []).map((it) => [it.id, it]));
  const dated: string[] = [];
  for (const e of entries) {
    const item = byId.get(e.itemId);
    if (!item) return fail("unknown_item", "That item is not on this sales order.", e.itemId);
    if (item.dispatchState === "dispatched") {
      return fail("already_dispatched", "Item is already dispatched — it cannot be scheduled again.", e.itemId);
    }
    if (e.date === undefined || e.date === null || e.date === "") continue;
    if (!isDayString(e.date)) return fail("bad_date", "Pick a valid dispatch date (YYYY-MM-DD).", e.itemId);
    if (e.date < today) return fail("past_date", "Dispatch date cannot be in the past.", e.itemId);
    dated.push(e.itemId);
  }
  if (dated.length === 0) return validateReason(args.soReason, "Order delay reason");
  for (const e of entries) {
    if (dated.includes(e.itemId)) continue;
    const item = byId.get(e.itemId);
    if (item?.dispatchState === "dispatched") continue;
    if (!String(e.reason ?? "").trim() && !String(args.soReason ?? "").trim()) {
      return fail("reason_required", "Every item you cannot schedule needs a delay reason.", e.itemId);
    }
  }
  return ok;
}

export function validateReschedule(args: {
  today: string;
  items: readonly ItemLike[];
  entries: readonly { itemId: string; date?: string | null }[];
  reason?: string | null;
}): Validation {
  const reasonCheck = validateReason(args.reason, "Reschedule reason");
  if (!reasonCheck.ok) return reasonCheck;
  const entries = (args.entries || []).filter((e) => e && e.itemId);
  if (entries.length === 0) return fail("no_items", "Select at least one scheduled item to reschedule.");
  const byId = new Map((args.items || []).map((it) => [it.id, it]));
  for (const e of entries) {
    const item = byId.get(e.itemId);
    if (!item) return fail("unknown_item", "That item is not on this sales order.", e.itemId);
    if (item.dispatchState !== "scheduled") {
      return fail("not_scheduled", "Only scheduled, undispatched items can be rescheduled.", e.itemId);
    }
    if (!isDayString(e.date)) return fail("bad_date", "Pick the new dispatch date (YYYY-MM-DD).", e.itemId);
    if (e.date < args.today) return fail("past_date", "The new dispatch date cannot be in the past.", e.itemId);
  }
  return ok;
}

export interface DispatchProof {
  invoiceId?: string | null;
  beforeId?: string | null;
  afterId?: string | null;
}

export function validateDispatch(args: {
  items: readonly ItemLike[];
  entries: readonly { itemId: string; qty?: number | null }[];
  /** Required: no invoice, no dispatch (even partial). Packing photos ride along when available. */
  proof?: DispatchProof | null;
}): Validation {
  const entries = (args.entries || []).filter((e) => e && e.itemId);
  if (entries.length === 0) return fail("no_items", "Select at least one item to dispatch.");
  const p = args.proof || null;
  const s = (v: unknown) => String(v ?? "").trim();
  if (!p || !s(p.invoiceId)) {
    return fail(
      "proof_required",
      "Add the invoice PDF before dispatching. Packing photos can be added if available.",
    );
  }
  const byId = new Map((args.items || []).map((it) => [it.id, it]));
  for (const e of entries) {
    const item = byId.get(e.itemId);
    if (!item) return fail("unknown_item", "That item is not on this sales order.", e.itemId);
    if (item.dispatchState === "dispatched") {
      return fail("already_dispatched", "Item is already fully dispatched.", e.itemId);
    }
    if (item.dispatchState !== "scheduled") {
      return fail("not_scheduled", "Schedule the item before dispatching it.", e.itemId);
    }
    const qty = Number(item.qty ?? 0);
    const done = Number(item.dispatchedQty ?? 0);
    const remaining = Math.max(0, qty - done);
    if (e.qty === undefined || e.qty === null) continue;
    const want = Number(e.qty);
    if (!Number.isFinite(want) || want <= 0) {
      return fail("bad_qty", "Dispatch quantity must be greater than zero.", e.itemId);
    }
    if (remaining > 0 && want > remaining + 1e-6) {
      return fail("bad_qty", `Only ${remaining} left on this item.`, e.itemId);
    }
  }
  return ok;
}

export function resolveDispatchQty(
  item: ItemLike | undefined,
  entry: { itemId: string; qty?: number | null } | undefined,
): number {
  if (!item) return 0;
  const remaining = Math.max(0, Number(item.qty ?? 0) - Number(item.dispatchedQty ?? 0));
  const wanted = entry?.qty;
  if (wanted === undefined || wanted === null) return remaining;
  const n = Number(wanted);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, remaining);
}
