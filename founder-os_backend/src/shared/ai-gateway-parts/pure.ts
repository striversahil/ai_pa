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
export const FALLBACK_MODEL: Record<string, string> = {
  'agnes-3.0-flash': 'agnes-2.5-flash',
};

export const MODEL_DOWN_TTL_MS = 10 * 60_000;

export const OPENROUTER_TEXT_MODEL = 'inclusionai/ling-3.0-flash-sante:free';

export const OPENROUTER_VISION_MODEL = 'dots-studio/dots-3-note-preview:free';

/** Default OpenRouter routing for the paid chat lane (founder-pinned):
 *  streamlake/fp8 first, deepinfra/fp8 second, OpenRouter reroute after that.
 *  `order` (not `only`) so a throttled/outed first choice spills forward
 *  instead of failing the turn. Lives on the provider entry so EVERY caller
 *  (chat, intake, extraction) inherits it; per-request `extraParams` still
 *  overrides. */
export const PAID_CHAT_ROUTING = { provider: { order: ['streamlake/fp8', 'deepinfra/fp8'], allow_fallbacks: true } };

export const PROVIDERS: Record<string, ProviderConfig> = {
  agnes: {
    id: 'agnes',
    baseURL: 'https://apihub.agnes-ai.com/v1/chat/completions',
    supportsReasoning: true,
    jsonMode: { type: 'json_object' },
    defaultModel: 'agnes-3.0-flash',
    visionModel: 'agnes-3.0-flash',
  },
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
  // Paid OpenRouter lane — PRIMARY for dashboard chat copilots (2026-10-06).
  // Same endpoint as `openrouter`, but keys come only from
  // OPENROUTER_PAID_API_KEY (chat pins provider 'openrouter-paid' so free-tier
  // keys can never serve a turn). defaultModel is the founder-pinned
  // deepseek/deepseek-v4.1-flash; per-request `extraParams.provider` carries
  // the streamlake/fp8 preference. GH relay lanes serve this provider as the
  // 1015/blockage fallback (relay routes /api/* paths to openrouter.ai).
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
  if (k.startsWith('sk-') && !k.startsWith('sk-or-')) {
    // Agnes keys are `sk-...` (checked 2026-09-20, e.g. sk-6SYPqZN...). OpenRouter uses `sk-or-`.
    // Without explicit `agnes:` prefix, treat generic `sk-` as Agnes primary.
    return 'agnes';
  }
  if (k.startsWith('sk-or-') || k.startsWith('sk-or-v1-')) return 'openrouter';
  return 'agnes'; // default primary is Agnes
}

// ── Key pool ─────────────────────────────────────────────────────────────────
export class KeyPool {
  private keys: AiKey[] = [];
  private omnirouteBaseURL = '';

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
    // 2. Legacy per-provider env vars (backwards compat) — Agnes primary.
    for (const key of raw((env as any).AGNES_API_KEY).split(',')) add('agnes', key);
    for (const key of raw((env as any).AGNES_API_KEYS).split(',')) add('agnes', key);
    for (const key of raw(env.GROQ_API_KEYS).split(',')) add('groq', key);
    for (const key of raw(env.OPENROUTER_API_KEYS).split(',')) add('openrouter', key);
    for (const key of raw(env.OPENROUTER_API_KEY).split(',')) add('openrouter', key);
    // Paid lane (chat primary): separate provider id so chat pins paid-only.
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

  private makeKey(provider: string, key: string, label?: string): AiKey {
    const fp = key.length > 12 ? `${key.slice(0, 6)}...${key.slice(-4)}` : '***';
    return {
      id: `${provider}:${fp}`, provider, key, label: label || fp,
      enabled: true, failures: 0, cooldownUntil: 0,
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
  select(provider?: string, sessionKey?: string, strictPin = false): AiKey | null {
    const now = Date.now();
    let pool = this.keys.filter((k) => k.enabled && k.cooldownUntil <= now);
    if (provider) {
      const filtered = pool.filter((k) => k.provider === provider);
      // Strict pin (intake): a pinned provider with zero healthy keys must
      // FAIL FAST, never silently roll a random cross-provider key — that
      // fallback served weak free-tier models as paid wins and persisted
      // names-only splits (Oct 2026). Default stays loose: pinned 'groq' and
      // chat/copilot callers degrade through the whole pool by design.
      if (strictPin && filtered.length === 0) return null;
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
      id: k.id, label: k.label, provider: k.provider, enabled: k.enabled,
      failures: k.failures, cooldownUntil: k.cooldownUntil, lastError: k.lastError,
      lastUsedAt: k.lastUsedAt, successCount: k.successCount,
    }));
  }

  /** Ms until the earliest cooling key frees up (0 when a key is usable now). */
  earliestCooldownMs(): number {
    const now = Date.now();
    let min = 0;
    for (const k of this.keys) {
      if (!k.enabled) continue;
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

// On-demand GH relay KV contract (runner.ts + cron.ts import these — keep in sync).
export const RELAY_ACTIVE_KEY = 'ai:relay:active';

export const RELAY_TTL_MS = 6 * 60 * 60_000;

export const RELAY_COOLDOWN_KEY = 'ai:relay:cooldown';

export const RELAY_COOLDOWN_MS = 30 * 60_000;

// Set when a 1015 arrives THROUGH the relay leg (Azure egress itself
// throttled) — cron replaces the run (new runner ≈ new IP). TTL bounds it.
export const RELAY_POISONED_KEY = 'ai:relay:poisoned';

export const RELAY_POISONED_TTL_MS = 30 * 60_000;

// Backup lane keys (second tunnel/runner — hot standby, independent lifecycle).
export const RELAY_ACTIVE_KEY_BAK = 'ai:relay:active:bak';

export const RELAY_POISONED_KEY_BAK = 'ai:relay:poisoned:bak';

export const RELAY_MEMO_MS = 60_000;

/** Extract the first JSON object/array from model prose (fenced block or
 *  balanced-brace scan). Returns null when nothing parses. */
export function extractJson(raw: string): unknown | null {
  const str = String(raw ?? '').trim();
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch { /* fall through */ }
  const fenced = str.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch { /* fall through */ }
  }
  let start = str.indexOf('{');
  if (start === -1) start = str.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(str.slice(start, i + 1));
        } catch { return null; }
      }
    }
  }
  return null;
}

/** Build a vision user message: text + image URLs (data-URI or https).
 *  Images beyond maxImages are dropped (caller should send thumbnails).
 *  Accepts raw URL strings or { url } objects. */
export function buildVisionUserContent(text: string, imageUrls: Array<string | { url?: unknown }>, maxImages = 4): MessageContent {  const imgs = (Array.isArray(imageUrls) ? imageUrls : [])
    .map((u) => (u != null && typeof u === 'object' ? (u as { url?: unknown }).url : u))
    .map((u) => String(u ?? '').trim())
    .filter((u) => u.length > 0 && (u.startsWith('data:image/') || u.startsWith('http')))
    .slice(0, Math.max(0, maxImages));
  if (imgs.length === 0) return text;
  return [
    { type: 'text', text },
    ...imgs.map((url): ImagePart => ({ type: 'image_url', image_url: { url } })),
  ];
}
