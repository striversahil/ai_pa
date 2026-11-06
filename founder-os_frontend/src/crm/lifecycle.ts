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
  /** Client-confirmed qty override (null = follow Zoho qty). */
  amendedQty?: number | null;
  /** Floor removal marker — removed lines leave every queue. */
  removedAt?: string | null;
  /** True for lines added by the floor (no Zoho lineKey). */
  isLocalAdded?: boolean | null;
}

/** Quantity the floor works against: the amended override wins over Zoho qty. */
export function effectiveQty(item: Pick<ItemLike, "qty" | "amendedQty"> | undefined | null): number {
  if (!item) return 0;
  const over = item.amendedQty;
  if (over !== null && over !== undefined) return Number(over);
  return Number(item.qty ?? 0);
}

/** True once the floor removes a line — it stays in DB but leaves every queue. */
export function isRemovedItem(item: Pick<ItemLike, "removedAt"> | undefined | null): boolean {
  return !!(item as any)?.removedAt;
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
  const list = (Array.isArray(items) ? items : []).filter((it) => !isRemovedItem(it));
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
  if (!item || isRemovedItem(item) || item.dispatchState !== "scheduled") return false;
  if (!isDayString(item.tentativeDispatchDate)) return false;
  return item.tentativeDispatchDate < today;
}

export function isDueTodayItem(item: ItemLike, today: string): boolean {
  if (!item || isRemovedItem(item) || item.dispatchState !== "scheduled") return false;
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
    if (isRemovedItem(item)) {
      return fail("removed_item", "That item was removed from this sales order — it cannot be scheduled.", e.itemId);
    }
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
    if (isRemovedItem(item)) {
      return fail("removed_item", "That item was removed from this sales order — it cannot be rescheduled.", e.itemId);
    }
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
  transportId?: string | null;
  courierId?: string | null;
  packingListId?: string | null;
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
    if (isRemovedItem(item)) {
      return fail("removed_item", "That item was removed from this sales order — it cannot be dispatched.", e.itemId);
    }
    if (item.dispatchState === "dispatched") {
      return fail("already_dispatched", "Item is already fully dispatched.", e.itemId);
    }
    if (item.dispatchState !== "scheduled") {
      return fail("not_scheduled", "Schedule the item before dispatching it.", e.itemId);
    }
    const qty = effectiveQty(item);
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
  if (!item || isRemovedItem(item)) return 0;
  const remaining = Math.max(0, effectiveQty(item) - Number(item.dispatchedQty ?? 0));
  const wanted = entry?.qty;
  if (wanted === undefined || wanted === null) return remaining;
  const n = Number(wanted);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, remaining);
}

// ── Amendments (floor overlay, client-confirmed) ─────────────────────────────

export interface AmendQtyChange {
  itemId: string;
  qty: number;
}

export interface AmendRemove {
  itemId: string;
}

export interface AmendAdd {
  name: string;
  qty: number;
  unit?: string | null;
  rate?: number | null;
}

export function validateAmend(args: {
  items: readonly ItemLike[];
  qtyChanges?: readonly AmendQtyChange[];
  removals?: readonly AmendRemove[];
  additions?: readonly AmendAdd[];
  reason?: string | null;
}): Validation {
  const reasonCheck = validateReason(args?.reason, "Client confirmation note");
  if (!reasonCheck.ok) return reasonCheck;
  const qtyChanges = (args.qtyChanges || []).filter((c) => c && (c as any).itemId);
  const removals = (args.removals || []).filter((r) => r && (r as any).itemId);
  const additions = (args.additions || []).filter((a) => a);
  if (qtyChanges.length + removals.length + additions.length === 0) {
    return fail("no_changes", "Nothing to amend — change a quantity, remove a line, or add one.");
  }
  const byId = new Map((args.items || []).map((it) => [it.id, it]));
  const touched = new Set<string>();
  for (const c of [...qtyChanges, ...removals]) {
    const id = String((c as any)?.itemId || "");
    if (!id) continue;
    if (touched.has(id)) return fail("duplicate_item", "An item can only appear once per amendment.", id);
    touched.add(id);
  }
  for (const c of qtyChanges) {
    const item = byId.get(c.itemId);
    if (!item) return fail("unknown_item", "That item is not on this sales order.", c.itemId);
    if (isRemovedItem(item)) {
      return fail("removed_item", "That item was already removed from this sales order.", c.itemId);
    }
    const want = Number(c.qty);
    if (!Number.isFinite(want) || want <= 0) {
      return fail("bad_qty", "The amended quantity must be greater than zero.", c.itemId);
    }
    const done = Number(item.dispatchedQty ?? 0);
    if (want < done - 1e-6) {
      return fail("bad_qty", `Already dispatched ${done} — the amended quantity cannot go below that.`, c.itemId);
    }
  }
  for (const r of removals) {
    const item = byId.get(r.itemId);
    if (!item) return fail("unknown_item", "That item is not on this sales order.", r.itemId);
    if (isRemovedItem(item)) {
      return fail("removed_item", "That item was already removed from this sales order.", r.itemId);
    }
    if (item.dispatchState === "dispatched" || Number(item.dispatchedQty ?? 0) > 1e-6) {
      return fail("already_dispatched", "Dispatched quantities cannot be removed — amend the remainder instead.", r.itemId);
    }
  }
  for (const a of additions) {
    if (!String((a as any)?.name ?? "").trim()) return fail("bad_name", "An added line needs an item name.");
    const want = Number((a as any)?.qty);
    if (!Number.isFinite(want) || want <= 0) {
      return fail("bad_qty", "An added line needs a quantity greater than zero.");
    }
  }
  return ok;
}

export function validateLocalCancel(args: {
  reason?: string | null;
  order?: OrderLike | null;
  localCancelledAt?: string | null;
}): Validation {
  if (args?.localCancelledAt) {
    return fail("already_cancelled", "This sales order is already cancelled on the floor.");
  }
  if (isCancelledOrder(args?.order)) {
    return fail("already_cancelled", "Zoho already cancelled this sales order — nothing to cancel.");
  }
  return validateReason(args?.reason, "Cancellation reason");
}
