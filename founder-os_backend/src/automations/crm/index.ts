import { logger } from '../../shared/logger';
import { dispatchSummary, listOrders } from '../../modules/crm/store';
import { istToday } from '../../modules/crm/types';

/**
 * CRM — Dispatch floor.
 *
 * The dashboard runs on D1 ROWS (CrmSalesOrder + CrmSoItem), written by the
 * GH-Actions runner through /api/runner/crm/orders/sync and worked by the
 * dispatch desk through /api/crm/*. There is no KV snapshot any more: the old
 * blob could only be diffed wholesale, which made per-item scheduling, an
 * audit trail and "deleted at source" detection impossible.
 *
 * Zoho Books stays READ-ONLY — nothing here writes back to it.
 *
 * Lifecycle (derived, never set by hand):
 *   unscheduled → partially_scheduled → scheduled → partially_dispatched → dispatched
 *   cancelled (Zoho said cancelled/void — out of the queues, kept for audit)
 *
 * Department points are still scored, now from the synced status moves inside
 * syncOrders(): +25 new SO (CRM) · +50 confirm (CRM) · +25 material allocated
 * (Procurement) · +50 invoice raised (Accounts) · +50 shipped (Dispatch, or +50
 * full / +25 partial when the floor dispatches it) · +100 payment received
 * (Accounts) · −20 cancelled (charged to the desk holding the order).
 */

export async function handler() {
  // Triggered via GH Actions → /api/trigger/crm. The actual work lives in
  // scripts/crm-runner.js (Zoho paging + detail fetch) and the floor sync route.
  logger.info('CRM automation triggered — runner handles Zoho paging + floor sync.');
}

/**
 * Legacy `data()` surface (automation registry + Express callers). Serves the
 * floor straight from D1 — same answer the dashboards get, never a stale blob.
 */
export async function data() {
  const today = istToday();
  const [counts, orders] = await Promise.all([
    dispatchSummary(today),
    listOrders({ view: 'all', limit: 500, today }),
  ]);
  return { today, counts, orders };
}
