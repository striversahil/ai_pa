import { checkWahaSession } from './session-monitor';
import { getWahaDashboardData } from './dashboard';
import type { AutomationContext } from '../../modules/automation/types';

export async function handler() {
  await checkWahaSession();
}

export async function data(ctx: AutomationContext): Promise<any> {
  return getWahaDashboardData(ctx);
}
