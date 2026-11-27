// Extracted verbatim from ai-gateway.ts by scripts/refactor/split-module.mjs.
// ai-gateway.ts re-exports everything public here, so existing imports keep working.
import { logger } from "../logger";
import { hashAI } from "./usage";
import type { ProviderConfig, AiKey, KeyHealth, MessageContent, ImagePart } from "./types";

// ── Model fallback ───────────────────────────────────────────────────────────
// Advanced model first, safe model on hang: when the requested model stalls
// past the caller's timeoutMs (AbortError with no HTTP status), the gateway
// fails over to the mapped model for the rest of the call and records a
// cross-isolate KV flag (`ai:modeldown:<model>`, 10 min) so later calls skip
// the dead model outright instead of re-paying the timeout. One level only,
// generic across providers (add future pairs here).
export const FALLBACK_MODEL: Record<string, string> = {};

export const MODEL_DOWN_TTL_MS = 10 * 60_000;

// Failover budgets (2026-11-27): each attempt is bounded so a dead key can
// never hang a request; overridable per request via CompletionRequest.
export const DEFAULT_TTFT_MS = 20_000;
export const DEFAULT_FIRST_BYTE_MS = 30_000;
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 60_000;
export const DEFAULT_STREAM_TIMEOUT_MS = 120_000;
export const MAX_ATTEMPTS = 6;
/** How long a provider is skipped after an HTTP 404/405 (dead model/route). */
export const PROVIDER_COOLDOWN_MS = 5 * 60_000;

// Provider registry is EMPTY by design (founder decision 2026-11-27):
// the ONLY source is Setting `ai:providers`. registerProvider() fills this
// from the root-managed Settings list; env vars and hardcoded defaults are
// ignored, so an unconfigured pool serves ZERO keys — never a built-in default.
export const PROVIDERS: Record<string, ProviderConfig> = {};

// ── Errors + provider detection ──────────────────────────────────────────────
export class AiGatewayError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly attempts?: number,
  ) {
    super(message);
    this.name = 'AiGatewayError';
  }
}

export type AiStrategy = 'least-used-first' | 'round-robin';

/** Stable public id for a stored key: provider + first6/last4. Used by the
 *  pool AND by the Settings telemetry (which never stores the raw secret),
 *  so a health row can always be matched back to its key. */
export function keyFingerprintId(provider: string, key: string): string {
  const fp = key.length > 12 ? `${key.slice(0, 6)}...${key.slice(-4)}` : '***';
  return `${provider}:${fp}`;
}

// ── Key pool ─────────────────────────────────────────────────────────────────
export class KeyPool {
  private keys: AiKey[] = [];
  private strategy: AiStrategy = 'least-used-first';
  private rrCursor = 0;
  /** Provider-level switch (Setting providers[].enabled === false). A provider
   *  that is off contributes nothing to selection, but its keys stay registered
   *  so toggling it back on is instant and health history is preserved. */
  private providersOff = new Set<string>();
  /** Runtime provider quarantine on 404/405 (dead model/route); not persisted. */
  private providersCooling = new Map<string, number>();

  setProviderEnabled(provider: string, enabled: boolean): void {
    const pid = String(provider ?? '').trim();
    if (!pid) return;
    if (enabled) { this.providersOff.delete(pid); this.providersCooling.delete(pid); }
    else this.providersOff.add(pid);
  }

  /** Skip a provider whose route/model is gone (404/405) for a short window. */
  coolProvider(provider: string, ms = PROVIDER_COOLDOWN_MS): void {
    const pid = String(provider ?? '').trim();
    if (!pid) return;
    const until = Date.now() + Math.max(1_000, ms);
    this.providersCooling.set(pid, Math.max(this.providersCooling.get(pid) ?? 0, until));
  }

  providerEnabled(provider: string): boolean {
    if (this.providersOff.has(provider)) return false;
    const until = this.providersCooling.get(provider) ?? 0;
    if (until && until <= Date.now()) { this.providersCooling.delete(provider); return true; }
    return until === 0;
  }

  /** Global selection strategy (Setting `ai:strategy`). */
  setStrategy(s: unknown): void {
    this.strategy = s === 'round-robin' ? 'round-robin' : 'least-used-first';
  }

