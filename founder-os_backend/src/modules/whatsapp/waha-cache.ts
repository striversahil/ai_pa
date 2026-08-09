import { getWahaSessionInfo } from './session-status';
import { buildHealthPayload } from '../monitoring/health';
import type { WahaSessionInfo } from './session-status';

interface WahaCacheEntry {
  sessionInfo: WahaSessionInfo;
  health: Awaited<ReturnType<typeof buildHealthPayload>> | null;
  capturedAt: number;
}

let cache: WahaCacheEntry | null = null;

/**
 * Cache lifetime (5 min). Kept slightly above the cron interval so the
 * dashboard serves the cron-tick snapshot and only falls back to a live
 * fetch when the cache has gone stale (cron missed / server just booted).
 */
const DEFAULT_TTL_MS = 6 * 60 * 1000;

/**
 * Fetch a fresh WAHA session snapshot + platform health payload and store it
 * in memory. Called by the every-5-minute session monitor cron so the
 * dashboard never needs to hit WAHA itself.
 */
export async function refreshWahaCache(): Promise<WahaCacheEntry> {
  const sessionInfo = await getWahaSessionInfo(5000);
  const wahaStatus = { status: sessionInfo.status, reachable: sessionInfo.reachable, error: sessionInfo.error };
  const health = await buildHealthPayload(wahaStatus).catch(() => null);
  cache = { sessionInfo, health, capturedAt: Date.now() };
  return cache;
}

/**
 * Read the cached snapshot. Serves the cache while fresh; if stale (or empty)
 * performs a live refresh, falling back to the last known cache on failure.
 */
export async function getWahaCache(ttlMs: number = DEFAULT_TTL_MS, allowLive: boolean = true): Promise<WahaCacheEntry> {
  if (cache && Date.now() - cache.capturedAt <= ttlMs) return cache;
  if (allowLive) {
    try {
      return await refreshWahaCache();
    } catch {
      if (cache) return cache;
      throw new Error('WAHA cache empty and live refresh failed');
    }
  }
  if (!cache) throw new Error('WAHA cache empty');
  return cache;
}

export function getWahaCacheStats(): { capturedAt: number | null; ageMs: number | null } {
  return { capturedAt: cache?.capturedAt ?? null, ageMs: cache ? Date.now() - cache.capturedAt : null };
}
