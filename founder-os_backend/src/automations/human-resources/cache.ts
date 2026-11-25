import { cacheDelPrefix } from '../../shared/cache';

export const DATA_TTL_MS = 5 * 60 * 1000;
export const DATA_CACHE_PREFIX = 'human-resources:dashboard:';

export async function invalidateHumanResourcesCache(): Promise<void> {
  try { await cacheDelPrefix(DATA_CACHE_PREFIX); } catch { /* best-effort */ }
}

/** Employee identity/name writes also feed the sales board and chat labels.
 *  Clear the derived sales payloads so a renamed employee never waits for TTL. */
export async function invalidateEmployeeNameCaches(): Promise<void> {
  await invalidateHumanResourcesCache();
  const prefixes = [
    'telecalling:dashboard',
    'telecalling:drill:',
    'telecalling:converters',
    'telecalling:followups',
    'telecalling:risk_cache',
  ];
  await Promise.all(prefixes.map(async (prefix) => {
    try { await cacheDelPrefix(prefix); } catch { /* best-effort */ }
  }));
}
