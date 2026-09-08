#!/usr/bin/env node

/**
 * effort-sync-runner.js — every-15min telecalling effort sync.
 *
 * Thin GH Actions wrapper: POSTs the secret-gated
 * /api/runner/telecalling/effort-sync endpoint. The WORKER does the NeoDove
 * lead-call-log fetch itself (Cloudflare egress works; GH egress is blocked
 * by connect.neodove.com ~90% of the time) and persists per-day snapshots to
 * Setting `telecalling:effort:<YYYY-MM-DD>` for the snatch shield + Shield tab.
 *
 * Env: WORKER_URL, SHARED_SECRET.
 */

const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, '');
const SHARED_SECRET = process.env.SHARED_SECRET;

if (!WORKER_URL || !SHARED_SECRET) {
  console.error('Missing WORKER_URL / SHARED_SECRET');
  process.exit(1);
}

const res = await fetch(`${WORKER_URL}/api/runner/telecalling/effort-sync`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${SHARED_SECRET}`, 'Content-Type': 'application/json' },
  signal: AbortSignal.timeout(120000),
});
const text = await res.text();
console.log(`effort-sync -> HTTP ${res.status} ${text.slice(0, 500)}`);
if (!res.ok) process.exit(1);
const json = JSON.parse(text || '{}');
if (!json.ok) {
  // Fail-open by design (engine runs unshielded), but fail the step LOUDLY so
  // a dead NeoDove token pages us instead of silently disabling shields.
  console.error(`effort-sync not ok: ${json.error || 'unknown'}`);
  process.exit(1);
}
