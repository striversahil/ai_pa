import { cacheGet, cacheSet } from '../../shared/cache';
import { getWaEngineSessionInfo } from './session-status';
import { buildHealthPayload } from '../monitoring/health';
import type { WaEngineSessionInfo } from './session-status';

interface WaEngineCacheEntry {
  sessionInfo: WaEngineSessionInfo;
  health: Awaited<ReturnType<typeof buildHealthPayload>> | null;
  capturedAt: number;
}

/**
 * Cache lifetime (5 min). Kept slightly above the cron interval so the
 * dashboard serves the cron-tick snapshot and only falls back to a live
 * fetch when the cache has gone stale (cron missed / server just booted).
 */
const DEFAULT_TTL_MS = 6 * 60 * 1000;

// KV-backed so the snapshot survives worker isolate restarts (the every-5-min
// session monitor refreshes it). Falls back to in-memory on non-Worker runtimes
// via the shared cache module.
const CACHE_KEY = 'wa-engine:snapshot';
const TTL_MS = DEFAULT_TTL_MS;

/**
 * Fetch a fresh WA Engine Pro snapshot + platform health payload and store it
 * in the KV cache. Called by the every-5-minute session monitor cron so the
 * dashboard never needs to hit WA Engine Pro itself.
 */
export async function refreshWaEngineCache(): Promise<WaEngineCacheEntry> {
  const sessionInfo = await getWaEngineSessionInfo(5000);
  const waEngineStatus = { status: sessionInfo.status, reachable: sessionInfo.reachable, error: sessionInfo.error };
  const health = await buildHealthPayload(waEngineStatus).catch(() => null);
  const entry: WaEngineCacheEntry = { sessionInfo, health, capturedAt: Date.now() };
  await cacheSet(CACHE_KEY, entry, TTL_MS);
  return entry;
}

/**
 * Read the cached snapshot. Serves the cache while fresh; if stale (or empty)
 * performs a live refresh, falling back to the last known cache on failure.
 */
export async function getWaEngineCache(ttlMs: number = DEFAULT_TTL_MS, allowLive: boolean = true): Promise<WaEngineCacheEntry> {
  const hit = await cacheGet<WaEngineCacheEntry>(CACHE_KEY, ttlMs);
  if (hit) return hit;
  if (allowLive) {
    try {
      return await refreshWaEngineCache();
    } catch {
      // serve the stale snapshot (past TTL) rather than erroring
      const stale = await cacheGet<WaEngineCacheEntry>(CACHE_KEY, Number.MAX_SAFE_INTEGER);
      if (stale) return stale;
      throw new Error('WA Engine cache empty and live refresh failed');
    }
  }
  const stale = await cacheGet<WaEngineCacheEntry>(CACHE_KEY, Number.MAX_SAFE_INTEGER);
  if (!stale) throw new Error('WA Engine cache empty');
  return stale;
}

export async function getWaEngineCacheStats(): Promise<{ capturedAt: number | null; ageMs: number | null }> {
  const hit = await cacheGet<WaEngineCacheEntry>(CACHE_KEY, Number.MAX_SAFE_INTEGER);
  return { capturedAt: hit?.capturedAt ?? null, ageMs: hit ? Date.now() - hit.capturedAt : null };
}