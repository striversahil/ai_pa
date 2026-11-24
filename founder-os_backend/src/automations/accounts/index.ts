import type { AutomationContext } from '../../modules/automation/types';
import { getAccountsDashboardData, runThreadMaintenance } from './service';

/**
 * Accounts automation: daily rollover ensures one log instance per due
 * recurring template. Per-day model — past unresolved rows stay as-is and
 * read as not-done in the Incomplete tab (never rewritten). Deterministic,
 * no LLM.
 * Live cadence: POST /api/trigger/accounts (GH cron or manual).
 */
export async function handler(_ctx: AutomationContext): Promise<void> {
  // Thread maintenance (migration 0166): keep the rolling range instantiated and
  // stamp the due days nobody logged, so a missed day becomes the engine's own
  // "Task not done on <date>" entry instead of silently disappearing. The daily
  // Worker cron calls this natively; this handler is the manual/GH trigger.
  await runThreadMaintenance();
}

/** Dashboard data provider — GET /api/automations/accounts/data */
export async function data(ctx?: AutomationContext): Promise<unknown> {
  const query = (ctx?.subject ?? {}) as Record<string, any>;
  return getAccountsDashboardData(query);
}
