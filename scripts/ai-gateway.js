#!/usr/bin/env node

/**
 * scripts/ai-gateway.js — JS port of src/shared/ai-gateway.ts for the GitHub
 * Actions runners (CommonJS, no build step). Mirrors the TS module's surface
 * exactly so both runtimes share one key-management contract:
 *
 * Key sources (single contract, both runtimes):
 *   env.GROQ_API_KEYS = "key1,key2,..." (Groq direct)
 *   env.OPENROUTER_API_KEYS / env.OPENROUTER_API_KEY = OpenRouter keys
 *     (default model inclusionai/ling-3.0-flash-vl:free, text+vision)
 *   env.AI_KEYS = "provider:key:label,..." (either provider)
 * 429s are retried immediately (up to 50 attempts) — burst limits wave off.
 */

// ── Provider registry (mirror of TS) ─────────────────────────────────────────
const OPENROUTER_VISION_MODEL = 'inclusionai/ling-3.0-flash-vl:free';
const PROVIDERS = {
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

    // Key sources: GROQ_API_KEYS (groq) + OPENROUTER_API_KEYS/OPENROUTER_API_KEY
    // (openrouter, singular also accepted). AI_KEYS "provider:key:label" entries
    // are honored too.
    for (const key of raw(env && env.GROQ_API_KEYS).split(',')) add('groq', key);
    for (const key of raw(env && env.OPENROUTER_API_KEYS).split(',')) add('openrouter', key);
    for (const key of raw(env && env.OPENROUTER_API_KEY).split(',')) add('openrouter', key);
    const aiKeys = raw(env && env.AI_KEYS);
    if (aiKeys) {
      for (const entry of aiKeys.split(',')) {
        const parts = entry.split(':');
        if (parts.length >= 2) add((parts[0] || '').trim() || 'groq', parts.slice(1).join(':'));
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
    pool.sort((a, b) => a.failures - b.failures || a.lastUsedAt - b.lastUsedAt);
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
    // Free-tier burst limits clear in seconds — hammer through 429s with up to
    // 50 immediate retries instead of surfacing an error to the caller.
    // OpenRouter text requests additionally rotate OPENROUTER_FREE_MODELS
    // every 5 consecutive 429s (vision + explicit models never rotate).
    const MIN_ATTEMPTS = 50;
    const ROTATE_EVERY = 5;
    const maxAttempts = Math.max(MIN_ATTEMPTS, this.pool.size || MIN_ATTEMPTS);
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
        if (waitMs > 0 && waitMs <= 30000 && attempt < maxAttempts - 1) {
          await sleep(Math.min(waitMs, 5000));
          continue;
        }
        throw new AiGatewayError('No AI key available (pool empty or all disabled)', lastErr, attempt);
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
          console.warn(`[AiGateway] 429 on ${key.id}, immediate retry ${attempt + 1}/${maxAttempts}`);
          if (attempt < maxAttempts - 1) {
            const ra = err && err.retryAfter;
            await sleep(Math.min(typeof ra === 'number' ? ra : 1500, 5000));
            continue;
          }
          throw new AiGatewayError(`Rate-limited after ${maxAttempts} immediate retries`, lastErr, maxAttempts);
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
    // Small deterministic JSON tasks (intake split) opt out via noReasoning:
    // uncapped reasoning shares the max_tokens budget and the answer JSON
    // gets cut mid-stream, failing strict parse on every attempt.
    if (provider.reasoningObject && !req.noReasoning) body.reasoning = { enabled: true };
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