  getStrategy(): AiStrategy { return this.strategy; }

  /** Register a Setting-defined OpenAI-compatible provider + its keys. */
  registerProvider(id: string, baseURL: string, model: string, keys: Array<{ key: string; label?: string; enabled?: boolean }>, enabled = true): void {
    const pid = String(id ?? '').trim();
    const url = String(baseURL ?? '').trim().replace(/\/+$/, '');
    if (!pid || !url) return;
    // The Setting is authoritative: an existing id (e.g. a provider that
    // used to be env-seeded) must pick up the operator's base URL/model.
    const cfg = PROVIDERS[pid];
    if (cfg) {
      cfg.baseURL = url + '/chat/completions';
      if (String(model || '').trim()) cfg.defaultModel = String(model).trim();
    } else {
      PROVIDERS[pid] = {
        id: pid,
        baseURL: url + '/chat/completions',
        supportsReasoning: false,
        reasoningObject: true,
        defaultModel: String(model || '').trim() || 'default',
      };
    }
    this.setProviderEnabled(pid, enabled !== false);
    const seen = new Map<string, AiKey>(this.keys.map((k) => [k.key, k]));
    for (const k of keys ?? []) {
      const kv = String((k as any)?.key ?? '').trim();
      if (!kv) continue;
      const allowed = (k as any)?.enabled !== false;
      const existing = seen.get(kv);
      if (existing) {
        // Re-registering the same key must NOT reset runtime health; only the
        // persisted operator switch is reconciled here.
        existing.allowed = allowed;
        continue;
      }
      const made = this.makeKey(pid, kv, String((k as any)?.label ?? '').trim() || undefined, allowed);
      seen.set(kv, made);
      this.keys.push(made);
    }
  }

  /** Drop keys that are no longer in Setting `ai:providers`, so a provider /
   *  key deleted in the root UI disappears even inside a warm isolate. Runtime
   *  health of surviving keys is preserved. */
  retainKeys(keep: Set<string>): void {
    this.keys = this.keys.filter((k) => keep.has(k.key));
  }

  private makeKey(provider: string, key: string, label?: string, allowed = true): AiKey {
    const id = keyFingerprintId(provider, key);
    return {
      id, provider, key, label: label || id.slice(provider.length + 1),
      enabled: true, allowed, failures: 0, cooldownUntil: 0,
      lastError: null, lastFailureAt: 0, lastUsedAt: 0, successCount: 0,
    };
  }

  /** Effective failures with time forgiveness: a key whose last error is
   *  >10 min old rejoins the healthy tier (transient 429s don't exile a key
   *  forever; repeat offenders stay out). */
  private effFailures(k: AiKey, now: number): number {
    if (k.failures > 0 && k.lastFailureAt > 0 && now - k.lastFailureAt > 10 * 60_000) return 0;
    return k.failures;
  }

  /** Pick a key for one attempt.
   *
   *  Generic rotation for every provider (current + future):
   *  - Only healthy keys compete (enabled + off cooldown), provider-filtered.
   *  - `sessionKey` set → consistent-hash pin: same conversation lands on the
   *    same key while it stays healthy (cache affinity; no mid-chat hopping).
   *    A cooled/failed pin drops out of the ring and traffic shifts to the
   *    next key automatically — stateless, so it holds across Worker isolates.
   *  - `sessionKey` absent → uniform random pick inside the least-failures
   *    tier: statistical load-spreading with zero cross-isolate coordination
   *    (per-isolate LRU alone would hammer key #0 on every cold start).
   */
  select(provider?: string, sessionKey?: string, ignoreCooldown = false): AiKey | null {
    const now = Date.now();
    let pool = this.keys.filter((k) => k.enabled && k.allowed && (ignoreCooldown || k.cooldownUntil <= now) && this.providerEnabled(k.provider));
    if (provider) {
      const filtered = pool.filter((k) => k.provider === provider);
      if (filtered.length > 0) pool = filtered;
    }
    if (pool.length === 0) return null;
    const minFailures = Math.min(...pool.map((k) => this.effFailures(k, now)));
    const tier = pool
      .filter((k) => this.effFailures(k, now) <= minFailures)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (sessionKey) {
      const start = parseInt(hashAI(`sess:${sessionKey}`), 36) % tier.length;
      return tier[start];
    }
    // Global strategy (Setting `ai:strategy`): round-robin cycles the healthy
    // tier evenly; least-used-first (default) spreads randomly inside the
    // least-failures tier (stateless load-spreading across isolates).
    if (this.strategy === 'round-robin') {
      const idx = this.rrCursor++ % tier.length;
      return tier[idx];
    }
    return tier.length === 1 ? tier[0] : tier[Math.floor(Math.random() * tier.length)];
  }

