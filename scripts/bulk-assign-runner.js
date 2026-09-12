#!/usr/bin/env node

/**
 * bulk-assign-runner.js — one-shot MIS enforcement of agent_assigned_mapping.json.
 *
 * Reads the desired name -> [EST-numbers] mapping from the repo root, resolves
 * agent names to telecaller ids via the public telecalling dashboard endpoint,
 * diffs against LIVE holdings (fetched fresh), and POSTs only the needed moves
 * to POST /api/runner/estimates/bulk-assign (Bearer SHARED_SECRET).
 *
 * Rules (founder-confirmed):
 *   - "Samarth" entries are skipped (nobody by that name holds anything).
 *   - Agents NOT in the mapping (e.g. Muskan) keep whatever they hold, EXCEPT
 *     estimates the mapping claims for someone else (those move).
 *   - Live holdings absent from the mapping stay exactly where they are.
 *   - Samarjeet is flipped back to a follow-up specialist (assignEstimateFollowUps).
  *   - One-time assign: no locks, no score penalties. Red holdings still cost
  *     −10 at tonight's EOD remark run (re-poaching is OFF).
 *
 * Env: WORKER_URL, SHARED_SECRET.
 * Safety: DRY_RUN=1 prints the move list without POSTing anything.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, '');
const SHARED_SECRET = process.env.SHARED_SECRET;
const DRY_RUN = process.env.DRY_RUN === '1';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!WORKER_URL || !SHARED_SECRET) {
  console.error('Missing WORKER_URL / SHARED_SECRET');
  process.exit(1);
}

async function workerRequest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${SHARED_SECRET}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`worker ${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function publicGet(path) {
  const res = await fetch(`${WORKER_URL}${path}`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`public GET ${path}: HTTP ${res.status}`);
  return res.json();
}

const mapping = JSON.parse(readFileSync(join(ROOT, 'agent_assigned_mapping.json'), 'utf8'));
const SKIP_AGENTS = new Set(['Samarth']);

// Name -> telecaller id from the live roster.
const team = await publicGet('/api/automations/telecalling/data');
const agents = team?.meta?.agents ?? [];
const idByName = new Map(agents.map((a) => [String(a.name).toLowerCase(), a.id]));
for (const name of Object.keys(mapping)) {
  if (SKIP_AGENTS.has(name)) continue;
  if (!idByName.has(name.toLowerCase())) {
    console.error(`Roster has no agent named "${name}" — aborting (refusing to guess ids)`);
    process.exit(1);
  }
}

// Live holder per estimate number (all roster agents, fresh reads).
const holder = new Map(); // EST-number -> telecallerId
for (const a of agents) {
  const view = await publicGet(`/api/automations/telecalling/data?agent=${encodeURIComponent(a.id)}`);
  for (const f of view?.followUps ?? []) {
    if (f?.estimateNumber) holder.set(f.estimateNumber, a.id);
  }
}

const moves = [];
for (const [name, numbers] of Object.entries(mapping)) {
  if (SKIP_AGENTS.has(name)) {
    console.log(`skip agent "${name}" (${numbers.length} entries left untouched)`);
    continue;
  }
  const targetId = idByName.get(name.toLowerCase());
  for (const num of numbers) {
    const liveHolder = holder.get(num) ?? null;
    if (liveHolder === targetId) continue; // already correct
    moves.push({ estimateNumber: num, telecallerId: targetId });
  }
}

const samarjeetId = idByName.get('samarjeet') ?? null;
console.log(`moves needed: ${moves.length}`);
console.log(`samarjeet follow-up flip: ${samarjeetId ?? 'NOT FOUND'}`);

if (DRY_RUN) {
  for (const m of moves) console.log(`  DRY ${m.estimateNumber} -> ${m.telecallerId.slice(0, 8)}`);
  console.log('DRY_RUN=1 — nothing POSTed');
  process.exit(0);
}

const result = await workerRequest('/api/runner/estimates/bulk-assign', {
  method: 'POST',
  body: {
    moves,
    followUpAgents: samarjeetId ? [samarjeetId] : [],
    reason: 'MIS bulk mapping enforcement (agent_assigned_mapping.json)',
  },
});
console.log(JSON.stringify({
  movedCount: result.movedCount,
  skipped: result.skipped,
  flagsUpdated: result.flagsUpdated,
  errors: result.errors,
}, null, 1));
if (!result.ok || (result.errors ?? []).length > 0) process.exit(1);
console.log('bulk assign complete');
