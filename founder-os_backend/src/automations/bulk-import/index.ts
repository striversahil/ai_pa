import type { AutomationContext } from '../../modules/automation/types';
import { listBatches } from './store';

/**
 * Bulk price-list import automation: paste/CSV/XLSX/PDF/photo → staged
 * BulkRows → review → commit as one traceable block. No schedule — ingest
 * runs on demand from the dashboard/chat; heavy file parsing runs in the
 * GH bulk-parse runner.
 */
export async function handler(_ctx: AutomationContext): Promise<void> {
  await listBatches(5);
}

/** Dashboard data provider — GET /api/automations/bulk-import/data */
export async function data(_ctx?: AutomationContext): Promise<unknown> {
  return listBatches(50);
}
