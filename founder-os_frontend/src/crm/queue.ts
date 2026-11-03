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
}

export function orderMatchesView(order: ViewOrder, view: View, today: string): boolean {
  const items = order.items || [];
  switch (view) {
    case "source-deleted":
      return order.sourceState === "deleted_source";
    case "dispatch-floor": {
      if (order.sourceState !== "active") return false;
      if (order.lifecycle === "cancelled") return false;
      if (order.lifecycle === "dispatched") return false;
      return countDueToday(items, today) > 0 || isOrderOverdue(items, today);
    }
    case "unscheduled":
      return (
        order.sourceState === "active" &&
        (order.lifecycle === "unscheduled" || order.lifecycle === "partially_scheduled")
      );
    case "scheduled":
      return order.sourceState === "active" && order.lifecycle === "scheduled";
    case "dispatched":
      return (
        order.sourceState === "active" &&
        (order.lifecycle === "dispatched" || order.lifecycle === "partially_dispatched")
      );
    case "all":
      return order.sourceState === "active";
    default:
      return false;
  }
}

export function earliestCommittedDate(items: readonly ItemLike[]): string {
  let min = "";
  for (const it of items || []) {
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
  return {
    overdue: isOrderOverdue(items, today),
    dueToday: countDueToday(items, today),
    canSchedule:
      order.sourceState === "active" &&
      order.lifecycle !== "cancelled" &&
      items.some((it) => it.dispatchState === "unscheduled"),
    canDispatch:
      order.sourceState === "active" &&
      order.lifecycle !== "cancelled" &&
      items.some((it) => it.dispatchState === "scheduled"),
  };
}
