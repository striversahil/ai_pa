import type { AutomationContext } from '../../modules/automation/types';
import { runDailyRollover, getDigitalMarketingDashboardData } from './service';

/**
 * Digital Marketing automation: daily rollover ensures one log instance per due
 * recurring template. Per-day model — past unresolved rows stay as-is and
 * read as not-done in the Incomplete tab (never rewritten). Includes daily
 * numeric metrics (Meta/B2B/Whatsapp/Email) and weekly posting proofs.
 * Deterministic, no LLM.
 * Live cadence: POST /api/trigger/digital-marketing (GH cron or manual).
 */
export async function handler(_ctx: AutomationContext): Promise<void> {
  await runDailyRollover();
}

/** Dashboard data provider — GET /api/automations/digital-marketing/data */
export async function data(ctx?: AutomationContext): Promise<unknown> {
  const query = (ctx?.subject ?? {}) as Record<string, any>;
  return getDigitalMarketingDashboardData(query);
}
