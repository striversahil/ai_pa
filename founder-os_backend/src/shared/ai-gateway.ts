/**
 * Unified multi-provider AI gateway — the SINGLE module every AI call in the
 * system routes through. **Agnes (apihub.agnes-ai.com) is primary** — Dahl
 * and Groq remain as fallbacks. Every key in the pool is provider-tagged;
 * the gateway handles least-failures selection, 429 cooldown (honors
 * retry-after), 401/403 disable, 5xx rotate. Primary model agnes-3.0-flash
 * (2.5-flash is the automatic fallback if the 3.0 channel hangs).
 *
 * Key configuration (single source of truth, both runtimes):
 *   env.AI_KEYS         = "provider:key:label,..."  (e.g. "agnes:sk-...:primary, groq:gsk_...:fallback")
 *   env.AGNES_API_KEY   = single Agnes key (sk-...)
 *   env.AGNES_API_KEYS  = comma-separated Agnes keys
 *   env.GROQ_API_KEYS   = IGNORED (founder decision 2026-09-21: hallucination quality)
 *   env.OMNIROUTE_*     = IGNORED
 * Egress-relay proxy (optional, Agnes only — see home-egress/ + agnes-relay*.yml):
 *   env.AGNES_PROXY_URL = STATIC named-tunnel hostname of the relay (unset = direct egress)
 *   env.AGNES_PROXY_SECRET = shared secret the proxy requires per call
 *   env.AGNES_PROXY_URL_BAK / _SECRET_BAK = hot-standby second lane (agnes-relay-bak)
 *     — per-attempt failover primary→bak in seconds; per-lane poison replace.
 *   env.AGNES_PROXY_TIMEOUT_MS = proxy attempt cap, default 25000 (max 60000)
 *   env.AGNES_PROXY_ALWAYS = '1' for an always-on home/GCP lane (default: on-demand
 *     GH relay, used only while KV ai:relay:active[:bak] is fresh — see RELAY_* below)
 *
 * Agnes uses `chat_template_kwargs: {enable_thinking:true}` for reasoning
 * (mapped from `reasoningEffort`), base https://apihub.agnes-ai.com/v1.
 * Dahl/OpenRouter legacy: keep keys in pool but not primary.
 *
 * Runtime note: edge-safe (no Node-only deps) so it bundles into the
 * Worker via build-worker.mjs. GH Actions consume JS port scripts/ai-gateway.js
 * that mirrors this surface. Both read same AI_KEYS contract.
 */
import { logger } from './logger';
import { cacheGet, cacheSet } from './cache';

