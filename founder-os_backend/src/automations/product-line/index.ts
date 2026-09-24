import type { AutomationContext } from '../../modules/automation/types';
import { getProductLineData } from './service';

/**
 * Product Line automation: the KYP sheet as data (products, guide questions,
 * vendors, quote facts). No schedule — dashboard reads serve the KV-cached
 * payload; MIS writes go through /api/product-line/* and invalidate it.
 */
export async function handler(_ctx: AutomationContext): Promise<void> {
  await getProductLineData();
}

/** Dashboard data provider — GET /api/automations/product-line/data */
export async function data(_ctx?: AutomationContext): Promise<unknown> {
  return getProductLineData();
}
