// master-data — Customer master automation.
//
// No schedule: the payload is a KV-cached read of the MasterCustomer table and
// the dashboard refreshes on the typed `master-data` live event after every
// write. The automation exists so the table is a first-class dashboard (sidebar,
// Automations registry, "View data") and so a future Zoho customer sync has a
// slot to live in — same shape as neodove-refresh.
import type { AutomationContext } from '../../modules/automation/types';
import { getMasterDataPayload } from '../../modules/master-data/service';

export async function handler(_ctx: AutomationContext): Promise<void> {
  // Warm the cache; the dashboard reads the same payload.
  await getMasterDataPayload();
}

/** Dashboard data provider — GET /api/automations/master-data/data */
export async function data(_ctx?: AutomationContext): Promise<unknown> {
  return getMasterDataPayload();
}
