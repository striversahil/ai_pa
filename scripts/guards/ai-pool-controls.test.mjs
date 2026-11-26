// test-ai-pool-controls.mjs — Guard: AI key/provider switches + health scoring.
//
// Locks the 2026-11-27 feature contract:
//   · Setting providers[].enabled / keys[].enabled are PURE FILTERS — a
//     disabled key/provider is never selected, but nothing is deleted.
//   · keyFingerprintId is the ONE public id used by pool + telemetry.
//   · scoreKeyHealth weights (reliability .5 / speed .3 / throughput .2),
//     TTFT band, tps target, and the at-risk/critical bands.
//   · parseAiHealthConfig clamps junk and honours autoDisable:false.
//   · the JS gateway port (runners) honours the same switches.
//
// Run: node --test "scripts/guards/*.test.mjs"  (pure, no network)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rmSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { BACKEND_DIR, REPO_ROOT, bundleToFile } from './_bundle.mjs';

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

let mod;
let JsPool;
let bundleDir;
before(async () => {
  bundleDir = join(BACKEND_DIR, 'node_modules', '.cache', `guard-ai-controls-${process.pid}`);
  mkdirSync(bundleDir, { recursive: true });
  mod = await import(bundleToFile(join(BACKEND_DIR, 'src', 'shared', 'ai-gateway.ts'), {
    external: ['pino', 'pino-pretty', 'dotenv'],
    define: { __dirname: '"/tmp/guard-void"' },
    outDir: bundleDir,
  }));
  const require = createRequire(import.meta.url);
  JsPool = require(join(REPO_ROOT, 'scripts', 'ai-gateway.js')).KeyPool;
});
after(() => {
  try { rmSync(bundleDir, { recursive: true, force: true }); } catch {}
});

const A = 'sk-free-key-aaaa-0001';
const B = 'sk-free-key-bbbb-0002';

function pool(keys, providerEnabled = true) {
  const p = new mod.KeyPool();
  p.registerProvider('free1', 'https://free.invalid/v1', 'm', keys, providerEnabled);
  return p;
}

describe('key/provider switches', () => {
  it('exposes one stable fingerprint id for pool + telemetry', () => {
    const p = pool([{ key: A }]);
    assert.equal(p.health()[0].id, mod.keyFingerprintId('free1', A));
    assert.match(p.health()[0].id, /^free1:sk-fre\.\.\.0001$/);
  });

  it('never selects a key stored with enabled:false, and re-enables it', () => {
    const p = pool([{ key: A, enabled: false }, { key: B }]);
    const picked = new Set();
    for (let i = 0; i < 8; i++) picked.add(p.select()?.key);
    assert.deepEqual([...picked], [B]);
    // Re-registering with enabled:true restores the SAME key object.
    p.registerProvider('free1', 'https://free.invalid/v1', 'm', [{ key: A, enabled: true }, { key: B }]);
    assert.ok([A, B].includes(p.select().key)); // both eligible again
    assert.equal(p.health().length, 2);
    assert.equal(p.health().find((k) => k.id.endsWith('0001')).allowed, true);
  });

  it('does not reset runtime health when the same key is re-registered', () => {
    const p = pool([{ key: A }]);
    p.reportSuccess(p.select());
    p.reportFailure(p.select(), Object.assign(new Error('HTTP 429'), { status: 429 }));
    const before = p.health()[0].failures;
    p.registerProvider('free1', 'https://free.invalid/v1', 'm', [{ key: A, label: 'renamed' }]);
    assert.equal(p.health()[0].failures, before);
  });

  it('provider enabled:false removes every key from selection until re-enabled', () => {
    const p = pool([{ key: A }, { key: B }], false);
    assert.equal(p.select(), null);
    p.registerProvider('free1', 'https://free.invalid/v1', 'm', [{ key: A }, { key: B }], true);
    assert.ok(p.select());
  });

  it('quarantines a whole provider on HTTP 404 and clears on re-enable', () => {
    const p = pool([{ key: A }]);
    const key = p.select();
    p.reportFailure(key, Object.assign(new Error('HTTP 404: no longer available'), { status: 404 }));
    assert.equal(p.select(), null);
    p.setProviderEnabled('free1', true);
    assert.ok(p.select());
  });

  it('JS runner port honours the same switches', () => {
    const p = new JsPool();
    p.registerProvider('free1', 'https://free.invalid/v1', 'm', [{ key: A, enabled: false }, { key: B }]);
    assert.equal(p.select().key, B);
    p.registerProvider('free1', 'https://free.invalid/v1', 'm', [{ key: A }, { key: B }], false);
    assert.equal(p.select(), null);
    p.setProviderEnabled('free1', true);
    assert.ok(p.select());
  });
});

