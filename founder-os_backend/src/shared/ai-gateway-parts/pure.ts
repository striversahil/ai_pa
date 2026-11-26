// Extracted verbatim from ai-gateway.ts by scripts/refactor/split-module.mjs.
// ai-gateway.ts re-exports everything public here, so existing imports keep working.
import { logger } from "../logger";
import type { ProviderConfig, AiKey, KeyHealth, MessageContent, ImagePart } from "./types";

export const GATEWAY_USAGE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const GATEWAY_USAGE_PREFIX = 'ai:usage:';

export function gatewayUsageKey(date = new Date()): string {
  return `${GATEWAY_USAGE_PREFIX}${date.toISOString().slice(0, 10)}`;
}

// Stable hash for AI cache keys (djb2)
export function hashAI(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ── Model fallback ───────────────────────────────────────────────────────────
// Advanced model first, safe model on hang: when the requested model stalls
// past the caller's timeoutMs (AbortError with no HTTP status), the gateway
// fails over to the mapped model for the rest of the call and records a
// cross-isolate KV flag (`ai:modeldown:<model>`, 10 min) so later calls skip
// the dead model outright instead of re-paying the timeout. One level only,
// generic across providers (add future pairs here).
export const FALLBACK_MODEL: Record<string, string> = {};

export const MODEL_DOWN_TTL_MS = 10 * 60_000;

export const OPENROUTER_TEXT_MODEL = 'inclusionai/ling-3.0-flash-sante:free';

export const OPENROUTER_VISION_MODEL = 'dots-studio/dots-3-note-preview:free';

/** Default OpenRouter routing for the paid lane: `order` (not `only`) so
 *  a throttled/outed first choice spills forward instead of failing. Lives
 *  on the provider entry so every paid-leg caller inherits it. */
export const PAID_CHAT_ROUTING = { provider: { order: ['streamlake/fp8', 'deepinfra/fp8'], allow_fallbacks: true } };

export const PROVIDERS: Record<string, ProviderConfig> = {
  groq: {
    id: 'groq',
    baseURL: 'https://api.groq.com/openai/v1/chat/completions',
    supportsReasoning: true,
    jsonMode: { type: 'json_object' },
    defaultModel: 'openai/gpt-oss-120b',
    visionModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
  },
  openrouter: {
    id: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1/chat/completions',
    supportsReasoning: false,
    reasoningObject: true,
    // NOTE: free-tier OpenRouter models reject response_format (no
    // structured-outputs) → jsonMode intentionally absent; JSON is enforced
    // via prompt + the extractJson fallback in completeJson instead.
    // Text + vision are SPLIT (2026-10-01): no single free model does both —
    // the old unified slug lost its free tier (404). Text → sante (lean,
    // proven 25/25 intake), vision (photos attached) → dots preview.
    // Reasoning models burn ~25KB chain-of-thought — callers must budget
    // maxTokens ≥24000, not 4000 (else finish=length truncation).
    defaultModel: OPENROUTER_TEXT_MODEL,
    visionModel: OPENROUTER_VISION_MODEL,
  },
  requestly: {
    id: 'requestly',
    baseURL: 'https://router.requesty.ai/v1/chat/completions',
    supportsReasoning: true,
    jsonMode: { type: 'json_object' },
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    visionModel: 'nvidia/nemotron-3-ultra-550b-a55b',
  },
  // Paid OpenRouter lane: same endpoint as `openrouter`, but keys come only
  // from OPENROUTER_PAID_API_KEY. defaultModel is deepseek/deepseek-v4.1-flash;
  // per-request `extraParams.provider` carries the streamlake/fp8 preference.
  'openrouter-paid': {
    id: 'openrouter-paid',
    baseURL: 'https://openrouter.ai/api/v1/chat/completions',
    supportsReasoning: true,
    reasoningObject: true,
    extraParams: PAID_CHAT_ROUTING,
    defaultModel: 'deepseek/deepseek-v4.1-flash',
    visionModel: 'dots-studio/dots-3-note-preview:free',
  },
};

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

// detectProvider: infer provider from key prefix when AI_KEYS entry omits explicit provider.
export function detectProvider(key: string): string {
  const k = key.trim();
  if (k.startsWith('gsk_')) return 'groq';
  if (k.startsWith('sk-or-') || k.startsWith('sk-or-v1-')) return 'openrouter';
  return 'openrouter';
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
  private omnirouteBaseURL = '';
  private strategy: AiStrategy = 'least-used-first';
  private rrCursor = 0;
  /** Provider-level switch (Setting providers[].enabled === false). A provider
   *  that is off contributes nothing to selection, but its keys stay registered
   *  so toggling it back on is instant and health history is preserved. */
  private providersOff = new Set<string>();

  setProviderEnabled(provider: string, enabled: boolean): void {
    const pid = String(provider ?? '').trim();
    if (!pid) return;
    if (enabled) this.providersOff.delete(pid);
    else this.providersOff.add(pid);
  }

  providerEnabled(provider: string): boolean {
    return !this.providersOff.has(provider);
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
    if (!PROVIDERS[pid]) {
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

  loadFromEnv(env: Record<string, unknown>): void {
    const raw = (v: unknown) => (typeof v === 'string' ? v : '');
    this.omnirouteBaseURL = raw(env.OMNIROUTE_BASE_URL).replace(/\/$/, '');
    if (this.omnirouteBaseURL && PROVIDERS.omniroute) {
      PROVIDERS.omniroute.baseURL = this.omnirouteBaseURL + '/chat/completions';
    }
    // Seed from existing keys: getGateway() re-configures on every call and
    // loadFromEnv appends, so without this the pool would duplicate on each
    // request (while preserving per-key health across reconfigures).
    const seen = new Set<string>(this.keys.map((k) => k.key));
    const PLACEHOLDER = /^(your[_-]?api[_-]?key.*|replace[_-]?.*|xxx+|placeholder.*|\*+)$/i;
    const add = (provider: string, key: string, label?: string) => {
      // Founder decision (2026-09-21): Groq keys are NEVER loaded — the models
      // hallucinate on our workflows. Dropping them here (single gate) covers
      // GROQ_API_KEYS, `groq:` AI_KEYS entries, and gsk_ auto-detect at once.
      // Callers that pinned provider 'groq' degrade via select()'s
      // empty-filter fallback to the remaining pool.
      if (provider === 'groq') return;
      const k = key.trim();
      if (!k || seen.has(k) || PLACEHOLDER.test(k)) return;
      seen.add(k);
      this.keys.push(this.makeKey(provider, k, label));
    };
    // 1. Unified AI_KEYS contract: "provider:key:label,..."
    const aiKeys = raw(env.AI_KEYS);
    if (aiKeys) {
      for (const entry of aiKeys.split(',')) {
        const parts = entry.split(':');
        if (parts.length >= 2) {
          const provider = parts[0].trim() || detectProvider(parts[1]);
          let key: string;
          let label: string | undefined;
          if (parts.length >= 3) {
            label = parts[parts.length - 1];
            key = parts.slice(1, parts.length - 1).join(':');
          } else {
            key = parts[1];
          }
          add(provider, key, label);
        }
      }
    }
    // 2. Legacy per-provider env vars (backwards compat).
    for (const key of raw(env.GROQ_API_KEYS).split(',')) add('groq', key);
    for (const key of raw(env.OPENROUTER_API_KEYS).split(',')) add('openrouter', key);
    for (const key of raw(env.OPENROUTER_API_KEY).split(',')) add('openrouter', key);
    // Paid lane: separate provider id so paid keys stay identifiable in health.
    for (const key of raw((env as any).OPENROUTER_PAID_API_KEY).split(',')) add('openrouter-paid', key, 'paid');
    for (const key of raw(env.REQUESTLY_API_KEY).split(',')) add('requestly', key);
    for (const key of raw((env as any).REQUESTLY_API_KEYS).split(',')) add('requestly', key);
    for (const key of raw(env.DEEPSEEK_API_KEYS).split(',')) add('deepseek', key);
    for (const key of raw(env.TOGETHER_API_KEYS).split(',')) add('together', key);
    for (const key of raw(env.OPENAI_API_KEYS).split(',')) add('openai', key);
    for (const key of raw(env.LLM_API_KEY).split(',')) add(detectProvider(key), key);
    // 3. Legacy omniroute (single key).
    const omniKey = raw(env.OMNIROUTE_API_KEY);
    if (omniKey && this.omnirouteBaseURL) add('omniroute', omniKey, 'omniroute');
    logger.info?.(`[AiGateway] loaded ${this.keys.length} keys: ${this.keys.map((k) => `${k.provider}:${k.label}`).join(', ')}`);
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
  select(provider?: string, sessionKey?: string): AiKey | null {
    const now = Date.now();
    let pool = this.keys.filter((k) => k.enabled && k.allowed && k.cooldownUntil <= now && this.providerEnabled(k.provider));
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

  extractStatus(err: unknown): number | null {    if (err && typeof err === 'object') {
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

export { extractJson, buildVisionUserContent } from "./text";
