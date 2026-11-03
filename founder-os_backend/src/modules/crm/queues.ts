// ── CRM order workflow: queue predicates (which row sits in which tab) ──────
//
// MIRROR: founder-os_frontend/src/crm/queue.ts — change both together, never
// let them drift. `scripts/guards/crm-lifecycle.test.mjs` asserts they agree.
//
// The dashboard is a dispatch floor, so the tabs are workflow states, not Zoho
// statuses. Accounts / procurement data survives as search + filters inside
// "All SOs" rather than as separate desks.
import { countDueToday, isOrderOverdue, type ItemLike } from './scheduling';
import type { Lifecycle, View } from './types';

export interface ViewOrder {
  lifecycle: Lifecycle;
  sourceState: 'active' | 'deleted_source';
  items: readonly ItemLike[];
}

/**
 * Does this order belong in `view`?
 *
 * Membership is **per item**, not per lifecycle bucket: an order with three
 * items — one dispatched, one dated, one still undated — is genuinely open in
 * all three states, so it appears in Unscheduled, Scheduled AND Dispatched.
 * Filtering by the derived lifecycle hid exactly the work that was left
 * behind (the "partially dispatched" order with undated items never showed up
 * under Schedule).
 *
 *  dispatch-floor  — scheduled work that must move today (due today or overdue)
 *  unscheduled     — at least one item still undated (no items captured yet ⇒
 *                    treat as unscheduled: nothing can ship before it is dated)
 *  scheduled       — at least one item dated and not yet dispatched
 *  dispatched      — at least one item already dispatched
 *  source-deleted  — Zoho stopped returning it; awaiting human confirmation
 *  all             — everything that isn't flagged as deleted at source
 */
export function orderMatchesView(order: ViewOrder, view: View, today: string): boolean {
  const items = order.items || [];
  const live = order.sourceState === 'active' && order.lifecycle !== 'cancelled';
  const someItem = (state: 'unscheduled' | 'scheduled' | 'dispatched') =>
    items.some((it) => it.dispatchState === state);
  switch (view) {
    case 'source-deleted':
      return order.sourceState === 'deleted_source';
    case 'dispatch-floor': {
      if (!live) return false;
      if (order.lifecycle === 'dispatched') return false;
      return countDueToday(items, today) > 0 || isOrderOverdue(items, today);
    }
    case 'unscheduled':
      // No items captured yet counts as unscheduled — nothing ships undated.
      return live && (items.length === 0 || someItem('unscheduled'));
    case 'scheduled':
      return live && someItem('scheduled');
    case 'dispatched':
      return live && someItem('dispatched');
    case 'all':
      return order.sourceState === 'active';
    default:
      return false;
  }
}

/** Earliest committed date on the order (for floor ordering). */
export function earliestCommittedDate(items: readonly ItemLike[]): string {
  let min = '';
  for (const it of items || []) {
    if (it.dispatchState !== 'scheduled') continue;
    const d = String(it.tentativeDispatchDate || '');
    if (!d) continue;
    if (!min || d < min) min = d;
  }
  return min;
}

/** Worst overdue date on the order — what the floor sorts by first. */
export function sortKeyForView(order: ViewOrder, view: View, today: string): string {
  if (view === 'dispatch-floor') {
    const overdue = isOrderOverdue(order.items, today);
    return `${overdue ? '0' : '1'}:${earliestCommittedDate(order.items)}`;
  }
  return '';
}

/** Row-level badges the UI renders (kept here so both sides agree). */
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
      order.sourceState === 'active' &&
      order.lifecycle !== 'cancelled' &&
      items.some((it) => it.dispatchState === 'unscheduled'),
    canDispatch:
      order.sourceState === 'active' &&
      order.lifecycle !== 'cancelled' &&
      items.some((it) => it.dispatchState === 'scheduled'),
  };
}
