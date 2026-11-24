import type { AutomationContext } from '../../modules/automation/types';
import { getDebtorsTrackerData } from './service';

/**
 * Debtors Tracker automation: debtors ageing + collections ledger, imported
 * by pasting the accounts team's Excel sheets (deterministic — no LLM).
 * Shared by sales (`debtors-tracker`) + accounts (`accounts`); imports and
 * contacts stay accounts-only. Native cron logs a reminder dry-run at 10:00
 * IST (live sending awaits WABA template + opt-in).
 *   POST /api/debtors-tracker/import/debtors      (paste ageing sheet)
 *   POST /api/debtors-tracker/import/collections  (paste receipts sheet)
 *   GET  /api/debtors-tracker/data                (KV-cached dashboard payload)
 */
export async function handler(_ctx: AutomationContext): Promise<void> {
  // No scheduled work: ageing recomputes live on every dashboard read.
}

/** Dashboard data provider — GET /api/automations/debtors-tracker/data */
export async function data(ctx?: AutomationContext): Promise<unknown> {
  // `?asOf=&from=` ride through the workspace data route (`ctx.subject` is the
  // query object — see AutomationEngine.getData). No params = today.
  const query = (ctx?.subject ?? {}) as Record<string, unknown>;
  return getDebtorsTrackerData({
    asOf: (query.asOf as string | undefined) ?? null,
    from: (query.from as string | undefined) ?? null,
  });
}
