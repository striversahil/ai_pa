/**
 * Unified multi-provider AI gateway — the SINGLE module every AI call in the
 * system routes through. Currently Groq-only (direct Groq API). Every key in
 * the pool is a Groq key; the gateway handles least-failures selection, random
 * rotation, 429 cooldown (honors retry-after), 401/403 disable, 5xx rotate.
 *
 * Key configuration (single source of truth, both runtimes):
 *   env.GROQ_API_KEYS = "key1,key2,..."   (comma-separated Groq keys)
 *   env.AI_KEYS        = optional Groq keys in "key:label" form
 *   env.OMNIROUTE_*    = IGNORED (no legacy gateway / no fallback)
 *
 * Runtime note: this module is edge-safe (no Node-only deps) so it bundles into
 * the Cloudflare Worker via build-worker.mjs. The GH Actions scripts consume a
 * JS port (scripts/ai-gateway.js) that mirrors this surface exactly. Both read
 * the same AI_KEYS contract, so key management is identical across runtimes.
 *
 * Edge multi-isolate caveat: Worker isolates don't share memory, so KeyPool
 * state (cooldowns, failure counts) is per-isolate. That's acceptable — it
 * still prevents a single isolate from hammering a dead key, and the pool
 * self-heals because cooldowns are bounded.
 */
import { logger } from './logger';

// ── Provider registry ────────────────────────────────────────────────────────
export interface ProviderConfig {
  id: string;
  baseURL: string;
  extraParams?: Record<string, unknown>;
  supportsReasoning: boolean;
  jsonMode?: { type: 'json_object' };
  defaultModel: string;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  groq: {
    id: 'groq',
    baseURL: 'https://api.groq.com/openai/v1/chat/completions',
    supportsReasoning: true,
    jsonMode: { type: 'json_object' },
    defaultModel: 'openai/gpt-oss-120b',
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

// detectProvider intentionally removed — Groq-only mode; every key is Groq.

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
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  provider?: string;
  keyId?: string;
  json?: boolean;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
}

export interface CompletionResult {
  content: string;
  provider: string;
  keyId: string;
  model: string;
  jsonParsed: boolean;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
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
    const seen = new Set<string>();
    const PLACEHOLDER = /^(your[_-]?api[_-]?key.*|replace[_-]?.*|xxx+|placeholder.*|\*+)$/i;
    const add = (provider: string, key: string, label?: string) => {
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

  /** Pick the best key: least failures, not cooling down, least-recently-used. */
  select(provider?: string): AiKey | null {
    const now = Date.now();
    let pool = this.keys.filter((k) => k.enabled && k.cooldownUntil <= now);
    if (provider) {
      const filtered = pool.filter((k) => k.provider === provider);
      if (filtered.length > 0) pool = filtered;
    }
    if (pool.length === 0) return null;
    pool.sort((a, b) => a.failures - b.failures || a.lastUsedAt - b.lastUsedAt);
    return pool[0];
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

  private extractStatus(err: unknown): number | null {
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
      id: k.id, label: k.label, provider: k.provider, enabled: k.enabled,
      failures: k.failures, cooldownUntil: k.cooldownUntil, lastError: k.lastError,
      lastUsedAt: k.lastUsedAt, successCount: k.successCount,
    }));
  }

  get size(): number {
    return this.keys.length;
  }
}

// ── Gateway ──────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AiGateway {
  private pool = new KeyPool();

  constructor(env?: Record<string, unknown>) {
    if (env) this.pool.loadFromEnv(env);
  }

  configure(env: Record<string, unknown>): void {
    this.pool.loadFromEnv(env);
  }

  get keyCount(): number {
    return this.pool.size;
  }

  health(): KeyHealth[] {
    return this.pool.health();
  }

  /**
   * Core completion call. Picks a key, calls the provider, rotates + retries on
   * transient/provider errors. Throws AiGatewayError only when every key is
   * exhausted.
   */
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const maxAttempts = Math.max(3, this.pool.size || 3);
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const key = req.keyId
        ? this.findKey(req.keyId) ?? this.pool.select(req.provider)
        : this.pool.select(req.provider);
      if (!key) throw new AiGatewayError('No AI key available (pool empty or all disabled)', lastErr, attempt);
      const provider = PROVIDERS[key.provider] ?? PROVIDERS.openai;
      try {
        const result = await this.callProvider(provider, key, req);
        this.pool.reportSuccess(key);
        return result;
      } catch (err) {
        lastErr = err;
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

  /** Convenience: complete + parse JSON. */
  async completeJson<T = unknown>(req: CompletionRequest): Promise<T> {
    const res = await this.complete({ ...req, json: true });
    try {
      return JSON.parse(res.content) as T;
    } catch (parseErr) {
      throw new AiGatewayError(`Failed to parse JSON from ${res.provider} response: ${res.content.slice(0, 200)}`, parseErr);
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
    const model = req.model || provider.defaultModel;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key.key}`,
    };
    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...provider.extraParams,
    };
    if (req.json && provider.jsonMode) {
      body.response_format = provider.jsonMode;
    }
    if (provider.supportsReasoning && req.reasoningEffort) {
      body.reasoning_effort = req.reasoningEffort;
    }
    const res = await fetch(provider.baseURL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err: any = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      err.retryAfter = this.parseRetryAfter(res.headers);
      throw err;
    }
    const data: any = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? '';
    return {
      content, provider: key.provider, keyId: key.id, model,
      jsonParsed: !!req.json, usage: data?.usage,
    };
  }

  private extractRetryAfter(err: unknown): number | undefined {
    if (err && typeof err === 'object') {
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

// ── Singleton ────────────────────────────────────────────────────────────────
let _gateway: AiGateway | null = null;
export function getGateway(env?: Record<string, unknown>): AiGateway {
  if (!_gateway) {
    _gateway = new AiGateway(env);
  } else if (env) {
    _gateway.configure(env);
  }
  return _gateway;
}
