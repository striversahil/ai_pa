import { cacheDelPrefix } from '../../shared/cache';

export const DATA_TTL_MS = 5 * 60 * 1000;
export const DATA_CACHE_PREFIX = 'human-resources:dashboard:';

export async function invalidateHumanResourcesCache(): Promise<void> {
  try { await cacheDelPrefix(DATA_CACHE_PREFIX); } catch { /* best-effort */ }
}
