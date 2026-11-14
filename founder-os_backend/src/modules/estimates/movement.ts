// movement.ts — sales-order movement read path for the Analyzer tab.
//
// The tracker answers "what happened in this range in this region": SOs
// created + accepted/declined/new estimates. Estimate-side figures compute on
// the client (the payload already carries date/acceptedAt/declinedAt/region);
// the SO side needs a server read because `zoho:salesorders_today` only holds
// today.
//
// Reads: CrmSalesOrder rows in a createdDate window. Blank derived regions
// resolve at READ time through the Customer Master (masterHomeRegions —
// normalized exact match, single-region only; multi-region/ambiguous stays
// Unmapped). Never writes: the sync-derived CrmSalesOrder.region is untouched.
// Pure aggregation lives in ./movement-parts/pure.ts (guard-tested).
//
// Layering precedent: status-sync.ts already imports from
// automations/telecalling/ (istDate) — same pattern here (masterHomeRegions
// + normalizeClientKey).
import { prisma } from '../../shared/prisma';
import { cached } from '../../shared/cache';
import { istDate } from '../../automations/telecalling/util';
import { masterHomeRegions } from '../../automations/telecalling/enquiry-links';
import { normalizeClientKey } from '../../automations/telecalling/client-segments-parts/pure';
import {
  aggregateSalesOrderMovement,
  bucketOf,
  normalizeMovementRange,
  normalizeRegionParam,
  type MovementOrderRow,
  type MovementResult,
} from './movement-parts/pure';

export type { MovementOrderRow, MovementParams, MovementRegionTotal, MovementResult, RegionBucket } from './movement-parts/pure';
export { aggregateSalesOrderMovement, bucketOf, normalizeMovementRange, normalizeRegionParam } from './movement-parts/pure';

/** Read path: SO rows in window → Customer-Master region resolution → aggregate. */
export async function getSalesOrderMovement(input: { from?: unknown; to?: unknown; region?: unknown; org?: unknown }): Promise<MovementResult> {
  const today = istDate();
  const { from, to } = normalizeMovementRange(input?.from, input?.to, today);
  const region = normalizeRegionParam(input?.region);
  const org = String(input?.org ?? 'all').trim() || 'all';
  return cached<MovementResult>(`zoho:movement:${from}:${to}:${org}:${region}`, 5 * 60 * 1000, async () => {
    const db = prisma as any;
    const orders = (await db.crmSalesOrder.findMany({
      select: { soNumber: true, customerName: true, value: true, orderStatus: true, createdDate: true, org: true, region: true, referenceNumber: true },
    }).catch(() => [])) as any[];
    const inWindow = (orders ?? []).filter((o) => {
      const day = String(o?.createdDate ?? '').slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= from && day <= to;
    });
    // Resolve blank derived regions through the Customer Master (exact,
    // single-region only — multi-region/ambiguous stay Unmapped).
    const blankNames = [...new Set(inWindow.filter((o) => !String(o?.region ?? '').trim()).map((o) => String(o?.customerName ?? '')).filter(Boolean))];
    const resolved = blankNames.length > 0 ? await masterHomeRegions(blankNames).catch(() => new Map()) : new Map<string, string>();
    const rows: MovementOrderRow[] = inWindow.map((o) => {
      const stored = String(o?.region ?? '').trim();
      const home = stored || resolved.get(normalizeClientKey(o?.customerName)) || '';
      return {
        so: String(o?.soNumber ?? ''),
        ref: String(o?.referenceNumber ?? ''),
        customer: String(o?.customerName ?? ''),
        total: Number(o?.value) || 0,
        status: String(o?.orderStatus ?? ''),
        createdDate: String(o?.createdDate ?? '').slice(0, 10),
        org: String(o?.org ?? ''),
        region: stored,
        bucket: bucketOf(home),
      };
    });
    return aggregateSalesOrderMovement(rows, { from, to, region, org });
  });
}
