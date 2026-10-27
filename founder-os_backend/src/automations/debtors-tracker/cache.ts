/**
 * Debtors Tracker cache namespace. Bumped whenever the dashboard payload shape
 * or its computation changes (v11 = last invoice date per customer).
 */
import { cacheDelPrefix } from '../../shared/cache';

export const DEBTORS_CACHE_PREFIX = 'debtors-tracker:data:v11:';
export const DEBTORS_TTL_MS = 5 * 60 * 1000;

export async function invalidateDebtorsCache(): Promise<void> {
  await cacheDelPrefix(DEBTORS_CACHE_PREFIX);
}
