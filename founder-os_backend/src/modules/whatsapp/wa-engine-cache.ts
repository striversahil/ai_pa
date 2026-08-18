import { getWaEngineSessionInfo } from './session-status';
import { buildHealthPayload } from '../monitoring/health';
import type { WaEngineSessionInfo } from './session-status';

interface WaEngineCacheEntry {
  sessionInfo: WaEngineSessionInfo;
  health: Awaited<ReturnType<typeof buildHealthPayload>> | null;
  capturedAt: number;
}

let cache: WaEngineCacheEntry | null = null;

/**
 * Cache lifetime (5 min). Kept slightly above the cron interval so the
 * dashboard serves the cron-tick snapshot and only falls back to a live
 * fetch when the cache has gone stale (cron missed / server just booted).
 */
const DEFAULT_TTL_MS = 6 * 60 * 1000;

/**
 * Fetch a fresh WA Engine Pro snapshot + platform health payload and store it
 * in memory. Called by the every-5-minute session monitor cron so the
 * dashboard never needs to hit WA Engine Pro itself.
 */
export async function refreshWaEngineCache(): Promise<WaEngineCacheEntry> {
  const sessionInfo = await getWaEngineSessionInfo(5000);
  const waEngineStatus = { status: sessionInfo.status, reachable: sessionInfo.reachable, error: sessionInfo.error };
  const health = await buildHealthPayload(waEngineStatus).catch(() => null);
  cache = { sessionInfo, health, capturedAt: Date.now() };
  return cache;
}

/**
 * Read the cached snapshot. Serves the cache while fresh; if stale (or empty)
 * performs a live refresh, falling back to the last known cache on failure.
 */
export async function getWaEngineCache(ttlMs: number = DEFAULT_TTL_MS, allowLive: boolean = true): Promise<WaEngineCacheEntry> {
  if (cache && Date.now() - cache.capturedAt <= ttlMs) return cache;
  if (allowLive) {
    try {
      return await refreshWaEngineCache();
    } catch {
      if (cache) return cache;
      throw new Error('WA Engine cache empty and live refresh failed');
    }
  }
  if (!cache) throw new Error('WA Engine cache empty');
  return cache;
}

export function getWaEngineCacheStats(): { capturedAt: number | null; ageMs: number | null } {
  return { capturedAt: cache?.capturedAt ?? null, ageMs: cache ? Date.now() - cache.capturedAt : null };
}
