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
  /** OpenRouter-style reasoning switch (`reasoning: { enabled: true }`). */
  reasoningObject?: boolean;
  jsonMode?: { type: 'json_object' };
  defaultModel: string;
  /** Used when a request carries image parts and no explicit model is set. */
  visionModel?: string;
}

const OPENROUTER_VISION_MODEL = 'inclusionai/ling-3.0-flash-vl:free';

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
    // NOTE: ling-3.0-flash-vl rejects response_format (no structured-outputs)
    // → jsonMode intentionally absent; JSON is enforced via prompt + the
    // extractJson fallback in completeJson instead.
    // Text + vision in one model — the enquiry pipeline default.
    defaultModel: OPENROUTER_VISION_MODEL,
    visionModel: OPENROUTER_VISION_MODEL,
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

// detectProvider: Groq-only mode — every key is Groq regardless of label.
function detectProvider(_key: string): string {
  return 'groq';
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

export class AiGateway {
  private pool = new KeyPool();
  private visionModelOverride = '';
  /** Rotating OpenRouter free-model list (OPENROUTER_FREE_MODELS). Text
   *  requests cycle through these as 429s persist; vision stays pinned. */
  private openrouterModels: string[] = [OPENROUTER_VISION_MODEL];
  private modelIdx = 0;

  constructor(env?: Record<string, unknown>) {
    if (env) this.configure(env);
  }

  configure(env: Record<string, unknown>): void {
    this.pool.loadFromEnv(env);
    const v = String((env as any)?.VISION_MODEL ?? '').trim();
    if (v) this.visionModelOverride = v;
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

  /**
   * Core completion call. Picks a key, calls the provider, rotates + retries on
   * transient/provider errors. Rate limits (429) are retried hard — up to
   * MIN_ATTEMPTS immediate retries — because burst limits wave off within
   * seconds; other errors rotate keys as before. Throws AiGatewayError only
   * when every attempt is exhausted.
   */
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    // Free-tier burst limits clear in seconds — hammer through them instead of
    // surfacing an error to the caller.
    const MIN_ATTEMPTS = 50;
    const maxAttempts = Math.max(MIN_ATTEMPTS, this.pool.size || MIN_ATTEMPTS);
    const wantsVision = req.messages.some((m) => Array.isArray(m.content));
    // Model rotation (OpenRouter text requests only): every ROTATE_EVERY
    // consecutive 429s moves to the next OPENROUTER_FREE_MODELS entry,
    // spreading quota. Explicit req.model, vision requests, and non-OpenRouter
    // providers never rotate.
    const ROTATE_EVERY = 5;
    let streak429 = 0;
    let rotatedModel: string | undefined;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const key = req.keyId
        ? this.findKey(req.keyId) ?? this.pool.select(req.provider)
        : this.pool.select(req.provider);
      if (!key) {
        // All keys cooling (429 storm): wait for the earliest one and retry.
        const waitMs = this.pool.earliestCooldownMs();
        if (waitMs > 0 && waitMs <= 30_000 && attempt < maxAttempts - 1) {
          await sleep(Math.min(waitMs, 5_000));
          continue;
        }
        throw new AiGatewayError('No AI key available (pool empty or all disabled)', lastErr, attempt);
      }
      const provider = PROVIDERS[key.provider] ?? PROVIDERS.groq;
      try {
        const result = await this.callProvider(provider, key, rotatedModel ? { ...req, model: rotatedModel } : req);
        this.pool.reportSuccess(key);
        return result;
      } catch (err) {
        lastErr = err;
        const status = this.pool.extractStatus(err);
        if (status === 429) {
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
          logger.warn?.(`[AiGateway] 429 on ${key.id}, immediate retry ${attempt + 1}/${maxAttempts}`);
          if (attempt < maxAttempts - 1) {
            await sleep(Math.min(retryAfter ?? 1_500, 5_000));
            continue;
          }
          throw new AiGatewayError(`Rate-limited after ${maxAttempts} immediate retries`, lastErr, maxAttempts);
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
    if (provider.reasoningObject) {
      // OpenRouter-style reasoning switch (ling models etc.).
      body.reasoning = { enabled: true };
    } else if (provider.supportsReasoning && req.reasoningEffort) {
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