  reportSuccess(key: AiKey): void {
    key.failures = 0;
    key.lastUsedAt = Date.now();
    key.successCount++;
    key.lastError = null;
  }

  /**
   * Record a failure. Returns cooldown ms the caller may wait before reusing
   * this key (0 = rotate immediately).
   */
  reportFailure(key: AiKey, err: unknown, retryAfterMs?: number): number {
    key.failures++;
    key.lastFailureAt = Date.now();
    const msg = err instanceof Error ? err.message : String(err);
    key.lastError = msg.slice(0, 200);
    const status = this.extractStatus(err);
    if (status === 401 || status === 403) {
      key.enabled = false;
      logger.warn?.(`[AiGateway] key ${key.id} DISABLED (HTTP ${status}): ${key.lastError}`);
      return 0;
    }
    // 404/405 = the provider's model or route no longer exists. Rotating its
    // other keys is pointless (they share the route), so quarantine the whole
    // provider and let the caller fail over to the next API immediately.
    if (status === 404 || status === 405) {
      this.coolProvider(key.provider);
      logger.warn?.(`[AiGateway] provider ${key.provider} cooled after HTTP ${status} on ${key.id}: ${key.lastError}`);
      return 0;
    }
    if (status === 429) {
      const cd = retryAfterMs ?? Math.min(60_000 * Math.pow(2, Math.min(key.failures, 5)), 10 * 60_000);
      key.cooldownUntil = Date.now() + cd;
      logger.warn?.(`[AiGateway] key ${key.id} rate-limited, cooling ${Math.round(cd / 1000)}s`);
      return cd;
    }
    if (status === 402 || /quota|billing|insufficient|exceeded/i.test(msg)) {
      key.cooldownUntil = Date.now() + 5 * 60_000;
      return 5 * 60_000;
    }
    if (status && status >= 500) {
      key.cooldownUntil = Date.now() + 5_000;
      return 0;
    }
    if (/abort|timeout|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket/i.test(msg)) {
      key.cooldownUntil = Date.now() + 2_000;
      return 0;
    }
    return 0;
  }

  extractStatus(err: unknown): number | null {
    if (err && typeof err === 'object') {
      const e = err as any;
      if (typeof e.status === 'number') return e.status;
      if (typeof e.statusCode === 'number') return e.statusCode;
    }
    const m = String((err as any)?.message ?? err).match(/\b(\d{3})\b/);
    return m ? parseInt(m[1]) : null;
  }

  health(): KeyHealth[] {
    return this.keys.map((k) => ({
      id: k.id, label: k.label, provider: k.provider, enabled: k.enabled, allowed: k.allowed,
      failures: k.failures, cooldownUntil: k.cooldownUntil, lastError: k.lastError,
      lastUsedAt: k.lastUsedAt, successCount: k.successCount,
    }));
  }

  /** Ms until the earliest cooling key frees up (0 when a key is usable now). */
  earliestCooldownMs(): number {
    const now = Date.now();
    let min = 0;
    for (const k of this.keys) {
      if (!k.enabled || !k.allowed || !this.providerEnabled(k.provider)) continue;
      const wait = k.cooldownUntil - now;
      if (wait > 0 && (min === 0 || wait < min)) min = wait;
    }
    return min;
  }

  get size(): number {
    return this.keys.length;
  }
}

// ── Gateway ──────────────────────────────────────────────────────────────────
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export { GATEWAY_USAGE_TTL_MS, GATEWAY_USAGE_PREFIX, gatewayUsageKey, hashAI } from "./usage";
export { extractJson, buildVisionUserContent } from "./text";
