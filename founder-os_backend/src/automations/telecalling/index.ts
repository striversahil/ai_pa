import type { AutomationContext } from '../../modules/automation/types';
import { runLeadConversion, getTelecallingDashboardData } from './service';

/**
 * Unified telecalling automation. The handler runs the Lead Conversion engine
 * (deal unassigned Zoho estimates to conversion specialists; risk re-poaching
 * stays behind the MIS "EOD Reassignment" switch, currently OFF). The EOD
 * remark deduction (−10 per red-risk holding) runs via runEodRemarkDeduction,
 * triggered by GitHub Actions cron → POST /api/trigger/telecalling/eod
 * (and locally on the Express runtime via the same path).
 */
export async function handler(_ctx: AutomationContext): Promise<void> {
  await runLeadConversion();
}

/** Dashboard data provider — GET /api/automations/telecalling/data */
export { getTelecallingDashboardData as data };