describe('failover contract', () => {
  it('ships a live OpenRouter default, never a retired slug', () => {
    assert.match(mod.OPENROUTER_TEXT_MODEL, /^nvidia\//);
    assert.notEqual(mod.OPENROUTER_TEXT_MODEL, 'inclusionai/ling-3.0-flash-sante:free');
    const js = readFileSync(join(REPO_ROOT, 'scripts', 'ai-gateway.js'), 'utf8');
    assert.ok(js.includes(mod.OPENROUTER_TEXT_MODEL), 'JS runner port must mirror the TS default model');
  });

  it('rotates immediately on failure and enforces a first-token deadline', () => {
    const io = readFileSync(join(BACKEND_DIR, 'src', 'shared', 'ai-gateway-parts', 'io.ts'), 'utf8');
    assert.match(io, /first-token timeout/);
    assert.match(io, /immediate failover/);
    // No sleeping between keys: the next API is tried at once.
    assert.doesNotMatch(io, /await sleep\(/);
  });
});

const fast = { ok: true, ttftMs: 400, totalMs: 1000, completionTokens: 50, streamed: true };

describe('health scoring', () => {
  it('scores no samples as healthy 100 (a new key is usable)', () => {
    const h = mod.scoreKeyHealth([]);
    assert.equal(h.score, 100);
    assert.equal(h.samples, 0);
    assert.equal(h.status, 'healthy');
  });

  it('perfect fast streamed calls score 100', () => {
    const h = mod.scoreKeyHealth([fast, fast, fast, fast, fast]);
    assert.equal(h.score, 100);
    assert.equal(h.avgTps, 50);
    assert.equal(h.samples, 5);
  });

  it('five auth failures collapse below the disable threshold', () => {
    const bad = { ok: false, errorKind: 'auth', totalMs: 300 };
    const h = mod.scoreKeyHealth([bad, bad, bad, bad, bad]);
    assert.equal(h.reliability, 0);
    assert.ok(h.score < 40, `auth failures must be critical, got ${h.score}`);
    assert.equal(h.status, 'critical');
    assert.equal(h.critical, true);
  });

  it('one timeout among five successes stays healthy', () => {
    const h = mod.scoreKeyHealth([fast, fast, fast, fast, { ok: false, errorKind: 'timeout', totalMs: 9000 }]);
    assert.equal(h.reliability, 86);
    assert.ok(h.score >= 60, `transient error must not disable, got ${h.score}`);
    assert.equal(h.status, 'healthy');
  });

  it('slow TTFT + low TPS lands in the at-risk band', () => {
    const slow = { ok: true, ttftMs: 6000, totalMs: 8000, completionTokens: 40, streamed: true };
    const h = mod.scoreKeyHealth([slow, slow, slow, slow, slow]);
    assert.equal(h.speed, 0);
    assert.equal(h.throughput, 13);
    assert.ok(h.score >= 40 && h.score < 60, `expected at_risk, got ${h.score}`);
    assert.equal(h.status, 'at_risk');
  });

  it('non-streamed calls use neutral speed and still measure throughput', () => {
    const h = mod.scoreKeyHealth([{ ok: true, totalMs: 1000, completionTokens: 40 }]);
    assert.equal(h.speed, 70);
    assert.equal(h.throughput, 100);
    assert.equal(h.avgTtftMs, null);
  });
});

describe('health config', () => {
  it('defaults are the documented thresholds', () => {
    assert.deepEqual(mod.DEFAULT_AI_HEALTH, {
      threshold: 40, atRisk: 60, minSamples: 5, tpsTarget: 40,
      ttftGoodMs: 800, ttftBadMs: 5000, autoDisable: true,
    });
  });

  it('clamps junk and keeps atRisk above threshold', () => {
    const c = mod.parseAiHealthConfig('{"threshold":90,"atRisk":10,"minSamples":0,"ttftGoodMs":9000,"ttftBadMs":100}');
    assert.equal(c.threshold, 90);
    assert.ok(c.atRisk > c.threshold);
    assert.equal(c.minSamples, 1);
    assert.ok(c.ttftBadMs > c.ttftGoodMs);
  });

  it('honours observe-only and survives bad JSON', () => {
    assert.equal(mod.parseAiHealthConfig('{"autoDisable":false}').autoDisable, false);
    assert.deepEqual(mod.parseAiHealthConfig('not-json'), mod.DEFAULT_AI_HEALTH);
  });
});
