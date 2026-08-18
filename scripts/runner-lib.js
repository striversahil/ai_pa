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

async function workerRequest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SHARED_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`worker ${method} ${path}: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
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
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function omnirouteJson(system, user, opts) {
  const raw = await omniroute(system, user, opts);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in omniroute response: ${raw.slice(0, 200)}`);
  return JSON.parse(match[0]);
}

module.exports = {
  requireEnv,
  workerRequest,
  omniroute,
  omnirouteJson,
  WORKER_URL,
  OMNIROUTE_BASE_URL,
  OMNIROUTE_MODEL,
};
