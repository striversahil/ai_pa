#!/usr/bin/env node
/**
 * scripts/agnes-relay-proxy.js — tiny GH-runner egress forwarder for Agnes API calls.
 *
 * Why it exists: Cloudflare Workers share egress IPs, and Agnes's firewall
 * rate-limits (HTTP 1015) that shared range. A home broadband IP has a clean,
 * unique reputation, so the same requests sail through.
 *
 * Zero dependencies (Node 20+ built-ins only). Request bodies are buffered
 * (15 MB cap); upstream responses are STREAMED back byte-for-byte, so SSE
 * (`stream: true`) chat works transparently.
 *
 * Security: allowlists apihub.agnes-ai.com ONLY, requires the shared
 * x-proxy-secret on every call, never logs keys or bodies.
 */
'use strict';
const http = require('http');

const UPSTREAM = 'https://apihub.agnes-ai.com';
const SECRET = String(process.env.PROXY_SECRET || '');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 15 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 55_000;

if (!SECRET) {
  console.error('[proxy] FATAL: PROXY_SECRET is empty — refusing to start');
  process.exit(1);
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer((req, res) => {
  // One-line per-request marker (method + path + status + ms only — never
  // headers or bodies, so keys can't leak). Lets relay-run logs prove which
  // lane served each call.
  const t0 = Date.now();
  res.on('finish', () => {
    console.log(`[proxy] ${req.method} ${req.url} -> ${res.statusCode} ${Date.now() - t0}ms`);
  });
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, upstream: UPSTREAM });
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end('{"error":"method not allowed"}');
  }
  if (req.headers['x-proxy-secret'] !== SECRET) {
    return send(res, 403, { error: 'forbidden' });
  }

  const chunks = [];
  let size = 0;
  let tooLarge = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { tooLarge = true; return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    if (tooLarge) return send(res, 413, { error: 'body too large' });
    const body = Buffer.concat(chunks);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
      const up = await fetch(UPSTREAM + req.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Forward the caller's auth; keep a browser-like UA (Agnes WAF
          // challenges bare datacenter/undici fingerprints).
          Authorization: String(req.headers['authorization'] || ''),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      // Pass upstream status through VERBATIM (including 429s — the Worker
      // gateway rotates keys on those). Stream the body back (SSE-safe).
      res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') || 'application/json' });
      if (!up.body) return res.end();
      const reader = up.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value)) await new Promise((r) => res.once('drain', r));
        }
      } finally {
        try { reader.releaseLock(); } catch {}
      }
      res.end();
    } catch (e) {
      // OUR failure (proxy/host down) — marked so the Worker falls through
      // to direct egress WITHOUT penalising the AI key.
      res.writeHead(502, { 'Content-Type': 'application/json', 'x-proxy-error': '1' });
      res.end(JSON.stringify({ proxyError: true, error: String((e && e.message) || e).slice(0, 200) }));
    }
  });
  req.on('error', () => { try { res.destroy(); } catch {} });
});

server.listen(PORT, () => console.log(`[proxy] listening on :${PORT} → ${UPSTREAM}`));
