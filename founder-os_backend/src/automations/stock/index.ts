import type { AutomationContext } from '../../modules/automation/types';
import { getStockData } from './service';

/**
 * Stock automation: manual SKU inventory (qty + reorder level + day-wise
 * closing stock). No schedule — dashboard reads the KV-cached payload;
 * MIS writes go through /api/stock/* and invalidate it.
 */
export async function handler(_ctx: AutomationContext): Promise<void> {
  await getStockData();
}

/** Dashboard data provider — GET /api/automations/stock/data */
export async function data(ctx?: AutomationContext): Promise<unknown> {
  const days = Number((ctx?.subject as any)?.days) || 7;
  return getStockData(days);
}
