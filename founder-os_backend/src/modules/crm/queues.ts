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
 *  dispatch-floor  — scheduled work that must move today (due today or overdue)
 *  unscheduled     — nothing dated yet, or only some items dated
 *  scheduled       — every item dated, none dispatched
 *  dispatched      — at least one item dispatched
 *  source-deleted  — Zoho stopped returning it; awaiting human confirmation
 *  all             — everything that isn't flagged as deleted at source
 */
export function orderMatchesView(order: ViewOrder, view: View, today: string): boolean {
  const items = order.items || [];
  switch (view) {
    case 'source-deleted':
      return order.sourceState === 'deleted_source';
    case 'dispatch-floor': {
      if (order.sourceState !== 'active') return false;
      if (order.lifecycle === 'cancelled') return false;
      if (order.lifecycle === 'dispatched') return false;
      return countDueToday(items, today) > 0 || isOrderOverdue(items, today);
    }
    case 'unscheduled':
      return (
        order.sourceState === 'active' &&
        (order.lifecycle === 'unscheduled' || order.lifecycle === 'partially_scheduled')
      );
    case 'scheduled':
      return order.sourceState === 'active' && order.lifecycle === 'scheduled';
    case 'dispatched':
      return (
        order.sourceState === 'active' &&
        (order.lifecycle === 'dispatched' || order.lifecycle === 'partially_dispatched')
      );
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
