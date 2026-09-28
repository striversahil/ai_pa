import type { AutomationContext } from '../../modules/automation/types';
import { getOverviewData } from '../_overview-shared/aggregator';

/**
 * Sahil Overview automation: concise one-page highlight across all
 * dashboards. Thin orchestrator — compute lives in `../_overview-shared/`.
 * Live cadence: on-demand dashboard (`GET /api/automations/sahil-overview/data`).
 */
export async function handler(_ctx: AutomationContext): Promise<void> {
  // Read-only aggregator — nothing to execute on trigger.
}

export async function data(_ctx?: AutomationContext): Promise<unknown> {
  return getOverviewData('sahil');
}