// Stable hash for AI cache keys (djb2)
function hashAI(s: string): string {
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
const FALLBACK_MODEL: Record<string, string> = {
  'agnes-3.0-flash': 'agnes-2.5-flash',
};
const MODEL_DOWN_TTL_MS = 10 * 60_000;

async function modelFlagged(model: string): Promise<boolean> {
  try {
    return !!(await cacheGet(`ai:modeldown:${model}`, MODEL_DOWN_TTL_MS));
  } catch {
    return false;
  }
}

async function flagModelDown(model: string): Promise<void> {
  try {
    await cacheSet(`ai:modeldown:${model}`, { at: Date.now() }, MODEL_DOWN_TTL_MS);
  } catch { /* best-effort */ }
}

// ── Provider registry ────────────────────────────────────────────────────────
export interface ProviderConfig {
  id: string;
  baseURL: string;
  extraParams?: Record<string, unknown>;
  supportsReasoning: boolean;
  /** OpenRouter-style reasoning switch (`reasoning: { enabled: true }`). */
  reasoningObject?: boolean;
  jsonMode?: { type: 'json_object' };
  defaultModel: string;
  /** Used when a request carries image parts and no explicit model is set. */
  visionModel?: string;
}

const OPENROUTER_VISION_MODEL = 'inclusionai/ling-3.0-flash-vl:free';

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
    // NOTE: ling-3.0-flash-vl rejects response_format (no structured-outputs)
    // → jsonMode intentionally absent; JSON is enforced via prompt + the
    // extractJson fallback in completeJson instead.
    // Text + vision in one model — the enquiry pipeline default.
    defaultModel: OPENROUTER_VISION_MODEL,
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
function detectProvider(key: string): string {
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

// ── Key identity + health ────────────────────────────────────────────────────
export interface AiKey {
  id: string;
  provider: string;
  key: string;
  label: string;
  enabled: boolean;
  failures: number;
  cooldownUntil: number;
  lastError: string | null;
  lastFailureAt: number;
  lastUsedAt: number;
  successCount: number;
}

export type KeyHealth = Pick<
  AiKey,
  'id' | 'label' | 'provider' | 'enabled' | 'failures' | 'cooldownUntil' | 'lastError' | 'lastUsedAt' | 'successCount'
>;

// ── Request / response ───────────────────────────────────────────────────────
export interface TextPart { type: 'text'; text: string }
export interface ImagePart { type: 'image_url'; image_url: { url: string } }
export type MessageContent = string | Array<TextPart | ImagePart>;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent;
  /** Tool-result linkage (agentic loops). Passed through verbatim. */
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  provider?: string;
  keyId?: string;
  /**
   * Conversation affinity (e.g. `enquiry:chat:<id>:<user>`). When set, the
   * gateway pins this request stream to ONE key via consistent hashing, so
   * provider-side prefix-cache / Cloudflare AI Gateway cache affinity is
   * preserved across turns — keys are NOT rotated mid-conversation while the
   * pinned key stays healthy. On 429/5xx the pinned key cools and the ring
   * probe transparently fails over to the next key. Omit for one-shot calls
   * (extraction, runners): those spread randomly across the healthiest tier.
   * Generic — works for every current and future provider in PROVIDERS.
   */
  sessionKey?: string;
  /** Optional per-attempt wall-clock cap (ms). Hung attempts abort fast so
   *  rotation moves on; callers with a UI budget (copilot) set this, batch
   *  runners leave it unset (current unbounded behavior). */
  timeoutMs?: number;
  /** Probe cap for the pre-fallback primary model only (ms). Lets callers
   *  sample an advanced-but-flaky model cheaply: the FIRST attempt(s) on the
   *  requested model abort fast, while post-fallback attempts use timeoutMs.
   *  E.g. { model: 'agnes-3.0-flash', probeTimeoutMs: 8000, timeoutMs: 20000 }
   *  tests 3.0 for 8s, then serves from 2.5 with a 20s budget. */
  probeTimeoutMs?: number;
  json?: boolean;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
  /** OpenAI-style function tools (passed through verbatim). */
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

export interface CompletionResult {
  content: string;
  provider: string;
  keyId: string;
  model: string;
  jsonParsed: boolean;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  toolCalls?: ToolCall[];
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
  select(provider?: string, sessionKey?: string): AiKey | null {
    const now = Date.now();
    let pool = this.keys.filter((k) => k.enabled && k.cooldownUntil <= now);
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
const RELAY_MEMO_MS = 60_000;

/** One egress lane: its own tunnel URL, secret, KV lifecycle flag, and
 *  health state. Primary + backup run as independent GH runs so a poisoned
 *  lane is replaceable without touching the other. */
export interface ProxyLane {
  name: string;
  url: string;
  secret: string;
  activeKey: string;
  poisonedKey: string;
  failStreak: number;
  skipUntil: number;
  memoVal: boolean;
  memoUntil: number;
}

export class AiGateway {
  private pool = new KeyPool();
  private visionModelOverride = '';
  /** Rotating OpenRouter free-model list (OPENROUTER_FREE_MODELS). Text
   *  requests cycle through these as 429s persist; vision stays pinned. */
  private openrouterModels: string[] = [OPENROUTER_VISION_MODEL];
  private modelIdx = 0;
  // Cloudflare AI Gateway (standardized): when CLOUDFLARE_ACCOUNT_ID + CF_AIG_GATEWAY_ID are set,
  // all providers route via https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/...
  // as reverse proxy with caching/rate-limiting/logging. Custom providers (agnes, openrouter) use `custom-{slug}`.
  private aigAccount = '';
  private aigGateway = '';
  // Egress-relay proxy (Agnes only — the 1015-throttled provider).
  // AGNES_PROXY_URL points at the relay's STATIC named-tunnel hostname
  // (e.g. https://egress-gh.apotza.com). Two lanes share this slot:
  //  - on-demand GH relay: used ONLY while KV `ai:relay:active` is fresh
  //    (the relay run registers itself via POST /api/runner/relay/register
  //    and heartbeats; TTL ~6h bounds cost when a run dies). Flag absent →
  //    direct egress only, zero overhead.
  //  - always-on home/GCP lane: set AGNES_PROXY_ALWAYS=1 to skip the gate.
  // Proxy faults (unreachable/timeout/tunnel-down 502) fall through to
  // direct with zero pool penalty. A proxy 429 is a REAL upstream answer.
  // Proxied calls intentionally bypass the CF AI Gateway (same shared-egress
  // fate). Runners (scripts/ai-gateway.js) don't read these vars — GitHub
  // egress is clean.
  private lanes: ProxyLane[] = [];
  // Proxy attempt cap: high enough for legit reasoning responses (they take
  // 6–15s), low enough to bound a dead tunnel. A down PC fails FAST anyway
  // (refused/DNS, milliseconds) — this cap only binds genuine stalls.
  private proxyTimeoutMs = 25000;
  // Flaky-PC guard (per isolate): after 3 consecutive proxy faults, skip the
  // proxy for 60s instead of paying the timeout on every attempt. Success
  // resets the streak. (Cross-isolate learning would need KV — the timeout
  // cap already bounds the worst case, so local memory suffices.)
  // Always-on lane escape hatch (home PC / GCP VM): skip the relay gate.
  private proxyAlways = false;

  constructor(env?: Record<string, unknown>) {
    if (env) this.configure(env);
  }

  configure(env: Record<string, unknown>): void {
    this.pool.loadFromEnv(env);
    const v = String((env as any)?.VISION_MODEL ?? '').trim();
    if (v) this.visionModelOverride = v;
    const aigAcc = String((env as any)?.CLOUDFLARE_ACCOUNT_ID ?? (env as any)?.CF_AIG_ACCOUNT_ID ?? '').trim();
    const aigId = String((env as any)?.CF_AIG_GATEWAY_ID ?? (env as any)?.AI_GATEWAY_ID ?? 'founder-os').trim();
    if (aigAcc) { this.aigAccount = aigAcc; this.aigGateway = aigId; }
    const mkLane = (
      name: string, urlRaw: unknown, secRaw: unknown, activeKey: string, poisonedKey: string,
    ): ProxyLane | null => {
      const url = String(urlRaw ?? '').trim().replace(/\/+$/, '');
      const secret = String(secRaw ?? '').trim();
      if (!url || !secret) return null;
      const prev = this.lanes.find((l) => l.name === name);
      return {
        name, url, secret, activeKey, poisonedKey,
        failStreak: prev?.failStreak ?? 0,
        skipUntil: prev?.skipUntil ?? 0,
        memoVal: prev?.memoVal ?? false,
        memoUntil: prev?.memoUntil ?? 0,
      };
    };
    // Rebuilt per configure() but health/memo survive via prev-carry above
    // (getGateway re-configures on every call; without this, streaks reset).
    this.lanes = [
      mkLane('primary', (env as any)?.AGNES_PROXY_URL, (env as any)?.AGNES_PROXY_SECRET, RELAY_ACTIVE_KEY, RELAY_POISONED_KEY),
      mkLane('bak', (env as any)?.AGNES_PROXY_URL_BAK, (env as any)?.AGNES_PROXY_SECRET_BAK ?? (env as any)?.AGNES_PROXY_SECRET, RELAY_ACTIVE_KEY_BAK, RELAY_POISONED_KEY_BAK),
    ].filter((l): l is ProxyLane => l !== null);
    this.proxyAlways = String((env as any)?.AGNES_PROXY_ALWAYS ?? '').trim() === '1';
    const pTo = Number(String((env as any)?.AGNES_PROXY_TIMEOUT_MS ?? '').trim());
    if (Number.isFinite(pTo) && pTo > 0) this.proxyTimeoutMs = Math.min(pTo, 60_000);
    const models = String((env as any)?.OPENROUTER_FREE_MODELS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (models.length > 0) this.openrouterModels = [...new Set(models)];
  }

  get keyCount(): number {
    return this.pool.size;
  }

  health(): KeyHealth[] {
    return this.pool.health();
  }

  /** Lane configured for this provider? (Agnes only — the throttled one.)
   *  Sync gate: URL + secret present and off the skip-ladder. */
  private laneEnabled(lane: ProxyLane, provider: ProviderConfig): boolean {
    return provider.id === 'agnes' && !!lane.url && !!lane.secret && Date.now() >= lane.skipUntil;
  }

  /** Lane's relay run live? Memoized 60s per isolate per lane (KV, not per call). */
  private async isLaneActive(lane: ProxyLane): Promise<boolean> {
    const now = Date.now();
    if (now < lane.memoUntil) return lane.memoVal;
    let active = false;
    try {
      active = !!(await cacheGet(lane.activeKey, RELAY_TTL_MS));
    } catch { active = false; }
    lane.memoVal = active;
    lane.memoUntil = now + RELAY_MEMO_MS;
    return active;
  }

  /** Lanes usable for this attempt, primary first. Always-on mode skips the
   *  relay gate; otherwise each lane's run must have registered itself. */
  private async usableLanes(provider: ProviderConfig): Promise<ProxyLane[]> {
    const out: ProxyLane[] = [];
    for (const lane of this.lanes) {
      if (!this.laneEnabled(lane, provider)) continue;
      if (this.proxyAlways || (await this.isLaneActive(lane))) out.push(lane);
    }
    return out;
  }

  private laneSucceeded(lane: ProxyLane): void {
    lane.failStreak = 0;
    lane.skipUntil = 0;
  }

  private laneFaulted(lane: ProxyLane): void {
    lane.failStreak++;
    if (lane.failStreak >= 3) lane.skipUntil = Date.now() + 60_000;
  }

  /** Debug: worker→proxy leg health per lane. Hostnames only — never secrets. */
  async proxyStatus(): Promise<{ ok: true; alwaysOn: boolean; lanes: Array<{ name: string; configured: boolean; host: string | null; relayActive: boolean; skipActive: boolean; failStreak: number; reachable: boolean; ms: number; body?: string; error?: string }> }> {
    type LaneStatus = { name: string; configured: boolean; host: string | null; relayActive: boolean; skipActive: boolean; failStreak: number; reachable: boolean; ms: number; body?: string; error?: string };
    const lanes: LaneStatus[] = [];
    for (const lane of this.lanes) {
      let host: string | null = null;
      try { host = new URL(lane.url).host; } catch { /* unset */ }
      let relayActive = false;
      try { relayActive = await this.isLaneActive(lane); } catch { /* ignore */ }
      const base = {
        name: lane.name, configured: !!lane.url && !!lane.secret, host, relayActive,
        skipActive: Date.now() < lane.skipUntil, failStreak: lane.failStreak,
      };
      if (!lane.url) {
        lanes.push({ ...base, reachable: false, ms: 0, error: 'unset' });
        continue;
      }
      const start = Date.now();
      try {
        const r = await fetch(lane.url.replace(/\/+$/, '') + '/health', { signal: AbortSignal.timeout(15000) });
        const text = await r.text().catch(() => '');
        lanes.push({ ...base, reachable: r.ok, ms: Date.now() - start, body: text.slice(0, 200), ...(!r.ok ? { error: `HTTP ${r.status}` } : {}) });
      } catch (e: any) {
        lanes.push({ ...base, reachable: false, ms: Date.now() - start, error: String(e?.message ?? e).slice(0, 200) });
      }
    }
    return { ok: true as const, alwaysOn: this.proxyAlways, lanes };
  }

  /**
   * One attempt through the home proxy. Resolves with the upstream response
   * (status passed through verbatim, INCLUDING 429s — those are real key
   * signals). Rejects ONLY when the proxy/host itself is at fault (down,
   * timeout, proxy 502) so the caller falls through to direct egress
   * without touching pool health.
   */
  private async fetchViaProxy(lane: ProxyLane, path: string, body: string, headers: Record<string, string>, signal: AbortSignal | undefined, timeoutMs?: number): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(lane.url + path, {
        method: 'POST',
        headers: { ...headers, 'x-proxy-secret': lane.secret },
        body,
        signal: this.combineSignals(signal, timeoutMs ?? this.proxyTimeoutMs),
      });
    } catch (e) {
      this.laneFaulted(lane);
      const fault: any = new Error(`proxy ${lane.name} unreachable: ${e instanceof Error ? e.message : String(e)}`);
      fault.proxyFault = true;
      throw fault;
    }
    if (res.status === 502 && res.headers.get('x-proxy-error') === '1') {
      try { await res.text().catch(() => ''); } catch {}
      this.laneFaulted(lane);
      const fault: any = new Error(`proxy ${lane.name} upstream failure`);
      fault.proxyFault = true;
      throw fault;
    }
    // Dead named tunnel (no relay run alive): Cloudflare edge answers
    // 502/503/530 with an HTML "Bad Gateway / tunnel" page. That is OUR
    // lane being down, not an Agnes answer — fall through to direct WITHOUT
    // penalising the AI key (a genuine Agnes 502/503 carries a JSON body and
    // still passes through as an upstream answer below).
    if ((res.status === 502 || res.status === 503 || res.status === 530) && (await this.looksLikeTunnelDown(res))) {
      this.laneFaulted(lane);
      const fault: any = new Error(`proxy ${lane.name} tunnel down (HTTP ${res.status})`);
      fault.proxyFault = true;
      throw fault;
    }
    this.laneSucceeded(lane);
    return res;
  }

  /** Upstream answered 1015 THROUGH the relay (Azure egress itself is now
   *  throttled — genuinely new information). Flag it so cron replaces the run
   *  (new runner ≈ new IP). Best-effort; the 429 itself still flows to the
   *  caller for normal key rotation. Reads a clone; original stays consumable. */
  private async flagRelayPoisoned(lane: ProxyLane, res: Response): Promise<void> {
    try {
      if (res.status === 429 && (await this.isIpThrottle(res))) {
        await cacheSet(lane.poisonedKey, { at: Date.now(), lane: lane.name }, RELAY_POISONED_TTL_MS);
        logger.warn?.(`[AiGateway] 1015 arrived via relay lane ${lane.name} — flagging run poisoned`);
      }
    } catch { /* best-effort */ }
  }

  /** True when a proxy-leg 5xx looks like a dead-tunnel edge page (HTML /
   *  Bad Gateway / tunnel / 1033 markers) rather than an Agnes JSON answer.
   *  Reads a clone so the original response stays consumable. */
  private async looksLikeTunnelDown(res: Response): Promise<boolean> {
    try {
      const ct = res.headers.get('content-type') || '';
      const head = (await res.clone().text()).slice(0, 500);
      return /text\/html/.test(ct) || /cloudflare|bad gateway|tunnel|1033|error code/i.test(head);
    } catch {
      return false;
    }
  }

  /** True when a 429 body carries Cloudflare's 1015 edge-throttle signature
   *  (IP-level block, not per-key quota). Reads a clone so the original
   *  response stays consumable. */
  private async isIpThrottle(res: Response): Promise<boolean> {
    try {
      const text = await res.clone().text();
      return /1015|error code:\s*1015/i.test(text);
    } catch {
      return false;
    }
  }

  private gatewayBaseURL(provider: ProviderConfig): string {
    if (this.aigAccount && this.aigGateway) {
      // Standardized Cloudflare AI Gateway reverse proxy (custom providers use custom-{slug})
      if (provider.id === 'agnes') return `https://gateway.ai.cloudflare.com/v1/${this.aigAccount}/${this.aigGateway}/custom-agnes/v1/chat/completions`;
      if (provider.id === 'openrouter') return `https://gateway.ai.cloudflare.com/v1/${this.aigAccount}/${this.aigGateway}/custom-openrouter/api/v1/chat/completions`;
      if (provider.id === 'groq') return `https://gateway.ai.cloudflare.com/v1/${this.aigAccount}/${this.aigGateway}/groq/chat/completions`;
      if (provider.id === 'requestly') return provider.baseURL; // not via gateway
    }
    return provider.baseURL;
  }

  /**
   * Core completion call. Picks a key, calls the provider, rotates + retries on
   * transient/provider errors (bounded by maxAttempts — one fresh key per
   * attempt, so N keys ≈ N chances). Plain Agnes 429s cool that key and rotate
   * to the next; Cloudflare 1015 fails fast (egress-IP based — rotating keys
   * can't help). Sticky `sessionKey` requests stay pinned while healthy.
   * Throws AiGatewayError only when every attempt is exhausted.
   *
   * Cloudflare AI Gateway note: rotation only swaps the `Authorization: Bearer`
   * header value. URLs (incl. `custom-*` gateway paths), bodies, and models are
   * untouched, so CF-side caching / logging / rate-limiting see zero change —
   * and CF cache keys (method+URL+body) are unaffected by Bearer rotation.
   */
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    // Auto-route Agnes models to Agnes provider when no explicit provider is set.
    if (!req.provider && req.model && req.model.startsWith('agnes-')) {
      req = { ...req, provider: 'agnes' };
    }
    // Standardized app-wide: KV response cache (5m) + single-flight + fail-fast 429.
    // Caches identical prompts (enquiry extraction re-tries, duplicate saves) to cut RPM without extra keys.
    const cacheable = !req.signal?.aborted && (req.json || false) && !req.tools?.length;
    // Only cache deterministic JSON extractions (enrichment/vision) — chat (tools/stream) bypasses.
    let aiCacheKey: string | null = null;
    if (cacheable) {
      try {
        const prov = req.provider || (req.model?.startsWith('agnes-') ? 'agnes' : 'agnes');
        const model = req.model || PROVIDERS[prov]?.defaultModel || 'agnes-3.0-flash';
        const keyRaw = JSON.stringify({ prov, model, messages: req.messages, temperature: req.temperature ?? 0.2, json: !!req.json });
        aiCacheKey = `ai:resp:${hashAI(keyRaw)}`;
        const hit = await cacheGet<CompletionResult>(aiCacheKey, 5 * 60 * 1000);
        if (hit) { logger.info?.(`[AiGateway] cache hit ${aiCacheKey.slice(0, 24)}`); return hit; }
      } catch {}
    }
    // Standardized: fail fast, respect retry-after, no 50× hammer.
    // Heavy app will queue at caller, not in gateway. 3 attempts max.
    const MIN_ATTEMPTS = 3;
    const maxAttempts = Math.max(MIN_ATTEMPTS, Math.min(this.pool.size || MIN_ATTEMPTS, 5));
    const wantsVision = req.messages.some((m) => Array.isArray(m.content));
    // Model rotation (OpenRouter text requests only): every ROTATE_EVERY
    // consecutive 429s moves to the next OPENROUTER_FREE_MODELS entry,
    // spreading quota. Explicit req.model, vision requests, and non-OpenRouter
    // providers never rotate.
    const ROTATE_EVERY = 5;
    let streak429 = 0;
    let rotatedModel: string | undefined;
    let lastErr: unknown;
    // Model fallback state: an explicitly requested model with a recorded
    // outage starts on its fallback immediately; a mid-call hang switches
    // over once (flagged for 10 min so later calls skip the probe).
    let activeModel: string | undefined = req.model;
    let fellBack = false;
    if (activeModel && FALLBACK_MODEL[activeModel] && (await modelFlagged(activeModel))) {
      logger.warn?.(`[AiGateway] ${activeModel} flagged down — starting on ${FALLBACK_MODEL[activeModel]}`);
      activeModel = FALLBACK_MODEL[activeModel];
      fellBack = true;
    }
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const key = req.keyId
        ? this.findKey(req.keyId) ?? this.pool.select(req.provider, req.sessionKey)
        : this.pool.select(req.provider, req.sessionKey);
      if (!key) {
        const waitMs = this.pool.earliestCooldownMs();
        const retryAfter = waitMs > 0 ? Math.min(waitMs, 60_000) : 60_000;
        const e: any = new Error(`HTTP 429: Rate-limited (retry after ${Math.round(retryAfter/1000)}s)`);
        e.status = 429; e.retryAfter = retryAfter;
        throw e;
      }
      const provider = PROVIDERS[key.provider] ?? PROVIDERS.groq;
      try {
        const modelOverride = activeModel && activeModel !== req.model ? activeModel : rotatedModel;
        const callReq = { ...req };
        if (modelOverride) callReq.model = modelOverride;
        // Cheap probe: pre-fallback attempts on a flaky primary model get
        // probeTimeoutMs; everything after fallback uses timeoutMs.
        const probing = !fellBack && req.model && FALLBACK_MODEL[req.model] && req.probeTimeoutMs;
        if (probing) callReq.timeoutMs = req.probeTimeoutMs;
        const result = await this.callProvider(provider, key, callReq);
        this.pool.reportSuccess(key);
        if (aiCacheKey) {
          try { await cacheSet(aiCacheKey, result, 5 * 60 * 1000); } catch {}
        }
        return result;
      } catch (err) {
        lastErr = err;
        // Hung model channel (timeout, no HTTP status — proxy faults and
        // caller cancels excluded): record the outage, switch to the
        // fallback model, retry immediately. Keys are never rotated for a
        // hang — every key would hang identically on a dead channel.
        const timedOut = (err as any)?.name === 'TimeoutError' || /timeout/i.test(String((err as any)?.message ?? ''));
        const abortHang = !(err as any)?.proxyFault && timedOut;
        if (abortHang && req.model && FALLBACK_MODEL[req.model] && !fellBack) {
          fellBack = true;
          await flagModelDown(req.model);
          logger.warn?.(`[AiGateway] ${req.model} hung — failing over to ${FALLBACK_MODEL[req.model]}`);
          activeModel = FALLBACK_MODEL[req.model];
          continue;
        }
        const status = this.pool.extractStatus(err);
        if (status === 429) {
          if (provider.id === 'agnes') {
            const msg = String((err as any)?.message ?? '');
            const isCf1015 = /1015|error code: 1015/i.test(msg);
            const retryAfter = this.extractRetryAfter(err);
            if (isCf1015) {
              // IP-level throttle, NOT key quota: cool briefly and ROTATE —
              // the next key's direct call may land outside the throttle
              // window, and every attempt also gets its proxy shot inside
              // callProvider. Only the final attempt throws, preserving
              // chat's busy-signal when truly everything is throttled.
              const rawCd = retryAfter ?? 72_000;
              const cd = Math.min(rawCd, 60_000);
              key.cooldownUntil = Date.now() + cd;
              key.failures++;
              key.lastFailureAt = Date.now();
              key.lastError = `429 Cloudflare 1015`;
              logger.warn?.(`[AiGateway] 429 Cloudflare 1015 on ${key.id} — cooling ${Math.round(cd/1000)}s (raw ${Math.round(rawCd/1000)}s), rotating to next key (attempt ${attempt + 1}/${maxAttempts})`);
              if (attempt >= maxAttempts - 1) {
                const e: any = new Error(`HTTP 429: Rate-limited (Cloudflare 1015, retry after ${Math.round(cd/1000)}s)`);
                e.status = 429; e.retryAfter = cd; throw e;
              }
              continue;
            }
            // Plain Agnes 429 is per-key quota: cool THIS key and rotate to
            // the next one in the pool (bounded by maxAttempts). The next
            // select() skips the cooling key, so a sticky sessionKey
            // transparently fails over mid-conversation only when it must.
            // Cooldown escalates while the key keeps failing (60s → 120s →
            // 240s → 480s, capped 10 min) so chronic-429 keys stop burning
            // seconds on every rejoin; one success resets the ladder.
            const rawCd = retryAfter ?? 60_000;
            key.failures++;
            key.lastFailureAt = Date.now();
            const cd = Math.min(rawCd, 60_000 * Math.pow(2, Math.min(key.failures - 1, 3)), 600_000);
            key.cooldownUntil = Date.now() + cd;
            key.lastError = `429 rate-limited`;
            logger.warn?.(`[AiGateway] 429 on ${key.id} (agnes) — cooling ${Math.round(cd/1000)}s, rotating to next key (attempt ${attempt + 1}/${maxAttempts})`);
            continue;
          }
          // Immediate retry path: burst limits wave off — short sleep, reuse
          // the key at once (no long cooldown), keep counting attempts.
          streak429++;
          if (
            !req.model && !wantsVision && provider.id === 'openrouter' &&
            this.openrouterModels.length > 1 && streak429 % ROTATE_EVERY === 0
          ) {
            this.modelIdx = (this.modelIdx + 1) % this.openrouterModels.length;
            rotatedModel = this.openrouterModels[this.modelIdx];
            logger.warn?.(`[AiGateway] 429 streak x${streak429} — rotating OpenRouter model to ${rotatedModel}`);
          }
          const retryAfter = this.extractRetryAfter(err);
          key.failures++;
          key.lastFailureAt = Date.now();
          key.cooldownUntil = 0;
          key.lastError = `429 retry ${attempt + 1}/${maxAttempts}${rotatedModel ? ` (${rotatedModel})` : ''}`;
          // Standardized backoff: 0.8s, 1.6s, 3.2s cap 5s — max 3 attempts total, then fail fast.
          if (attempt < maxAttempts - 1) {
            const backoff = Math.min(retryAfter ?? 800 * Math.pow(2, attempt), 5_000);
            logger.warn?.(`[AiGateway] 429 on ${key.id}, retry ${attempt + 1}/${maxAttempts} after ${backoff}ms`);
            await sleep(backoff);
            continue;
          }
          const e2: any = new Error(`HTTP 429: Rate-limited (retry after ${Math.round((retryAfter ?? 60_000)/1000)}s)`);
          e2.status = 429; e2.retryAfter = retryAfter ?? 60_000;
          throw e2;
        }
        const retryAfter = this.extractRetryAfter(err);
        const cooldown = this.pool.reportFailure(key, err, retryAfter);
        logger.warn?.(`[AiGateway] attempt ${attempt + 1}/${maxAttempts} failed on ${key.id}: ${err instanceof Error ? err.message : String(err)}`);
        if (cooldown > 0 && attempt < maxAttempts - 1) {
          await sleep(Math.min(cooldown, 5_000));
        }
      }
    }
    throw new AiGatewayError(`All AI keys exhausted after ${maxAttempts} attempts`, lastErr, maxAttempts);
  }

  /** Streaming: yields content/reasoning/tool deltas via SSE (OpenAI `stream:true`). */
  async *stream(req: CompletionRequest): AsyncGenerator<{ contentDelta?: string; reasoningDelta?: string; toolCallDelta?: any[]; finishReason?: string; usage?: any }, void, unknown> {
    if (!req.provider && req.model && req.model.startsWith('agnes-')) {
      req = { ...req, provider: 'agnes' };
    }
    // Skip a flagged-down model outright (mirrors complete()'s entry check
    // — most turns never pay the probe).
    const requestedFlaky = req.model && FALLBACK_MODEL[req.model] ? req.model : null;
    if (requestedFlaky && (await modelFlagged(requestedFlaky))) {
      logger.warn?.(`[AiGateway] stream: ${requestedFlaky} flagged down — starting on ${FALLBACK_MODEL[requestedFlaky]}`);
      req = { ...req, model: FALLBACK_MODEL[requestedFlaky] };
    }
    // Unflagged flaky model: probe cheaply (probeTimeoutMs), flagged/fine
    // models get the full timeoutMs so thinking steps aren't strangled.
    const probing = !!requestedFlaky && req.model === requestedFlaky && !!req.probeTimeoutMs;
    const streamCap = probing ? req.probeTimeoutMs : req.timeoutMs;
    const key = req.keyId ? this.findKey(req.keyId) ?? this.pool.select(req.provider, req.sessionKey) : this.pool.select(req.provider, req.sessionKey);
    if (!key) throw new AiGatewayError('No AI key available (pool empty or all disabled)');
    const provider = PROVIDERS[key.provider] ?? PROVIDERS.groq;
    const wantsVision = req.messages.some((m) => Array.isArray(m.content));
    const model = req.model || (wantsVision ? this.visionModelOverride || provider.visionModel || provider.defaultModel : provider.defaultModel);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${key.key}`, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
    const body: Record<string, unknown> = {
      model, messages: req.messages, temperature: req.temperature ?? 0.2,
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(Array.isArray(req.tools) && req.tools.length > 0 ? { tools: req.tools } : {}),
      ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
      ...provider.extraParams, stream: true,
    };
    if (req.json && provider.jsonMode) body.response_format = provider.jsonMode;
    if (provider.id === 'agnes' && req.reasoningEffort) (body as any).chat_template_kwargs = { enable_thinking: true };
    else if (provider.reasoningObject) (body as any).reasoning = { enabled: true };
    else if (provider.supportsReasoning && req.reasoningEffort) (body as any).reasoning_effort = req.reasoningEffort;
    const url = this.gatewayBaseURL(provider);
    const payload = JSON.stringify(body);
    // Proxy-first (home egress); direct Cloudflare egress is the fallback.
    // A proxy 429 is a real upstream answer — only faults and our own 403s
    // fall through (handled inside tryProxy by returning null).
    // Hot-standby lanes: try primary, then backup, per attempt. A faulted
    // lane is skipped for the rest of this attempt (skip-ladder persists);
    // a 1015 through a lane flags that lane poisoned for cron to replace.
    // First usable upstream answer wins; all-lanes-faulted → null (direct).
    const tryProxy = async (): Promise<Response | null> => {
      const lanes = await this.usableLanes(provider);
      if (lanes.length === 0) return null;
      const path = new URL(provider.baseURL).pathname;
      for (const lane of lanes) {
        try {
          const pres = await this.fetchViaProxy(lane, path, payload, headers, req.signal, streamCap);
          if (pres.status === 403) {
            this.laneFaulted(lane);
            logger.warn?.(`[AiGateway] relay lane ${lane.name} 403 (secret?) — trying next lane`);
            continue;
          }
          if (pres.status === 429) await this.flagRelayPoisoned(lane, pres);
          return pres;
        } catch (e) {
          logger.warn?.(`[AiGateway] relay lane ${lane.name} failed (${(e as Error)?.message ?? e}) — trying next lane`);
        }
      }
      return null;
    };
    let res: Response | null = await tryProxy();
    if (!res) {
      try {
        res = await fetch(url, { method: 'POST', headers, body: payload, signal: this.combineSignals(req.signal, streamCap) });
      } catch (e) {
        // Hung model on a stream: flag the outage and fail with a retryable
        // message — the caller re-issues via complete(), which starts on the
        // fallback model thanks to the flag set here. Caller cancels (plain
        // abort, no "timeout") never flag the model.
        const timedOut = (e as any)?.name === 'TimeoutError' || /timeout/i.test(String((e as any)?.message ?? ''));
        const abortHang = !(e as any)?.proxyFault && timedOut;
        if (abortHang && req.model && FALLBACK_MODEL[req.model]) {
          await flagModelDown(req.model);
          throw new Error(`AI model ${req.model} timed out (fallback to ${FALLBACK_MODEL[req.model]} engaged) — retry the call`);
        }
        throw e;
      }
    }
    if (res.status === 429 && (await this.isIpThrottle(res))) {
      const proxied = await tryProxy();
      if (proxied) res = proxied;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err: any = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status; err.retryAfter = this.parseRetryAfter(res.headers);
      // Feed pool health so the next turn rotates away from a 429'd key.
      try { this.pool.reportFailure(key, err, err.retryAfter); } catch {}
      throw err;
    }
    if (!res.body) return;
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]' || data === '') continue;
          try {
            const json: any = JSON.parse(data);
            const choice = json.choices?.[0];
            if (!choice) { if (json.usage) yield { usage: json.usage }; continue; }
            const delta = choice.delta ?? {};
            if (typeof delta.content === 'string' && delta.content) yield { contentDelta: delta.content };
            if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) yield { reasoningDelta: delta.reasoning_content };
            if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) yield { toolCallDelta: delta.tool_calls };
            if (choice.finish_reason) yield { finishReason: choice.finish_reason };
            if (json.usage) yield { usage: json.usage };
          } catch { /* ignore parse */ }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    this.pool.reportSuccess(key);
  }

  /** Convenience: complete + parse JSON (falls back to extracting the first
   *  JSON object/array when the model wraps it in prose — providers without
   *  structured-output support need this). */
  async completeJson<T = unknown>(req: CompletionRequest): Promise<T> {
    const res = await this.complete({ ...req, json: true });
    try {
      return JSON.parse(res.content) as T;
    } catch {
      const extracted = extractJson(res.content);
      if (extracted !== null) return extracted as T;
      throw new AiGatewayError(`Failed to parse JSON from ${res.provider} response: ${res.content.slice(0, 200)}`);
    }
  }

  private findKey(id: string): AiKey | null {
    return (this.pool as any)['keys']?.find((k: AiKey) => k.id === id) ?? null;
  }

  private async callProvider(
    provider: ProviderConfig,
    key: AiKey,
    req: CompletionRequest,
  ): Promise<CompletionResult> {
    // Vision routing: image parts need the vision-capable model (text default
    // can't see images). Explicit req.model always wins; VISION_MODEL env
    // overrides the provider default.
    const wantsVision = req.messages.some((m) => Array.isArray(m.content));
    const model = req.model || (wantsVision ? this.visionModelOverride || provider.visionModel || provider.defaultModel : provider.defaultModel);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key.key}`,
      // Agnes WAF blocks bare Workers/undici UAs — browser-like UA bypasses 1020/1015 bot check
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(Array.isArray(req.tools) && req.tools.length > 0 ? { tools: req.tools } : {}),
      ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
      ...provider.extraParams,
    };
    if (req.json && provider.jsonMode) {
      body.response_format = provider.jsonMode;
    }
    if (provider.id === 'agnes' && req.reasoningEffort) {
      // Agnes uses chat_template_kwargs.enable_thinking for reasoning depth (OpenAI-compatible).
      // Verified 2026-09-20: agnes-2.5-flash streams reasoning_content with this flag.
      (body as any).chat_template_kwargs = { enable_thinking: true };
    } else if (provider.reasoningObject) {
      // OpenRouter-style reasoning switch (ling models etc.).
      body.reasoning = { enabled: true };
    } else if (provider.supportsReasoning && req.reasoningEffort) {
      body.reasoning_effort = req.reasoningEffort;
    }
    const payload = JSON.stringify(body);
    // Proxy-first (home egress): the fastest/cleanest lane goes first by
    // default; direct Cloudflare egress is the fallback when the proxy is
    // down, slow, or unconfigured. A proxy 429 is a REAL upstream answer
    // (same key/account quota) and is returned as the attempt result — only
    // proxy FAULTS (unreachable/timeout/502) and our own 403s (secret
    // mismatch, never a provider signal) fall through to direct.
    const url = this.gatewayBaseURL(provider);
    const directInit = {
      method: 'POST',
      headers,
      body: payload,
      signal: this.combineSignals(req.signal, req.timeoutMs),
    };
    const proxyPath = new URL(provider.baseURL).pathname;
    const tryProxyFirst = async (): Promise<Response | null> => {
      const lanes = await this.usableLanes(provider);
      if (lanes.length === 0) return null;
      for (const lane of lanes) {
        try {
          const pres = await this.fetchViaProxy(lane, proxyPath, payload, headers, req.signal, req.timeoutMs);
          if (pres.status === 403) {
            this.laneFaulted(lane);
            logger.warn?.(`[AiGateway] relay lane ${lane.name} 403 (secret?) — trying next lane`);
            continue;
          }
          // Poisoned-lane detector: a 1015 that survives the relay means the
          // relay's own egress is throttled — cron will replace that run.
          if (pres.status === 429) await this.flagRelayPoisoned(lane, pres);
          return pres;
        } catch (e) {
          logger.warn?.(`[AiGateway] relay lane ${lane.name} failed (${(e as Error)?.message ?? e}) — trying next lane`);
        }
      }
      return null;
    };
    let res: Response | null = await tryProxyFirst();
    let directThrew: unknown = null;
    if (!res) {
      try {
        res = await fetch(url, directInit);
      } catch (e) {
        directThrew = e;
      }
      if (!res) throw directThrew;
      if (res.status === 429 && (await this.isIpThrottle(res)) && (await this.usableLanes(provider)).length > 0) {
        // Direct throttled at IP level while the proxy faulted a moment ago —
        // one last proxy recourse (skip-ladder permitting) before failing.
        const retry = await tryProxyFirst();
        if (retry) res = retry;
      }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err: any = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      err.retryAfter = this.parseRetryAfter(res.headers);
      throw err;
    }
    const data: any = await res.json();
    const msg: any = data?.choices?.[0]?.message ?? {};
    const rawContent: unknown = msg?.content ?? '';
    // Some vision models return content as parts — flatten to text.
    const content: string = typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('')
        : '';
    const toolCalls: ToolCall[] | undefined = Array.isArray(msg?.tool_calls)
      ? msg.tool_calls
        .filter((t: any) => t?.function?.name)
        .map((t: any) => ({
          id: String(t?.id ?? ''),
          name: String(t.function.name),
          arguments: typeof t.function.arguments === 'string' ? t.function.arguments : JSON.stringify(t.function.arguments ?? {}),
        }))
      : undefined;
    return {
      content, provider: key.provider, keyId: key.id, model,
      jsonParsed: !!req.json, usage: data?.usage,
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  /** Merge caller abort + per-attempt timeout into one signal (edge-safe). */
  private combineSignals(signal: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal | undefined {
    if (!timeoutMs || timeoutMs <= 0) return signal;
    try {
      const t = AbortSignal.timeout(timeoutMs);
      if (!signal) return t;
      if (typeof (AbortSignal as any).any === 'function') return (AbortSignal as any).any([signal, t]);
      return signal;
    } catch {
      return signal;
    }
  }

  private extractRetryAfter(err: unknown): number | undefined {    if (err && typeof err === 'object') {
      return (err as any).retryAfter;
    }
    return undefined;
  }

  private parseRetryAfter(headers: Headers): number | undefined {
    const v = headers.get('retry-after') || headers.get('x-ratelimit-reset');
    if (!v) return undefined;
    const secs = Number(v);
    return Number.isFinite(secs) ? secs * 1000 : undefined;
  }
}

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

// ── Singleton ────────────────────────────────────────────────────────────────
let _gateway: AiGateway | null = null;export function getGateway(env?: Record<string, unknown>): AiGateway {
  if (!_gateway) {
    _gateway = new AiGateway(env);
  } else if (env) {
    _gateway.configure(env);
  }
  return _gateway;
}
