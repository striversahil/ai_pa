import type { AutomationContext } from '../../modules/automation/types';
import { getPaymentTrackerData } from './service';

/**
 * Payment Tracker automation: debtors ageing + collections ledger, imported
 * by pasting the accounts team's Excel sheets (deterministic — no LLM).
 * Live cadence: none scheduled. Data flows through the paste-import endpoints:
 *   POST /api/payment-tracker/import/debtors      (paste ageing sheet)
 *   POST /api/payment-tracker/import/collections  (paste receipts sheet)
 *   GET  /api/payment-tracker/data                (KV-cached dashboard payload)
 */
export async function handler(_ctx: AutomationContext): Promise<void> {
  // No scheduled work: ageing recomputes live on every dashboard read.
}

/** Dashboard data provider — GET /api/automations/payment-tracker/data */
export async function data(_ctx?: AutomationContext): Promise<unknown> {
  return getPaymentTrackerData();
}
