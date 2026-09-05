/**
 * Reusable KV-backed cache with TTL + invalidation for network calls and
 * expensive D1/Postgres reads.
 *
 * Why KV: D1 row-reads are billed and the dashboards + GitHub Actions runner
 * refetch on every WebSocket broadcast (every 5–15 min). Serving those payloads
 * from a KV snapshot (a) cuts D1 reads by ~100×, (b) is faster than a DB read,
 * and (c) survives across worker isolates.
 *
 * Semantics are shared across the app:
 *   - `cacheGet<T>(key, ttlMs)` returns null when the key is absent OR stale.
 *   - `cacheSet<T>(key, value, ttlMs)` writes the payload + computedAt and an
 *     expiry TTL (ttl + GRACE so stale-on-error fallback still works).
 *   - `cached(key, ttlMs, compute)` is the read-through helper every route
 *     should use: fresh → serve; stale/absent → compute, store, return; compute
 *     fails → serve stale if present, else rethrow (graceful degradation).
 *   - `cacheDel(key)` / `cacheDelPrefix(prefix)` for explicit invalidation the
 *     moment underlying data changes (runner writes, status transitions…).
 *
 * Local (non-Worker) runtimes have no KV binding — we fall back to a small
 * in-memory map with the same TTL contract, so the code paths are identical.
 */
import { logger } from './logger';

const NS = 'kvx'; // namespace prefix so cache keys can't collide with chat files
const GRACE_MS = 5 * 60 * 1000; // keep stale entries around for stale-on-error

// Structural KV type (matches Cloudflare's KVNamespace) so this shared module
// typechecks on BOTH runtimes without importing @cloudflare/workers-types.
interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor: string }>;
}

let kv: KvLike | null = null;

const memory = new Map<string, { payload: unknown; computedAt: number }>();

export function initCache(env?: { CACHE_KV?: KvLike } | null): void {
  kv = env?.CACHE_KV ?? null;
}

export function hasKvCache(): boolean {
  return kv !== null;
}

interface CacheEntry<T> {
  value: T;
  computedAt: string;
}

function isFresh(computedAt: string, ttlMs: number): boolean {
  if (!computedAt) return false;
  const t = Date.parse(computedAt);
  return Number.isFinite(t) && Date.now() - t < ttlMs;
}

/** Read a cached value; null when absent or stale (caller recomputes). */
export async function cacheGet<T>(key: string, ttlMs: number): Promise<T | null> {
  const fullKey = `${NS}:${key}`;
  if (kv) {
    try {
      const raw = await kv.get(fullKey);
      if (!raw) return null;
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (!isFresh(entry.computedAt, ttlMs)) return null;
      return entry.value;
    } catch (e: any) {
      logger.warn({ err: e?.message, key }, 'kv cache read failed');
      return null;
    }
  }
  const mem = memory.get(fullKey);
  if (!mem) return null;
  if (Date.now() - mem.computedAt >= ttlMs) return null;
  return mem.payload as T;
}

/** Write a value with a TTL. Keeps an extra GRACE window for stale fallback. */
export async function cacheSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const fullKey = `${NS}:${key}`;
  const computedAt = new Date().toISOString();
  const entry: CacheEntry<T> = { value, computedAt };
  if (kv) {
    try {
      await kv.put(fullKey, JSON.stringify(entry), { expirationTtl: Math.ceil((ttlMs + GRACE_MS) / 1000) });
    } catch (e: any) {
      logger.warn({ err: e?.message, key }, 'kv cache write failed');
    }
    return;
  }
  memory.set(fullKey, { payload: value, computedAt: Date.now() });
}

/** Explicitly invalidate a single cache key (call after underlying data changes). */
export async function cacheDel(key: string): Promise<void> {
  const fullKey = `${NS}:${key}`;
  if (kv) {
    try {
      await kv.delete(fullKey);
    } catch (e: any) {
      logger.warn({ err: e?.message, key }, 'kv cache delete failed');
    }
    return;
  }
  memory.delete(fullKey);
}

/** Invalidate every key under a prefix (e.g. `neodove:user_report:`) in one pass. */
export async function cacheDelPrefix(prefix: string): Promise<number> {
  const fullPrefix = `${NS}:${prefix}`;
  if (kv) {
    let deleted = 0;
    try {
      // KV list() pages in chunks of 1000; loop until exhausted.
      let cursor: string | undefined;
      do {
        const page = await kv.list({ prefix: fullPrefix, cursor });
        for (const k of page.keys) {
          await kv.delete(k.name);
          deleted++;
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return deleted;
    } catch (e: any) {
      logger.warn({ err: e?.message, prefix }, 'kv cache prefix delete failed');
      return deleted;
    }
  }
  let deleted = 0;
  for (const k of [...memory.keys()]) {
    if (k.startsWith(fullPrefix)) {
      memory.delete(k);
      deleted++;
    }
  }
  return deleted;
}

/**
 * Read-through cache helper. Every route that computes an expensive payload
 * should call `cached` — it serves fresh data, refreshes when stale, and falls
 * back to the stale copy when a refresh fails (never burns retries on D1).
 *
 * Single-flight: concurrent callers for the same key coalesce onto ONE compute
 * (in-memory promise map). When the TTL expires and several users hit at once,
 * only the first caller re-scans the DB; the rest await the same result. This
 * prevents cache stampedes on shared dashboards.
 */
const inFlight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key, ttlMs);
  if (hit !== null) return hit;

  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const job = (async (): Promise<T> => {
    try {
      const computed = await compute();
      await cacheSet(key, computed, ttlMs);
      return computed;
    } catch (e: any) {
      // Graceful degradation: serve stale (even past TTL) rather than error out.
      const stale = await readStale<T>(key);
      if (stale !== null) {
        logger.warn({ err: e?.message, key }, 'cache refresh failed — serving stale copy');
        return stale;
      }
      throw e;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, job);
  return job;
}

/** Read a cached value ignoring freshness (used only for stale-on-error). */
async function readStale<T>(key: string): Promise<T | null> {
  const fullKey = `${NS}:${key}`;
  if (kv) {
    try {
      const raw = await kv.get(fullKey);
      if (!raw) return null;
      const entry = JSON.parse(raw) as CacheEntry<T>;
      return entry.value;
    } catch {
      return null;
    }
  }
  return (memory.get(fullKey)?.payload as T) ?? null;
}