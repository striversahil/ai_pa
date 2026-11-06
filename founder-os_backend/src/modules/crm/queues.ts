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
  /** Zoho statuses — only the sales bucket predicates read these. Optional so
   *  the existing item-level tabs keep working with a bare shape. */
  status?: string;
  orderStatus?: string;
  paidStatus?: string;
}

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();

/** Payment finished? The sales buckets are "still owed" vs "paid in full".
 *  `paid_status === 'paid'` is the signal; a closed order with no payment flag
 *  (Zoho's draft/closed rows carry '') counts as finished too — nothing is
 *  outstanding on it. A partially-paid closed order stays INCOMPLETE. */
export function isPaymentComplete(order: Pick<ViewOrder, 'status' | 'orderStatus' | 'paidStatus'>): boolean {
  const paid = lower(order.paidStatus);
  const orderStatus = lower(order.orderStatus);
  if (paid === 'paid') return true;
  if (paid === 'partially_paid') return false;
  return orderStatus === 'closed';
}

/** Which sales bucket the order sits in. Cancelled / void / source-deleted
 *  belong to neither — the sales view never renders them. */
export function salesBucket(order: ViewOrder): 'incomplete' | 'completed' | null {
  if (order.sourceState !== 'active') return null;
  const status = lower(order.status);
  if (status === 'cancelled' || status === 'void' || order.lifecycle === 'cancelled') return null;
  return isPaymentComplete(order) ? 'completed' : 'incomplete';
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
  // Removed lines stay in DB for audit but never count as live work.
  const open = items.filter((it) => !(it as any)?.removedAt);
  const someItem = (state: 'unscheduled' | 'scheduled' | 'dispatched') =>
    open.some((it) => it.dispatchState === state);
  switch (view) {
    case 'source-deleted':
      return order.sourceState === 'deleted_source';
    case 'dispatch-floor': {
      if (!live) return false;
      if (order.lifecycle === 'dispatched') return false;
      return countDueToday(open, today) > 0 || isOrderOverdue(open, today);
    }
    case 'unscheduled':
      // No items captured yet counts as unscheduled — nothing ships undated.
      return live && (open.length === 0 || someItem('unscheduled'));
    case 'scheduled':
      return live && someItem('scheduled');
    case 'dispatched':
      return live && someItem('dispatched');
    case 'all':
      return order.sourceState === 'active';
    // Unified Sales → Dispatch buckets. Incomplete keeps the whole pipeline
    // (undated, dated, dispatched-not-paid); Completed is fully paid only.
    case 'incomplete':
      return salesBucket(order) === 'incomplete';
    case 'completed':
      return salesBucket(order) === 'completed';
    default:
      return false;
  }
}

/** Earliest committed date on the order (for floor ordering). */
export function earliestCommittedDate(items: readonly ItemLike[]): string {
  let min = '';
  for (const it of items || []) {
    if ((it as any)?.removedAt) continue;
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
    const open = (order.items || []).filter((it) => !(it as any)?.removedAt);
    const overdue = isOrderOverdue(open, today);
    return `${overdue ? '0' : '1'}:${earliestCommittedDate(open)}`;
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
  const open = items.filter((it) => !(it as any)?.removedAt);
  return {
    overdue: isOrderOverdue(open, today),
    dueToday: countDueToday(open, today),
    canSchedule:
      order.sourceState === 'active' &&
      order.lifecycle !== 'cancelled' &&
      open.some((it) => it.dispatchState === 'unscheduled'),
    canDispatch:
      order.sourceState === 'active' &&
      order.lifecycle !== 'cancelled' &&
      open.some((it) => it.dispatchState === 'scheduled'),
  };
}
