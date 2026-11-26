#!/usr/bin/env node

/**
 * ai-gateway.js — JS helpers for GitHub Actions runners.
 *
 * The ONLY production AI path is the Worker: POST /api/ai/complete, whose pool
 * lives exclusively in Setting `ai:providers` (founder decision 2026-11-27).
 * This file therefore holds NO provider registry, NO env-key loader and NO
 * local HTTP gateway. It keeps the framework-free helpers plus the KeyPool
 * used by guards, mirroring the TS pool switches.
 */

/** Extract the first JSON object/array from model prose (providers without
 *  structured-output support wrap JSON in fences or chatter). */
function extractJson(raw) {
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

/** djb2 hash (mirror of TS hashAI) — consistent-hash sticky sessions. */
function hashAI(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const PROVIDER_COOLDOWN_MS = 5 * 60 * 1000;

/** Pool switches shared by the guards. Keys are supplied ONLY by
 *  registerProvider() (from Setting `ai:providers`); nothing loads env. */
class KeyPool {
  constructor() {
    this.keys = [];
    this.strategy = 'least-used-first';
    this.rrCursor = 0;
    this.providersOff = new Set();
    this.providersCooling = new Map();
  }

  /** Provider-level switch (Setting providers[].enabled === false). */
  setProviderEnabled(provider, enabled) {
    const pid = String(provider || '').trim();
    if (!pid) return;
    if (enabled) { this.providersOff.delete(pid); this.providersCooling.delete(pid); }
    else this.providersOff.add(pid);
  }

  /** Skip a provider whose route/model is gone (404/405) for a short window. */
  coolProvider(provider, ms = PROVIDER_COOLDOWN_MS) {
    const pid = String(provider || '').trim();
    if (!pid) return;
    const until = Date.now() + Math.max(1000, ms);
    this.providersCooling.set(pid, Math.max(this.providersCooling.get(pid) || 0, until));
  }

  providerEnabled(provider) {
    if (this.providersOff.has(provider)) return false;
    const until = this.providersCooling.get(provider) || 0;
    if (until && until <= Date.now()) { this.providersCooling.delete(provider); return true; }
    return until === 0;
  }

  setStrategy(s) {
    this.strategy = s === 'round-robin' ? 'round-robin' : 'least-used-first';
  }

  getStrategy() { return this.strategy; }

  /** Register a Setting-defined OpenAI-compatible provider + its keys. */
  registerProvider(id, baseURL, model, keys, enabled = true) {
    const pid = String(id == null ? '' : id).trim();
    const url = String(baseURL == null ? '' : baseURL).trim().replace(/\/+$/, '');
    if (!pid || !url) return;
    this.setProviderEnabled(pid, enabled !== false);
    const seen = new Map(this.keys.map((k) => [k.key, k]));
    for (const k of keys || []) {
      const kv = String((k && k.key) == null ? '' : k.key).trim();
      if (!kv) continue;
      const allowed = (k && k.enabled) !== false;
      const existing = seen.get(kv);
      if (existing) { existing.allowed = allowed; continue; }
      const made = this.makeKey(pid, kv, String((k && k.label) == null ? '' : k.label).trim() || undefined, allowed);
      seen.set(kv, made);
      this.keys.push(made);
    }
  }

  makeKey(provider, key, label, allowed = true) {
    const fp = key.length > 12 ? `${key.slice(0, 6)}...${key.slice(-4)}` : '***';
    return {
      id: `${provider}:${fp}`,
      provider, key, label: label || fp,
      enabled: true, allowed, failures: 0, cooldownUntil: 0,
      lastError: null, lastFailureAt: 0, lastUsedAt: 0, successCount: 0,
    };
  }

  effFailures(k, now) {
    if (k.failures > 0 && k.lastFailureAt > 0 && now - k.lastFailureAt > 10 * 60 * 1000) return 0;
    return k.failures;
  }

  select(provider, sessionKey) {
    const now = Date.now();
    let pool = this.keys.filter((k) => k.enabled && k.allowed && k.cooldownUntil <= now && this.providerEnabled(k.provider));
    if (provider) {
      const f = pool.filter((k) => k.provider === provider);
      if (f.length > 0) pool = f;
    }
    if (pool.length === 0) return null;
    const eff = (k) => this.effFailures(k, now);
    const minFailures = Math.min(...pool.map(eff));
    const tier = pool.filter((k) => eff(k) <= minFailures).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (sessionKey) {
      const start = parseInt(hashAI(`sess:${sessionKey}`), 36) % tier.length;
      return tier[start];
    }
    if (this.strategy === 'round-robin') {
      const idx = this.rrCursor++ % tier.length;
      return tier[idx];
    }
    return tier.length === 1 ? tier[0] : tier[Math.floor(Math.random() * tier.length)];
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
    if (status === 404 || status === 405) {
      this.coolProvider(key.provider);
      return PROVIDER_COOLDOWN_MS;
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
    return m ? parseInt(m[1], 10) : null;
  }

  earliestCooldownMs() {
    const now = Date.now();
    let min = 0;
    for (const k of this.keys) {
      if (!k.enabled || !k.allowed || !this.providerEnabled(k.provider)) continue;
      const wait = k.cooldownUntil - now;
      if (wait > 0 && (min === 0 || wait < min)) min = wait;
    }
    return min;
  }

  health() {
    return this.keys.map((k) => ({
      id: k.id, label: k.label, provider: k.provider, enabled: k.enabled, allowed: k.allowed,
      failures: k.failures, cooldownUntil: k.cooldownUntil, lastError: k.lastError,
      lastUsedAt: k.lastUsedAt, successCount: k.successCount,
    }));
  }

  get size() {
    return this.keys.length;
  }
}

module.exports = {
  extractJson,
  buildVisionUserContent,
  hashAI,
  KeyPool,
};
