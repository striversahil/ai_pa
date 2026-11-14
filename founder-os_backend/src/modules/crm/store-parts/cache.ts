// cache.ts — dispatch-floor read cache (KV-backed, same contract as the
// accounts payload and the telecalling risk cache).
//
// Why: after the 2026 backfill the floor holds ~1.2k orders / ~3.4k items.
// listOrders + dispatchSummary each re-scanned the whole floor on EVERY read
// (list: take-3000 + items in 90-row chunks ≈ 33 sequential D1 round trips;
// summary: the same again) — per tab open, per search keystroke, per live
// event, per 3-min poll. The expensive part is the D1 scan, never the
// in-memory filter, so ONE cached raw scan serves every view/region/search:
//
//   cachedFloorRows    — the raw scan (orders + items grouped by soId).
//                        Every read filters/slices in memory from this.
//   cachedFloorSummary — per-region headline counters (compute reuses the
//                        cached rows, so a summary hit costs zero D1 reads).
//
// Invalidation is write-through: every floor write funnels through
// mirrorOrderTouch and every runner tick through syncOrders, and both call
// invalidateCrmFloorCache() — so the TTL only bounds cross-isolate staleness
// and expiry recomputes, exactly like invalidateRiskCache().
import { cached, cacheDel, cacheDelPrefix, initCache } from '../../../shared/cache';

// Re-exported for tests/guards (bundled as one module, so this is the same
// instance the wrappers below use).
export { initCache };

/** Raw floor scan shared by the list + summary reads. Bumped to v2: v1
 *  cached a Map-shaped payload, which does not survive KV JSON (see below). */
export const CRM_FLOOR_ROWS_KEY = 'crm:floor:rows:v2';
/** Short: writes invalidate eagerly, so this only bounds cross-isolate lag. */
export const CRM_FLOOR_TTL_MS = 60 * 1000;

const CRM_SUMMARY_PREFIX = 'crm:summary:';
export const CRM_SUMMARY_TTL_MS = 60 * 1000;

/** Raw scan behind the cache — callers map/filter/slice in memory. */
export interface FloorScan {
  rows: any[];
  /** Plain Record, NOT a Map: the KV path stores JSON, and a Map round-trips
   *  to `{}` (no `.get`) — which 500'd every cache hit. */
  items: Record<string, any[]>;
}

export function cachedFloorRows(compute: () => Promise<FloorScan>): Promise<FloorScan> {
  return cached<FloorScan>(CRM_FLOOR_ROWS_KEY, CRM_FLOOR_TTL_MS, compute);
}

export function cachedFloorSummary<T>(regionKey: string, compute: () => Promise<T>): Promise<T> {
  return cached<T>(`${CRM_SUMMARY_PREFIX}${regionKey || 'all'}`, CRM_SUMMARY_TTL_MS, compute);
}

/** Drop every cached floor payload — call after any floor write or sync. */
export async function invalidateCrmFloorCache(): Promise<void> {
  try {
    await cacheDel(CRM_FLOOR_ROWS_KEY);
  } catch {
    /* best-effort */
  }
  try {
    await cacheDelPrefix(CRM_SUMMARY_PREFIX);
  } catch {
    /* best-effort */
  }
}
