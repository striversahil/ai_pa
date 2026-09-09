#!/usr/bin/env node

/**
 * scripts/ai-gateway.js — JS port of src/shared/ai-gateway.ts for the GitHub
 * Actions runners (CommonJS, no build step). Mirrors the TS module's surface
 * exactly so both runtimes share one key-management contract:
 *
 *   env.GROQ_API_KEYS = "key1,key2,key3,..."   (THE only LLM key source)
 *     Every key is Groq. The gateway handles least-failures selection, random
 *     rotation, 429 cooldown (honors retry-after), 401/403 disable, 5xx rotate.
 *     No omniroute / no other provider fallbacks — Groq direct only.
 */

// ── Provider registry (mirror of TS; Groq-only) ──────────────────────────────
const PROVIDERS = {
  groq: {
    id: 'groq',
    baseURL: 'https://api.groq.com/openai/v1/chat/completions',
    supportsReasoning: true,
    jsonMode: { type: 'json_object' },
    defaultModel: 'openai/gpt-oss-120b',
  },
};

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

    // Groq is the ONLY key source. Keys from GROQ_API_KEYS are all Groq; any
    // AI_KEYS/legacy *_API_KEYS/OMNIROUTE_* env is intentionally IGNORED.
    for (const key of raw(env && env.GROQ_API_KEYS).split(',')) add('groq', key);

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
    if (env) this.pool.loadFromEnv(env);
  }

  configure(env) {
    this.pool.loadFromEnv(env);
  }

  get keyCount() {
    return this.pool.size;
  }

  health() {
    return this.pool.health();
  }

  async complete(req) {
    const maxAttempts = Math.max(3, this.pool.size || 3);
    let lastErr;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const key = req.keyId
        ? (this.pool.keys.find((k) => k.id === req.keyId) || this.pool.select(req.provider))
        : this.pool.select(req.provider);
      if (!key) throw new AiGatewayError('No AI key available (pool empty or all disabled)', lastErr, attempt);
      const provider = PROVIDERS[key.provider] || PROVIDERS.openai;
      try {
        const result = await this.callProvider(provider, key, req);
        this.pool.reportSuccess(key);
        return result;
      } catch (err) {
        lastErr = err;
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
    } catch (parseErr) {
      throw new AiGatewayError(`Failed to parse JSON from ${res.provider} response: ${res.content.slice(0, 200)}`, parseErr);
    }
  }

  async callProvider(provider, key, req) {
    const model = req.model || provider.defaultModel;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key.key}`,
    };
    const body = {
      model,
      messages: req.messages,
      temperature: req.temperature === undefined ? 0.2 : req.temperature,
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(provider.extraParams || {}),
    };
    if (req.json && provider.jsonMode) body.response_format = provider.jsonMode;
    if (provider.supportsReasoning && req.reasoningEffort) body.reasoning_effort = req.reasoningEffort;

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
    const content = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    return {
      content, provider: key.provider, keyId: key.id, model,
      jsonParsed: !!req.json, usage: data && data.usage,
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
};
