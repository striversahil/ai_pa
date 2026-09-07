#!/usr/bin/env node

/**
 * runner-lib.js — shared helpers for GitHub Actions automation runners.
 *
 * Every heavy / AI / cron automation runs HERE on the GH Actions runner with
 * unlimited CPU; the Cloudflare Worker only serves instant D1 reads and writes
 * (see the /api/runner/* endpoints in founder-os_backend/src/worker.ts).
 *
 * Env:
 *   WORKER_URL          — founder-os-worker URL (same as workflow WORKER_URL)
 *   SHARED_SECRET       — must match the worker's SHARED_SECRET
 *   OMNIROUTE_BASE_URL  — e.g. https://omniroute.../v1 (append /chat/completions)
 *   OMNIROUTE_API_KEY   — omniroute API key
 *   OMNIROUTE_MODEL     — model name (default: groq/openai/gpt-oss-120b)
 */

const WORKER_URL = process.env.WORKER_URL;
const SHARED_SECRET = process.env.SHARED_SECRET;
const OMNIROUTE_BASE_URL = (process.env.OMNIROUTE_BASE_URL || '').replace(/\/$/, '');
const OMNIROUTE_API_KEY = process.env.OMNIROUTE_API_KEY;
const OMNIROUTE_MODEL = process.env.OMNIROUTE_MODEL || 'groq/openai/gpt-oss-120b';

function requireEnv() {
  const missing = [];
  if (!WORKER_URL) missing.push('WORKER_URL');
  if (!SHARED_SECRET) missing.push('SHARED_SECRET');
  if (!OMNIROUTE_BASE_URL) missing.push('OMNIROUTE_BASE_URL');
  if (!OMNIROUTE_API_KEY) missing.push('OMNIROUTE_API_KEY');
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function workerRequest(path, { method = 'GET', body, timeoutMs = 90000 } = {}) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SHARED_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`worker ${method} ${path}: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

/**
 * Direct-Groq fallback so AI analysis survives omniroute outages. When the
 * primary OMNIROUTE_BASE_URL worker is down (Cloudflare tunnel 530, timeout)
 * or its provider/model 404s, fall back to Groq directly using a randomly
 * rotated key from GROQ_API_KEYS (comma-separated). Model defaults to
 * openai/gpt-oss-120b, which the account is verified to serve.
 */
async function groqFallback(system, user, temperature) {
  const keys = (process.env.GROQ_API_KEYS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (keys.length === 0) return null;
  const key = keys[Math.floor(Math.random() * keys.length)];
  const model = process.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-120b';
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      stream: false,
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`groq fallback ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Robust direct-Groq JSON caller for GH Actions runners — the PRIMARY LLM path
 * (survives omniroute outages; omniroute is used only by older runners). Uses
 * `GROQ_API_KEYS` (comma-separated; different API keys = different orgs =
 * independent rate limits). Randomly rotates the STARTING key and retries up to
 * `maxAttempts` (default 5) with 5s backoff (honours the 429 `retry-after`
 * header) until a valid JSON response is received. Model defaults to
 * `openai/gpt-oss-120b` (the verified account model) with HIGH reasoning —
 * `reasoning_effort: high` (per Groq docs) + JSON mode (reasoning is parsed
 * out automatically in JSON mode, so content returns clean JSON). Returns the
 * parsed JSON; throws when every key/attempt fails.
 */
async function groqJson(system, user, { temperature = 0, maxAttempts = 5, maxTokens = 4096 } = {}) {
  const keys = (process.env.GROQ_API_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (keys.length === 0) throw new Error('GROQ_API_KEYS not set — cannot run AI');
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const reasoningEffort = process.env.GROQ_REASONING_EFFORT || 'high';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const start = Math.floor(Math.random() * keys.length);
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = keys[(start + attempt) % keys.length];
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          reasoning_effort: reasoningEffort,
          temperature,
          response_format: { type: 'json_object' },
          max_tokens: maxTokens,
          stream: false,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(240000),
      });
      if (!res.ok) {
        lastError = new Error(`groq ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
        const retryAfter = Number(res.headers.get('retry-after') || 0);
        await sleep((retryAfter > 0 ? retryAfter + 1 : 5) * 1000);
        continue;
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || '';
      const parsed = extractJson(content);
      if (!parsed) throw new Error('No JSON in groq response');
      return parsed;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) await sleep(5000);
    }
  }
  throw lastError;
}

async function omniroute(system, user, { temperature = 0, maxRetries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180000);
      try {
        const res = await fetch(`${OMNIROUTE_BASE_URL}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${OMNIROUTE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: OMNIROUTE_MODEL,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            temperature,
            stream: false,
          }),
        });
        if (!res.ok) throw new Error(`omniroute ${res.status}: ${await res.text().catch(() => '')}`);
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      lastError = err;
      // After all retries fail, fall back to direct Groq so the run survives
      // an omniroute outage instead of failing the whole automation pass.
      if (attempt === maxRetries) {
        try {
          const fallback = await groqFallback(system, user, temperature);
          if (fallback) {
            console.warn(`omniroute ${err.message.slice(0, 120)} — using Groq fallback`);
            return fallback;
          }
        } catch (fbErr) {
          lastError = new Error(`${err.message} | groq fallback: ${fbErr.message}`);
        }
      }
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  throw lastError;
}

function extractJson(raw) {
  const str = String(raw || '').trim();
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

async function omnirouteJson(system, user, opts) {
  const raw = await omniroute(system, user, opts);
  const parsed = extractJson(raw);
  if (!parsed) throw new Error(`No JSON in omniroute response: ${raw.slice(0, 200)}`);
  return parsed;
}

module.exports = {
  requireEnv,
  workerRequest,
  groqJson,
  omniroute,
  omnirouteJson,
  WORKER_URL,
  OMNIROUTE_BASE_URL,
  OMNIROUTE_MODEL,
};
