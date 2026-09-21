#!/usr/bin/env node

/**
 * scripts/ai-gateway.js — JS port of src/shared/ai-gateway.ts for the GitHub
 * Actions runners (CommonJS, no build step). Mirrors the TS module's surface
 * exactly so both runtimes share one key-management contract:
 *
 * Key sources (single contract, both runtimes):
 *   env.AGNES_API_KEY / env.AGNES_API_KEYS = Agnes keys (primary, sk-...)
 *   env.GROQ_API_KEYS = Groq keys (fallback, gsk_...)
 *   env.OPENROUTER_API_KEYS / env.OPENROUTER_API_KEY = OpenRouter keys
 *   env.AI_KEYS = "provider:key:label,..." (e.g. "agnes:sk-...:primary")
 * Agnes primary via https://apihub.agnes-ai.com/v1 (agnes-2.5-flash, 512K),
 * reasoning via chat_template_kwargs.enable_thinking (mapped from reasoningEffort).
 * 429s are retried immediately (up to 50 attempts) — burst limits wave off.
 */

// ── Provider registry (mirror of TS) ─────────────────────────────────────────
const OPENROUTER_VISION_MODEL = 'inclusionai/ling-3.0-flash-vl:free';
const PROVIDERS = {
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
    // → jsonMode intentionally absent; JSON enforced via prompt + extractJson.
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

/** Extract the first JSON object/array from model prose (providers without
 *  structured-output support wrap JSON in fences or chatter). */
function extractJsonModule(raw) {
  const str = String(raw == null ? '' : raw).trim();
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
 *  Accepts raw URL strings or { url } objects (e.g. worker slim payloads). */
function buildVisionUserContent(text, imageUrls, maxImages) {
  const imgs = (Array.isArray(imageUrls) ? imageUrls : [])
    .map((u) => (u != null && typeof u === 'object' ? u.url : u))
    .map((u) => String(u == null ? '' : u).trim())
    .filter((u) => u.length > 0 && (u.startsWith('data:image/') || u.startsWith('http')))
    .slice(0, Math.max(0, maxImages === undefined ? 4 : maxImages));
  if (imgs.length === 0) return text;
  return [{ type: 'text', text }, ...imgs.map((url) => ({ type: 'image_url', image_url: { url } }))];
}

class AiGatewayError extends Error {
  constructor(message, cause, attempts) {
    super(message);
    this.name = 'AiGatewayError';
    this.cause = cause;
    this.attempts = attempts;
  }
}

// ── Key pool ─────────────────────────────────────────────────────────────────
class KeyPool {
  constructor() {
    this.keys = [];
  }

  loadFromEnv(env) {
    const raw = (v) => (typeof v === 'string' ? v : '');
    const seen = new Set();
    const PLACEHOLDER = /^(your[_-]?api[_-]?key.*|replace[_-]?.*|xxx+|placeholder.*|\*+)$/i;
    const add = (provider, key, label) => {
      const k = key.trim();
      if (!k || seen.has(k) || PLACEHOLDER.test(k)) return;
      seen.add(k);
      this.keys.push(this.makeKey(provider, k, label));
    };

    // Key sources: AGNES_API_KEY(S) (primary) + GROQ etc (fallback). AI_KEYS "provider:key:label" honored too.
    for (const key of raw(env && env.AGNES_API_KEY).split(',')) add('agnes', key);
    for (const key of raw(env && env.AGNES_API_KEYS).split(',')) add('agnes', key);
    for (const key of raw(env && env.GROQ_API_KEYS).split(',')) add('groq', key);
    for (const key of raw(env && env.OPENROUTER_API_KEYS).split(',')) add('openrouter', key);
    for (const key of raw(env && env.OPENROUTER_API_KEY).split(',')) add('openrouter', key);
    for (const key of raw(env && env.REQUESTLY_API_KEY).split(',')) add('requestly', key);
    for (const key of raw(env && env.REQUESTLY_API_KEYS).split(',')) add('requestly', key);
    const aiKeys = raw(env && env.AI_KEYS);
    if (aiKeys) {
      for (const entry of aiKeys.split(',')) {
        const parts = entry.split(':');
        if (parts.length >= 2) {
          const prov = (parts[0] || '').trim();
          let key, label;
          if (parts.length >= 3) {
            label = parts[parts.length - 1];
            key = parts.slice(1, parts.length - 1).join(':');
          } else {
            key = parts[1];
          }
          let provider = prov || (key.trim().startsWith('gsk_') ? 'groq' : key.trim().startsWith('sk-') ? 'agnes' : 'agnes');
          if (!provider) provider = key.trim().startsWith('gsk_') ? 'groq' : 'agnes';
          add(provider, key, label);
        }
      }
    }

    console.log(`[AiGateway] loaded ${this.keys.length} keys: ${this.keys.map((k) => `${k.provider}:${k.label}`).join(', ')}`);
  }

  makeKey(provider, key, label) {
    const fp = key.length > 12 ? `${key.slice(0, 6)}...${key.slice(-4)}` : '***';
    return {
      id: `${provider}:${fp}`,
      provider, key, label: label || fp,
      enabled: true, failures: 0, cooldownUntil: 0,
      lastError: null, lastFailureAt: 0, lastUsedAt: 0, successCount: 0,
    };
  }

  select(provider) {
    const now = Date.now();
    let pool = this.keys.filter((k) => k.enabled && k.cooldownUntil <= now);
    if (provider) {
      const f = pool.filter((k) => k.provider === provider);
      if (f.length > 0) pool = f;
    }
    if (pool.length === 0) return null;
    const priority = { agnes: 0, groq: 1, openrouter: 2, requestly: 3 };
    pool.sort((a, b) => {
      if (!provider) {
        const pa = priority[a.provider] ?? 99;
        const pb = priority[b.provider] ?? 99;
        if (pa !== pb) return pa - pb;
      }
      return a.failures - b.failures || a.lastUsedAt - b.lastUsedAt;
    });
    return pool[0];
  }

  reportSuccess(key) {
    key.failures = 0;
    key.lastUsedAt = Date.now();
    key.successCount++;
    key.lastError = null;
  }

  reportFailure(key, err, retryAfterMs) {
    key.failures++;
    key.lastFailureAt = Date.now();
    const msg = err && err.message ? err.message : String(err);
    key.lastError = msg.slice(0, 200);
    const status = this.extractStatus(err);

    if (status === 401 || status === 403) {
      key.enabled = false;
      console.warn(`[AiGateway] key ${key.id} DISABLED (HTTP ${status}): ${key.lastError}`);
      return 0;
    }
    if (status === 429) {
      const cd = retryAfterMs || Math.min(60000 * Math.pow(2, Math.min(key.failures, 5)), 10 * 60000);
      key.cooldownUntil = Date.now() + cd;
      console.warn(`[AiGateway] key ${key.id} rate-limited, cooling ${Math.round(cd / 1000)}s`);
      return cd;
    }
    if (status === 402 || /quota|billing|insufficient|exceeded/i.test(msg)) {
      key.cooldownUntil = Date.now() + 5 * 60000;
      return 5 * 60000;
    }
    if (status && status >= 500) {
      key.cooldownUntil = Date.now() + 5000;
      return 0;
    }
    if (/abort|timeout|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket/i.test(msg)) {
      key.cooldownUntil = Date.now() + 2000;
      return 0;
    }
    return 0;
  }

  extractStatus(err) {
    if (err && typeof err === 'object') {
      if (typeof err.status === 'number') return err.status;
      if (typeof err.statusCode === 'number') return err.statusCode;
    }
    const m = String((err && err.message) || err).match(/\b(\d{3})\b/);
    return m ? parseInt(m[1]) : null;
  }

  earliestCooldownMs() {
    const now = Date.now();
    let min = 0;
    for (const k of this.keys) {
      if (!k.enabled) continue;
      const wait = k.cooldownUntil - now;
      if (wait > 0 && (min === 0 || wait < min)) min = wait;
    }
    return min;
  }

  health() {
    return this.keys.map((k) => ({
      id: k.id, label: k.label, provider: k.provider, enabled: k.enabled,
      failures: k.failures, cooldownUntil: k.cooldownUntil, lastError: k.lastError,
      lastUsedAt: k.lastUsedAt, successCount: k.successCount,
    }));
  }

  get size() {
    return this.keys.length;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Gateway ──────────────────────────────────────────────────────────────────
class AiGateway {
  constructor(env) {
    this.pool = new KeyPool();
    this.visionModelOverride = '';
    this.openrouterModels = [OPENROUTER_VISION_MODEL];
    this.modelIdx = 0;
    if (env) this.configure(env);
  }

  configure(env) {
    this.pool.loadFromEnv(env);
    const v = String((env && env.VISION_MODEL) || '').trim();
    if (v) this.visionModelOverride = v;
    const models = String((env && env.OPENROUTER_FREE_MODELS) || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (models.length > 0) this.openrouterModels = [...new Set(models)];
  }

  get keyCount() {
    return this.pool.size;
  }

  health() {
    return this.pool.health();
  }

  async complete(req) {
    if (!req.provider && req.model && req.model.startsWith('agnes-')) req = { ...req, provider: 'agnes' };
    // Standardized: fail fast on 429, no 50× hammer. Heavy app queues at caller.
    const MIN_ATTEMPTS = 3;
    const ROTATE_EVERY = 5;
    const maxAttempts = Math.max(MIN_ATTEMPTS, Math.min(this.pool.size || MIN_ATTEMPTS, 5));
    const wantsVision = Array.isArray(req.messages) && req.messages.some((m) => Array.isArray(m.content));
    let streak429 = 0;
    let rotatedModel;
    let lastErr;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const key = req.keyId
        ? (this.pool.keys.find((k) => k.id === req.keyId) || this.pool.select(req.provider))
        : this.pool.select(req.provider);
      if (!key) {
        const waitMs = this.pool.earliestCooldownMs();
        const retryAfter = waitMs > 0 ? Math.min(waitMs, 60000) : 60000;
        const e = new Error(`HTTP 429: Rate-limited (retry after ${Math.round(retryAfter/1000)}s)`);
        e.status = 429; e.retryAfter = retryAfter;
        throw e;
      }
      const provider = PROVIDERS[key.provider] || PROVIDERS.groq;
      try {
        const result = await this.callProvider(provider, key, rotatedModel ? { ...req, model: rotatedModel } : req);
        this.pool.reportSuccess(key);
        return result;
      } catch (err) {
        lastErr = err;
        const status = this.pool.extractStatus(err);
        if (status === 429) {
          if (provider.id === 'agnes') {
            const msg = String((err && err.message) || '');
            const isCf1015 = /1015|error code: 1015/i.test(msg);
            if (isCf1015) {
              const retryAfter = err && err.retryAfter;
              const rawCd = typeof retryAfter === 'number' ? retryAfter : 72000;
              const cd = Math.min(rawCd, 60000);
              key.cooldownUntil = Date.now() + cd;
              key.failures++;
              key.lastError = `429 Cloudflare 1015`;
              console.warn(`[AiGateway] 429 Cloudflare 1015 on ${key.id} — failing fast, cooling ${Math.round(cd/1000)}s (raw ${Math.round(rawCd/1000)}s)`);
              const e2 = new Error(`HTTP 429: Rate-limited (Cloudflare 1015, retry after ${Math.round(cd/1000)}s)`);
              e2.status = 429; e2.retryAfter = cd; throw e2;
            }
            const retryAfter = err && err.retryAfter;
            const rawCd = typeof retryAfter === 'number' ? retryAfter : 60000;
            const cd = Math.min(rawCd, 60000);
            key.cooldownUntil = Date.now() + cd;
            key.failures++;
            key.lastError = `429 rate-limited`;
            console.warn(`[AiGateway] 429 on ${key.id} (agnes) — cooling ${Math.round(cd/1000)}s (raw ${Math.round(rawCd/1000)}s), failing fast`);
            const e3 = new Error(`HTTP 429: Rate-limited (retry after ${Math.round(cd/1000)}s)`);
            e3.status = 429; e3.retryAfter = cd; throw e3;
          }
          streak429++;
          if (
            !req.model && !wantsVision && provider.id === 'openrouter' &&
            this.openrouterModels.length > 1 && streak429 % ROTATE_EVERY === 0
          ) {
            this.modelIdx = (this.modelIdx + 1) % this.openrouterModels.length;
            rotatedModel = this.openrouterModels[this.modelIdx];
            console.warn(`[AiGateway] 429 streak x${streak429} — rotating OpenRouter model to ${rotatedModel}`);
          }
          key.failures++;
          key.lastFailureAt = Date.now();
          key.cooldownUntil = 0;
          key.lastError = `429 retry ${attempt + 1}/${maxAttempts}${rotatedModel ? ` (${rotatedModel})` : ''}`;
          if (attempt < maxAttempts - 1) {
            const ra = err && err.retryAfter;
            const backoff = Math.min(typeof ra === 'number' ? ra : 800 * Math.pow(2, attempt), 5000);
            console.warn(`[AiGateway] 429 on ${key.id}, retry ${attempt + 1}/${maxAttempts} after ${backoff}ms`);
            await sleep(backoff);
            continue;
          }
          const ra2 = err && err.retryAfter;
          const e4 = new Error(`HTTP 429: Rate-limited (retry after ${Math.round((typeof ra2 === 'number' ? ra2 : 60000)/1000)}s)`);
          e4.status = 429; e4.retryAfter = typeof ra2 === 'number' ? ra2 : 60000;
          throw e4;
        }
        const cooldown = this.pool.reportFailure(key, err, err && err.retryAfter);
        console.warn(`[AiGateway] attempt ${attempt + 1}/${maxAttempts} failed on ${key.id}: ${err && err.message ? err.message : err}`);
        if (cooldown > 0 && attempt < maxAttempts - 1) {
          await sleep(Math.min(cooldown, 5000));
        }
      }
    }
    throw new AiGatewayError(`All AI keys exhausted after ${maxAttempts} attempts`, lastErr, maxAttempts);
  }

  async completeJson(req) {
    const res = await this.complete({ ...req, json: true });
    try {
      return JSON.parse(res.content);
    } catch {
      const extracted = extractJsonModule(res.content);
      if (extracted !== null) return extracted;
      throw new AiGatewayError(`Failed to parse JSON from ${res.provider} response: ${res.content.slice(0, 200)}`);
    }
  }

  async callProvider(provider, key, req) {
    const wantsVision = Array.isArray(req.messages) && req.messages.some((m) => Array.isArray(m.content));
    const model = req.model || (wantsVision ? this.visionModelOverride || provider.visionModel || provider.defaultModel : provider.defaultModel);
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key.key}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    const body = {
      model,
      messages: req.messages,
      temperature: req.temperature === undefined ? 0.2 : req.temperature,
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(Array.isArray(req.tools) && req.tools.length > 0 ? { tools: req.tools } : {}),
      ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
      ...(provider.extraParams || {}),
    };
    if (req.json && provider.jsonMode) body.response_format = provider.jsonMode;
    if (provider.id === 'agnes' && req.reasoningEffort) body.chat_template_kwargs = { enable_thinking: true };
    else if (provider.reasoningObject && !req.noReasoning) body.reasoning = { enabled: true };
    else if (provider.supportsReasoning && req.reasoningEffort) body.reasoning_effort = req.reasoningEffort;

    const res = await fetch(provider.baseURL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      err.retryAfter = this.parseRetryAfter(res.headers);
      throw err;
    }
    const data = await res.json();
    const msg = (data && data.choices && data.choices[0] && data.choices[0].message) || {};
    const rawContent = msg.content || '';
    const content = typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent) ? rawContent.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('') : '';
    const toolCalls = Array.isArray(msg.tool_calls)
      ? msg.tool_calls.filter((t) => t && t.function && t.function.name).map((t) => ({
          id: String(t.id || ''),
          name: String(t.function.name),
          arguments: typeof t.function.arguments === 'string' ? t.function.arguments : JSON.stringify(t.function.arguments || {}),
        }))
      : undefined;
    return {
      content, provider: key.provider, keyId: key.id, model,
      jsonParsed: !!req.json, usage: data && data.usage,
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  parseRetryAfter(headers) {
    const v = headers.get('retry-after') || headers.get('x-ratelimit-reset');
    if (!v) return undefined;
    const secs = Number(v);
    return Number.isFinite(secs) ? secs * 1000 : undefined;
  }
}

let _gateway = null;
function getGateway(env) {
  if (!_gateway) {
    _gateway = new AiGateway(env);
  } else if (env) {
    _gateway.configure(env);
  }
  return _gateway;
}

module.exports = {
  AiGateway,
  KeyPool,
  getGateway,
  PROVIDERS,
  AiGatewayError,
  buildVisionUserContent,
  extractJson: extractJsonModule,
};
