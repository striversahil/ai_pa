// crm/queue.ts — which order sits in which tab.
//
// MIRROR of `founder-os_backend/src/modules/crm/queues.ts`. Same names, same
// semantics — change both together (guard: scripts/guards/crm-lifecycle.test.mjs).
//
// Tabs are workflow states, not Zoho statuses: Accounts / procurement data
// survives as search + filters inside "All SOs" rather than separate desks.
import { countDueToday, isOrderOverdue, type ItemLike } from "./lifecycle";
import type { Lifecycle, View } from "./types";

export interface ViewOrder {
  lifecycle: Lifecycle;
  sourceState: "active" | "deleted_source";
  items: readonly ItemLike[];
  /** Zoho statuses — only the sales bucket predicates read these. */
  status?: string;
  orderStatus?: string;
  paidStatus?: string;
}

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** Payment finished? `paid_status === 'paid'` is the signal; a closed order
 *  with no payment flag counts as finished too. A partially-paid closed order
 *  stays INCOMPLETE. Mirror: backend crm/queues.ts. */
export function isPaymentComplete(order: Pick<ViewOrder, "status" | "orderStatus" | "paidStatus">): boolean {
  const paid = lower(order.paidStatus);
  const orderStatus = lower(order.orderStatus);
  if (paid === "paid") return true;
  if (paid === "partially_paid") return false;
  return orderStatus === "closed";
}

/** Which sales bucket the order sits in (null = neither: cancelled/deleted). */
export function salesBucket(order: ViewOrder): "incomplete" | "completed" | null {
  if (order.sourceState !== "active") return null;
  const status = lower(order.status);
  if (status === "cancelled" || status === "void" || order.lifecycle === "cancelled") return null;
  return isPaymentComplete(order) ? "completed" : "incomplete";
}

export function orderMatchesView(order: ViewOrder, view: View, today: string): boolean {
  const items = order.items || [];
  // Membership is per ITEM, not per lifecycle bucket: an order with one
  // dispatched, one dated and one undated item is still open in all three
  // states, so it shows in Unscheduled, Scheduled and Dispatched alike.
  const live = order.sourceState === "active" && order.lifecycle !== "cancelled";
  // Removed lines stay in DB for audit but never count as live work.
  const open = items.filter((it) => !(it as any)?.removedAt);
  const someItem = (state: "unscheduled" | "scheduled" | "dispatched") =>
    open.some((it) => it.dispatchState === state);
  switch (view) {
    case "source-deleted":
      return order.sourceState === "deleted_source";
    case "dispatch-floor": {
      if (!live) return false;
      if (order.lifecycle === "dispatched") return false;
      return countDueToday(open, today) > 0 || isOrderOverdue(open, today);
    }
    case "unscheduled":
      // No items captured yet counts as unscheduled — nothing ships undated.
      return live && (open.length === 0 || someItem("unscheduled"));
    case "scheduled":
      return live && someItem("scheduled");
    case "dispatched":
      return live && someItem("dispatched");
    case "all":
      return order.sourceState === "active";
    // Unified Sales → Dispatch buckets. Incomplete keeps the whole pipeline
    // (undated, dated, dispatched-not-paid); Completed is fully paid only.
    case "incomplete":
      return salesBucket(order) === "incomplete";
    case "completed":
      return salesBucket(order) === "completed";
    default:
      return false;
  }
}

export function earliestCommittedDate(items: readonly ItemLike[]): string {
  let min = "";
  for (const it of items || []) {
    if ((it as any)?.removedAt) continue;
    if (it.dispatchState !== "scheduled") continue;
    const d = String(it.tentativeDispatchDate || "");
    if (!d) continue;
    if (!min || d < min) min = d;
  }
  return min;
}

export interface OrderFlags {
  overdue: boolean;
  dueToday: number;
  canSchedule: boolean;
  canDispatch: boolean;
}

export function orderFlags(order: ViewOrder, today: string): OrderFlags {
  const items = order.items || [];
  const open = items.filter((it) => !(it as any)?.removedAt);
  return {
    overdue: isOrderOverdue(open, today),
    dueToday: countDueToday(open, today),
    canSchedule:
      order.sourceState === "active" &&
      order.lifecycle !== "cancelled" &&
      open.some((it) => it.dispatchState === "unscheduled"),
    canDispatch:
      order.sourceState === "active" &&
      order.lifecycle !== "cancelled" &&
      open.some((it) => it.dispatchState === "scheduled"),
  };
}
