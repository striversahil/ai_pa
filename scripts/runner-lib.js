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
 *   AI keys             — NEVER read here. The pool lives ONLY in Setting
 *                         `ai:providers` (root-managed Settings UI); every AI
 *                         call goes through POST /api/ai/complete.
 */

const WORKER_URL = process.env.WORKER_URL;
const SHARED_SECRET = process.env.SHARED_SECRET;

function requireEnv(names) {
  // names: explicit extra vars to require (e.g. ['WORKER_URL','SHARED_SECRET','LLM']).
  const required = names || ['WORKER_URL', 'SHARED_SECRET'];
  const missing = [];
  if (required.includes('WORKER_URL') && !WORKER_URL) missing.push('WORKER_URL');
  if (required.includes('SHARED_SECRET') && !SHARED_SECRET) missing.push('SHARED_SECRET');
  for (const n of required) {
    if (n !== 'WORKER_URL' && n !== 'SHARED_SECRET' && !process.env[n]) missing.push(n);
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
 * AI layer — ALWAYS POST /api/ai/complete on the Worker. The pool lives ONLY
 * in Setting `ai:providers` (root-managed Settings UI); runners hold no AI
 * keys and never load env key variables (founder decision 2026-11-27).
 * runner-lib exposes the shapes the runners already use: groq(system, user)
 * → text, groqJson(system, user) → parsed JSON.
 */
const { extractJson } = require('./ai-gateway');

/** Single AI endpoint (Worker-owned, Settings-only pool). Fails loudly when
 *  the Worker is unreachable — there is NO env-key fallback by design. */
async function aiComplete({ messages, temperature = 0.5, maxTokens, model, provider, sessionKey, timeoutMs, reasoningEffort, reasoningOff, json } = {}) {
  if (!WORKER_URL || !SHARED_SECRET) {
    throw new Error('AI requires WORKER_URL and SHARED_SECRET — the key pool is managed in Settings, not runner env');
  }
  const out = await workerRequest('/api/ai/complete', {
    method: 'POST',
    body: {
      messages,
      temperature,
      ...(maxTokens ? { maxTokens } : {}),
      ...(model ? { model } : {}),
      ...(provider ? { provider } : {}),
      ...(sessionKey ? { sessionKey } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(reasoningOff ? { reasoningOff } : {}),
      ...(json ? { json: true } : {}),
    },
    timeoutMs: timeoutMs || 90000,
  });
  if (out && typeof out.content === 'string') return out.content;
  throw new Error('ai endpoint returned no content');
}

async function groq(system, user, { temperature = 0.5, maxTokens, reasoningEffort, reasoningOff, timeoutMs } = {}) {
  return aiComplete({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    ...(maxTokens ? { maxTokens } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(reasoningOff ? { reasoningOff } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

// Single-gateway text completion — always the Worker endpoint (server pool).
// No provider or model pin: the chain serves each provider's configured model.
async function aiText(system, user, { temperature = 0.5, maxTokens, reasoningEffort, reasoningOff, timeoutMs, sessionKey } = {}) {
  return aiComplete({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    ...(maxTokens ? { maxTokens } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(reasoningOff ? { reasoningOff } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(sessionKey ? { sessionKey } : {}),
  });
}

async function groqJson(system, user, { temperature = 0, maxTokens, reasoningEffort, reasoningOff, timeoutMs } = {}) {
  const text = await aiComplete({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    ...(maxTokens ? { maxTokens } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(reasoningOff ? { reasoningOff } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    json: true,
  });
  try { return JSON.parse(text); } catch { return extractJson(text); }
}

/**
 * aiImage(prompt) → base64 PNG (no data-URI prefix) via kie.ai GPT-Image-2.5.
 * Explainer-diagram / carousel style only — the CALLER owns the
 * must-never-depict rules (no machines, sites, people). Throws when
 * KIE_API_KEY is unset (text batch continues imageless).
 */
const { kieImage } = require('./kie-image');

async function aiImage(prompt) {
  return kieImage(prompt);
}

// extractJson is re-exported from the gateway (single implementation —
// previously copy-pasted here and in ai-gateway.js).

module.exports = {
  requireEnv,
  workerRequest,
  aiComplete,
  groq,
  groqJson,
  aiText,
  extractJson,
  aiImage,
  WORKER_URL,
};
