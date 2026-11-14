// movement-parts/pure.ts — pure sales-order movement aggregation for the
// Analyzer tab (custom date ranges + region scope).
//
// Framework-free + synchronous: no DB/cache/network, so the guard
// scripts/guards/estimates-movement.test.mjs can run it on fakes. The read
// path (CrmSalesOrder scan + Customer-Master region resolution) lives in
// ../movement.ts and imports this — pure never imports io.
// Mirror: the frontend range helpers in src/components/zoho/utils.ts
// (inDateRange/sumTotals) share the same date-window semantics.
export type RegionBucket = 'R1' | 'R2' | 'R3' | 'R4' | 'UNMAPPED';

export interface MovementOrderRow {
  so: string;
  ref: string;
  customer: string;
  total: number;
  status: string;
  createdDate: string;
  org: string;
  region: string;
  /** Region bucket after Customer-Master resolution ('' → UNMAPPED). */
  bucket: RegionBucket;
}

export interface MovementParams {
  from: string;
  to: string;
  /** 'all' | R1..R4 | 'UNMAPPED' */
  region: string;
  /** 'all' | Zoho organization_id */
  org: string;
}

export interface MovementRegionTotal {
  count: number;
  totalValue: number;
}

export interface MovementResult {
  from: string;
  to: string;
  region: string;
  org: string;
  salesOrders: { count: number; totalValue: number; rows: MovementOrderRow[] };
  /** Totals over the date+org scope (region filter NOT applied) — feeds the
   *  region pills so the counts stay stable while filtering. */
  byRegion: Record<RegionBucket, MovementRegionTotal>;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const VALID_REGIONS = new Set(['R1', 'R2', 'R3', 'R4']);
/** Rows returned per response — newest first (ranges stay small; the last 30
 *  days hold ~100 orders, but a wide "all" range must not balloon). */
const MAX_ROWS = 500;

function isValidDay(v: unknown): v is string {
  return typeof v === 'string' && ISO_DAY.test(v);
}

export function bucketOf(region: unknown): RegionBucket {
  const r = String(region ?? '').trim().toUpperCase();
  return (VALID_REGIONS.has(r) ? r : 'UNMAPPED') as RegionBucket;
}

export function normalizeRegionParam(v: unknown): string {
  const r = String(v ?? '').trim().toUpperCase();
  if (r === 'ALL' || r === '') return 'all';
  if (r === 'UNMAPPED') return 'UNMAPPED';
  return VALID_REGIONS.has(r) ? r : 'all';
}

/** Clamp/swap/validate the custom range; invalid ends fall back to today. */
export function normalizeMovementRange(from: unknown, to: unknown, today: string): { from: string; to: string } {
  let f = isValidDay(from) ? (from as string) : today;
  let t = isValidDay(to) ? (to as string) : today;
  if (f > t) [f, t] = [t, f];
  return { from: f, to: t };
}

/** Pure aggregation: date + org + region filter, group, sum. */
export function aggregateSalesOrderMovement(rows: MovementOrderRow[], params: MovementParams): MovementResult {
  const { from, to, org } = params;
  const region = normalizeRegionParam(params.region);
  const inScope = (rows ?? []).filter((o) => {
    const day = String((o as any)?.createdDate ?? '').slice(0, 10);
    if (!isValidDay(day) || day < from || day > to) return false;
    if (org !== 'all' && String((o as any)?.org ?? '') !== org) return false;
    return true;
  });
  const byRegion: Record<RegionBucket, MovementRegionTotal> = {
    R1: { count: 0, totalValue: 0 },
    R2: { count: 0, totalValue: 0 },
    R3: { count: 0, totalValue: 0 },
    R4: { count: 0, totalValue: 0 },
    UNMAPPED: { count: 0, totalValue: 0 },
  };
  for (const o of inScope) {
    const b = bucketOf((o as any)?.bucket ?? (o as any)?.region);
    const v = Number((o as any)?.total) || 0;
    byRegion[b].count += 1;
    byRegion[b].totalValue += v;
  }
  const filtered = region === 'all' ? inScope : inScope.filter((o) => bucketOf((o as any)?.bucket ?? (o as any)?.region) === region);
  const totalValue = filtered.reduce((s, o) => s + (Number((o as any)?.total) || 0), 0);
  const sorted = [...filtered].sort((a, b) => String((b as any)?.createdDate ?? '').localeCompare(String((a as any)?.createdDate ?? '')));
  return {
    from, to, region, org,
    salesOrders: { count: filtered.length, totalValue, rows: sorted.slice(0, MAX_ROWS) },
    byRegion,
  };
}
