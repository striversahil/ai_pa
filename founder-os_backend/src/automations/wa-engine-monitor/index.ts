import { checkWaEngineSession } from './session-monitor';
import { getWaEngineDashboardData } from './dashboard';
import type { AutomationContext } from '../../modules/automation/types';

export async function handler() {
  await checkWaEngineSession();
}

export async function data(ctx: AutomationContext): Promise<any> {
  return getWaEngineDashboardData(ctx);
}
