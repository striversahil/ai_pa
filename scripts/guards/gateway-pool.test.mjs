// test-gateway-pool.mjs — Guard 3: AI gateway KeyPool unit tests.
//
// Locks the documented pool contract (AGENTS.md): groq never loaded,
// placeholders ignored, sticky sessionKey pin, strict-pin fail-fast,
// 429-cool + rotate (escalating), 401-disable, 10-min failure forgiveness.
// Pure in-memory behavior — no keys, no network, no Cloudflare.
//
// NOTE: importing ai-gateway.ts pulls logger → config, which calls
// process.exit(1) without production env. Dummy shape-valid env is set below
// BEFORE the dynamic import (config only validates shape, never dials out).
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/gateway-pool.test.mjs`
// Exit: 0 = contract holds, 1 = regression.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rmSync, mkdirSync } from 'node:fs';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'https://guard.invalid/db',
  LLM_API_KEY: 'guard-dummy',
  LLM_BASE_URL: 'https://guard.invalid/v1',
  LLM_MODEL: 'guard-model',
  EMAIL_IMAP_HOST: 'guard.invalid',
  EMAIL_USER: 'guard@invalid',
  EMAIL_PASSWORD: 'guard-dummy',
  NOTION_API_KEY: 'guard-dummy',
  NOTION_DATABASE_ID: 'guard-dummy',
  WA_ENGINE_API_KEY: 'guard-dummy',
});

let KeyPool;
let bundleDir;
before(async () => {
  // Bundle inside backend node_modules/.cache (git-ignored) with pino kept
  // external: esbuild cannot bundle pino's CJS dynamic require() under ESM,
  // and node resolves the bare import from the owning package at runtime.
  bundleDir = join(BACKEND_DIR, 'node_modules', '.cache', `guard-${process.pid}`);
  mkdirSync(bundleDir, { recursive: true });
  const mod = await import(bundleToFile(join(BACKEND_DIR, 'src', 'shared', 'ai-gateway.ts'), {
    external: ['pino', 'pino-pretty', 'dotenv'],
    // config/index.ts reads __dirname (absent in ESM scope) only to locate an
    // optional .env — point it at the void; dotenv then no-ops.
    define: { __dirname: '"/tmp/guard-void"' },
    outDir: bundleDir,
  }));
  KeyPool = mod.KeyPool;
  assert.ok(KeyPool, 'KeyPool export missing — gateway refactor moved it?');
});
after(() => {
  try { rmSync(bundleDir, { recursive: true, force: true }); } catch {}
});

const AGNES_A = 'sk-agnes-key-aaaa-0001';
const AGNES_B = 'sk-agnes-key-bbbb-0002';
const OPENROUTER_A = 'sk-or-v1-openrouter-key-0003';

function poolWith(env) {
  const p = new KeyPool();
  p.loadFromEnv(env);
  return p;
}

describe('gateway-pool', () => {
  it('loads AI_KEYS + legacy vars, never groq, ignores placeholders, dedupes reloads', () => {
    const p = poolWith({
      AI_KEYS: `agnes:${AGNES_A}:primary,groq:gsk_should_be_dropped,openrouter:${OPENROUTER_A}`,
      GROQ_API_KEYS: 'gsk_legacy_drop_me',
      AGNES_API_KEYS: `${AGNES_B},your_api_key_here,${AGNES_A}`,
    });
    const providers = p.health().map((k) => k.provider).sort();
    assert.deepEqual(providers, ['agnes', 'agnes', 'openrouter']);
    assert.ok(p.health().every((k) => k.enabled && k.failures === 0 && k.cooldownUntil === 0));
    const n = p.health().length;
    p.loadFromEnv({ AI_KEYS: `agnes:${AGNES_A}:primary` });
    assert.equal(p.health().length, n, 'reload duplicated keys');
  });

  it('returns null on an empty pool', () => {
    assert.equal(poolWith({}).select(), null);
  });

  it('pins a sessionKey deterministically (no mid-chat hopping)', () => {
    const p = poolWith({ AI_KEYS: `agnes:${AGNES_A}:a,agnes:${AGNES_B}:b` });
    const first = p.select('agnes', 'enquiry:chat:123:user@x');
    const second = p.select('agnes', 'enquiry:chat:123:user@x');
    assert.ok(first && second && first.id === second.id);
  });

  it('strictPin fails fast when the pinned provider has no healthy key', () => {
    const p = poolWith({ OPENROUTER_API_KEYS: OPENROUTER_A });
    assert.equal(p.select('agnes', undefined, true), null);
    const loose = p.select('agnes');
    assert.ok(loose && loose.provider === 'openrouter', 'loose pin should degrade across pool');
  });

  it('skips cooling and disabled keys', () => {
    const p = poolWith({ AI_KEYS: `agnes:${AGNES_A}:a,agnes:${AGNES_B}:b` });
    // NOTE: health() returns copies — mutate the live keys array directly.
    // (TS `private` is compile-time only.)
    p.keys[0].cooldownUntil = Date.now() + 60_000;
    p.keys[1].enabled = false;
    assert.equal(p.select(), null);
    p.keys[0].cooldownUntil = 0;
    assert.ok(p.select() && p.select().id === p.keys[0].id);
  });

  it('disables keys on 401 (no rotation for dead credentials)', () => {
    const p = poolWith({ AI_KEYS: `agnes:${AGNES_A}:a` });
    const k = p.select();
    const cd = p.reportFailure(k, Object.assign(new Error('HTTP 401: bad key'), { status: 401 }));
    assert.equal(cd, 0);
    assert.equal(k.enabled, false);
    assert.equal(p.select(), null);
  });

  it('cools 429 keys with escalation (120s → 240s) and rotates', () => {
    const p = poolWith({ AI_KEYS: `agnes:${AGNES_A}:a,agnes:${AGNES_B}:b` });
    const k = p.select();
    const cd1 = p.reportFailure(k, Object.assign(new Error('HTTP 429: slow down'), { status: 429 }));
    assert.equal(cd1, 120_000, 'failures=1 → 60s × 2^1');
    assert.ok(k.cooldownUntil > Date.now());
    const other = p.select();
    assert.ok(other && other.id !== k.id, 'must rotate to the healthy key');
    // Second 429 on the same key escalates.
    k.cooldownUntil = 0;
    const cd2 = p.reportFailure(k, Object.assign(new Error('HTTP 429 again'), { status: 429 }));
    assert.equal(cd2, 240_000, 'failures=2 → 60s × 2^2');
  });

  it('cools quota/5xx/network failures without disabling', () => {
    const p = poolWith({ AI_KEYS: `agnes:${AGNES_A}:a` });
    const k = p.select();
    assert.equal(p.reportFailure(k, Object.assign(new Error('HTTP 402: quota'), { status: 402 })), 300_000);
    assert.equal(k.enabled, true);
    assert.equal(p.reportFailure(k, Object.assign(new Error('HTTP 500: boom'), { status: 500 })), 0);
    assert.ok(k.cooldownUntil > Date.now(), '5s cooldown set');
    assert.equal(p.reportFailure(k, new Error('fetch failed: socket hang up')), 0);
    assert.ok(k.cooldownUntil > Date.now(), '2s cooldown set');
  });

  it('forgives failures older than 10 minutes (transient 429s rejoin)', () => {
    const p = poolWith({ AI_KEYS: `agnes:${AGNES_A}:a,agnes:${AGNES_B}:b` });
    const [ka, kb] = p.keys; // live refs — health() returns copies
    ka.failures = 3;
    ka.lastFailureAt = Date.now() - 11 * 60_000;
    kb.failures = 1;
    kb.lastFailureAt = Date.now();
    // Forgiven key (eff 0) outranks the recently-failed one (eff 1).
    assert.equal(p.select().id, ka.id);
  });

  it('reportSuccess resets failures and earliestCooldownMs tracks the pool', () => {
    const p = poolWith({ AI_KEYS: `agnes:${AGNES_A}:a` });
    const k = p.select();
    p.reportFailure(k, Object.assign(new Error('HTTP 429'), { status: 429 }));
    assert.ok(p.earliestCooldownMs() > 0);
    p.reportSuccess(k);
    assert.equal(k.failures, 0);
    assert.equal(k.lastError, null);
    assert.equal(k.successCount, 1);
  });
});
