import type { AutomationContext } from '../../modules/automation/types';
import { runDueCampaigns } from './service';
import { getMarketingDashboardData } from './dashboard';

// Every minute, tick due campaigns. Campaign scheduling is data-driven (each
// campaign carries its own trigger time / cron), so a single framework cron
// handles an unbounded number of campaigns.
export async function handler(_ctx: AutomationContext) {
  await runDueCampaigns();
}

// GET /api/automations/whatsapp-marketing/data
export async function data(ctx: AutomationContext): Promise<any> {
  return getMarketingDashboardData(ctx);
}
