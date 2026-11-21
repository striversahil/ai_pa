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
 *   AI_KEYS             — unified gateway keys "provider:key:label,..."
 *                         (groq NEVER loaded — founder rule)
 *   OPENROUTER_API_KEY(S) / OPENROUTER_PAID_API_KEY /
 *   REQUESTLY_API_KEY(S) / DEEPSEEK_API_KEYS / TOGETHER_API_KEYS /
 *   OPENAI_API_KEYS — legacy per-provider vars, still merged
 *   GROQ_MODEL          — legacy override, ignored (groq never loads)
 *   GROQ_REASONING_EFFORT — legacy override, ignored (groq never loads)
 */

const WORKER_URL = process.env.WORKER_URL;
const SHARED_SECRET = process.env.SHARED_SECRET;

function requireEnv(names) {
  // names: explicit extra vars to require (e.g. ['WORKER_URL','SHARED_SECRET','LLM']).
  const required = names || ['WORKER_URL', 'SHARED_SECRET', 'LLM'];
  const missing = [];
  if (required.includes('WORKER_URL') && !WORKER_URL) missing.push('WORKER_URL');
  if (required.includes('SHARED_SECRET') && !SHARED_SECRET) missing.push('SHARED_SECRET');
  for (const n of required) {
    if (n !== 'WORKER_URL' && n !== 'SHARED_SECRET' && n !== 'LLM' && !process.env[n]) missing.push(n);
  }
  if (required.includes('LLM') && !GROQ_API_KEYS) {
    missing.push('GROQ_API_KEYS (comma-separated Groq keys — the only LLM path)');
  }
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

/** Comma-separated Groq keys read once at boot (the only LLM key source). */
const GROQ_API_KEYS = (process.env.GROQ_API_KEYS || '').trim();

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
const { getGateway, extractJson } = require('./ai-gateway');
const gateway = getGateway(process.env);

/**
 * Single AI endpoint (Worker-owned pool: env keys + Setting ai:providers).
 * Runners prefer POST /api/ai/complete so the 15+ BYOK keys live in ONE place
 * (Settings UI); local gateway stays as fallback during rollout / offline dev.
 */
async function aiComplete({ messages, temperature = 0.5, maxTokens, model, provider, sessionKey, timeoutMs, reasoningEffort, reasoningOff, json } = {}) {
  if (WORKER_URL && SHARED_SECRET) {
    try {
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
          ...(json ? { json: true } : {}),
        },
        timeoutMs: timeoutMs || 90000,
      });
      if (out && typeof out.content === 'string') return out.content;
      throw new Error('ai endpoint returned no content');
    } catch (e) {
      // Fall through to local gateway (env keys) — keeps old runners alive
      // when the Worker pool is unreachable or empty.
      if (!String((e && e.message) || '').includes('Authentication required')) {
        console.warn(`[runner-lib] /api/ai/complete failed, local fallback: ${String((e && e.message) || e).slice(0, 120)}`);
      } else throw e;
    }
  }
  const res = await gateway.complete({
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
  });
  return res.content;
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

// Single-gateway text completion — prefers the single endpoint (server
// pool), falls back to the local gateway like groqJson. No provider or model
// pin: the chain serves each provider's configured model.
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
  gateway,
  aiImage,
  WORKER_URL,
  GROQ_API_KEYS,
};
