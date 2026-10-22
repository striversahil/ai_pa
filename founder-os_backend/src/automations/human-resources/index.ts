import type { AutomationContext } from '../../modules/automation/types';
import { getHumanResourcesDashboardData, invalidateHumanResourcesCache } from './service';

/**
 * Human Resources automation: ad-hoc delegated HR tasks + a fixed/variable
 * expense ledger. No scheduled rollover is needed — tasks are explicitly
 * created with a due date/time and expenses are entered as they happen.
 * Deterministic, no LLM. A manual run only clears the dashboard cache.
 */
export async function handler(_ctx: AutomationContext): Promise<void> {
  await invalidateHumanResourcesCache();
}

export async function data(ctx?: AutomationContext): Promise<unknown> {
  const query = (ctx?.subject ?? {}) as Record<string, any>;
  return getHumanResourcesDashboardData(query);
}
