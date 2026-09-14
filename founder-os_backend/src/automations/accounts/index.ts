import type { AutomationContext } from '../../modules/automation/types';
import { runDailyRollover, getAccountsDashboardData } from './service';

/**
 * Accounts automation: daily rollover ensures one log instance per due
 * recurring template + flags stale pendings overdue. Deterministic, no LLM.
 * Live cadence: POST /api/trigger/accounts (GH cron or manual).
 */
export async function handler(_ctx: AutomationContext): Promise<void> {
  await runDailyRollover();
}

/** Dashboard data provider — GET /api/automations/accounts/data */
export async function data(ctx?: AutomationContext): Promise<unknown> {
  const query = (ctx?.subject ?? {}) as Record<string, any>;
  return getAccountsDashboardData(query);
}
