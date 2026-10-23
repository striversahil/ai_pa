import type { AutomationContext } from '../../modules/automation/types';
import { getPaymentTrackerData } from './service';

/**
 * Payment Tracker automation: debtors ageing + collections ledger, imported
 * by pasting the accounts team's Excel sheets (deterministic — no LLM).
 * Shared by sales (`payment-tracker`) + accounts (`accounts`); imports and
 * contacts stay accounts-only. Native cron logs a reminder dry-run at 10:00
 * IST (live sending awaits WABA template + opt-in).
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
