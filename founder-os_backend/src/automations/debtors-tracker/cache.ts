/**
 * Debtors Tracker cache namespace.
 *
 * The payload now fans out per (as-of, from) pair, so invalidation uses a
 * REVISION key instead of a prefix delete: readers fold `cacheRevs(['debtors'])`
 * into the key, and a write is ONE small `bumpRev` put. `cacheDelPrefix` on a
 * date-variant family is a KV list() plus a delete per variant on every write.
 *
 * Bumped whenever the payload shape or its computation changes
 * (v18 = as-of history + then-vs-now comparison; v17 = shared Top-N).
 */
import { bumpRev, cacheRevs } from '../../shared/cache';

export const DEBTORS_CACHE_PREFIX = 'debtors-tracker:data:v18:';
export const DEBTORS_REV = 'debtors';
export const DEBTORS_TTL_MS = 5 * 60 * 1000;

/** Current revision fragment for this family (fold into the cache key). */
export function debtorsCacheRev(): Promise<string> {
  return cacheRevs([DEBTORS_REV]);
}

/** Invalidate every cached variant (today + every historical date). */
export async function invalidateDebtorsCache(): Promise<void> {
  await bumpRev(DEBTORS_REV);
}
