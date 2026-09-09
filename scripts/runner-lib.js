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
 *   GROQ_API_KEYS       — comma-separated Groq keys, randomly rotated per call
 *                         (PRIMARY LLM path for every AI runner)
 *   GROQ_MODEL          — override (default: openai/gpt-oss-120b)
 *   GROQ_REASONING_EFFORT — override (default: high)
 *   OMNIROUTE_BASE_URL  — legacy gateway, kept as FALLBACK only
 *   OMNIROUTE_API_KEY   — legacy gateway key (fallback only)
 *   OMNIROUTE_MODEL     — legacy model name (default: groq/openai/gpt-oss-120b)
 */

const WORKER_URL = process.env.WORKER_URL;
const SHARED_SECRET = process.env.SHARED_SECRET;
const OMNIROUTE_BASE_URL = (process.env.OMNIROUTE_BASE_URL || '').replace(/\/$/, '');
const OMNIROUTE_API_KEY = process.env.OMNIROUTE_API_KEY;
const OMNIROUTE_MODEL = process.env.OMNIROUTE_MODEL || 'groq/openai/gpt-oss-120b';

function requireEnv(names) {
  // names: explicit extra vars to require (e.g. ['WORKER_URL','SHARED_SECRET','LLM']).
  // 'LLM' accepts EITHER direct-Groq (primary) or omniroute (legacy fallback).
  const required = names || ['WORKER_URL', 'SHARED_SECRET', 'LLM'];
  const missing = [];
  if (required.includes('WORKER_URL') && !WORKER_URL) missing.push('WORKER_URL');
  if (required.includes('SHARED_SECRET') && !SHARED_SECRET) missing.push('SHARED_SECRET');
  for (const n of required) {
    if (n !== 'WORKER_URL' && n !== 'SHARED_SECRET' && n !== 'LLM' && !process.env[n]) missing.push(n);
  }
  if (required.includes('LLM')) {
    const hasGroq = !!(process.env.GROQ_API_KEYS || '').trim();
    const hasOmni = !!(OMNIROUTE_BASE_URL && OMNIROUTE_API_KEY);
    if (!hasGroq && !hasOmni) missing.push('GROQ_API_KEYS (or OMNIROUTE_BASE_URL + OMNIROUTE_API_KEY fallback)');
  }
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
 * AI layer — routed through the unified AiGateway (scripts/ai-gateway.js),
 * which owns the key pool, rotation, retry, rate-limit cooldowns and
 * multi-provider support. runner-lib just exposes the two shapes the runners
 * already use: groq(system, user) → text, groqJson(system, user) → parsed JSON.
 *
 * The gateway is configured once from process.env; every call after picks the
 * healthiest key, rotates on 429/5xx, and respects cooldowns. Legacy omniroute
 * stays as the final fallback (gateway tries direct providers first).
 */
const { getGateway } = require('./ai-gateway');
const gateway = getGateway(process.env);

async function groq(system, user, { temperature = 0.5, maxTokens } = {}) {
  const res = await gateway.complete({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    ...(maxTokens ? { maxTokens } : {}),
  });
  return res.content;
}

async function groqJson(system, user, { temperature = 0, maxTokens } = {}) {
  return gateway.completeJson({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    ...(maxTokens ? { maxTokens } : {}),
    json: true,
  });
}

// Legacy omniroute wrappers are retained for any runner that still imports
// them, but they now delegate to the gateway (which only reaches omniroute
// when no direct provider key is configured).
async function omniroute(system, user, { temperature = 0 } = {}) {
  return groq(system, user, { temperature });
}

async function omnirouteJson(system, user, opts = {}) {
  return groqJson(system, user, opts);
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

module.exports = {
  requireEnv,
  workerRequest,
  groq,
  groqJson,
  omniroute,
  omnirouteJson,
  extractJson,
  gateway,
  WORKER_URL,
  OMNIROUTE_BASE_URL,
  OMNIROUTE_MODEL,
};
