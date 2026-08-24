import type { AutomationContext } from '../../modules/automation/types';
import { runLeadConversion, getTelecallingDashboardData } from './service';

/**
 * Unified telecalling automation. The handler runs the Lead Conversion engine
 * (assign unassigned Zoho estimates round-robin + reassign unsatisfactory ones
 * at end of day). Triggered by GitHub Actions cron → POST /api/trigger/telecalling
 * (and locally by the rule.json cron via node-cron on the Express runtime).
 */
export async function handler(_ctx: AutomationContext): Promise<void> {
  await runLeadConversion();
}

/** Dashboard data provider — GET /api/automations/telecalling/data */
export { getTelecallingDashboardData as data };
