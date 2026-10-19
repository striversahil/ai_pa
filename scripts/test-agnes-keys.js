#!/usr/bin/env node
/**
 * test-agnes-keys.mjs — per-key health probe for Agnes + paid-OpenRouter keys.
 *
 * Runs from CLEAN egress only (local machine or GH runner — NEVER from the
 * Cloudflare Worker, whose egress Agnes's WAF blocks). Sequential
 * max_tokens:1 pings so the test itself can't 429 the pool; reports per-key
 * ok/fail + latency. Prints key prefixes only — never key material.
 *
 * Sources: ../.env (AGNES_API_KEYS, OPENROUTER_PAID_API_KEY) or env.
 * Exit: 0 when every key answers, 1 otherwise.
 */

const fs = require('node:fs');
const path = require('node:path');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 25_000;
const GAP_MS = 1500;
const mask = (k) => `${String(k).slice(0, 6)}...(${String(k).length}ch)`;

function loadDotEnv() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* env-only mode */ }
}

async function ping({ url, key, body, extraHeaders = {}, label }) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const r = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Authorization: `Bearer ${key}`, ...extraHeaders },
      body: JSON.stringify(body),
    });
    const ms = Date.now() - start;
    const text = await r.text().catch(() => '');
    let ok = r.ok;
    let note = `HTTP ${r.status}`;
    try {
      const j = JSON.parse(text);
      if (j?.choices || j?.usage) { ok = r.ok; note = `HTTP ${r.status} + choices`; }
      else if (j?.error) { ok = false; note = `HTTP ${r.status} err=${String(j.error?.message ?? j.error?.code ?? JSON.stringify(j.error)).slice(0, 120)}`; }
    } catch { if (!r.ok) note = `HTTP ${r.status} ${text.slice(0, 120)}`; }
    return { label, ok, ms, note };
  } catch (e) {
    return { label, ok: false, ms: Date.now() - start, note: `network: ${String(e?.message ?? e).slice(0, 120)}` };
  } finally { clearTimeout(t); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  loadDotEnv();
  const agnesKeys = String(process.env.AGNES_API_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const paidKeys = String(process.env.OPENROUTER_PAID_API_KEY || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (agnesKeys.length === 0 && paidKeys.length === 0) {
    console.error('No AGNES_API_KEYS or OPENROUTER_PAID_API_KEY found (.env or env).');
    process.exit(2);
  }
  const results = [];
  console.log(`Probing ${agnesKeys.length} Agnes key(s) + ${paidKeys.length} paid-OR key(s) sequentially…`);
  for (let i = 0; i < agnesKeys.length; i++) {
    const r = await ping({
      url: 'https://apihub.agnes-ai.com/v1/chat/completions',
      key: agnesKeys[i],
      body: { model: 'agnes-3.0-flash', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, temperature: 0 },
      label: `agnes[${i + 1}] ${mask(agnesKeys[i])}`,
    });
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.label} ${r.ms}ms — ${r.note}`);
    results.push(r);
    await sleep(GAP_MS);
  }
  for (let i = 0; i < paidKeys.length; i++) {
    const r = await ping({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      key: paidKeys[i],
      body: { model: 'deepseek/deepseek-v4.1-flash', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, temperature: 0 },
      extraHeaders: { 'HTTP-Referer': 'https://founder-os.local', 'X-Title': 'founder-os key probe' },
      label: `openrouter-paid[${i + 1}] ${mask(paidKeys[i])}`,
    });
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.label} ${r.ms}ms — ${r.note}`);
    results.push(r);
    await sleep(GAP_MS);
  }
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} keys live.`);
  process.exit(fails.length ? 1 : 0);
})();
