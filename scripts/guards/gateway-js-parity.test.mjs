// gateway-js-parity.test.mjs — Guard 4: JS runner helpers keep the pool contract.
//
// scripts/ai-gateway.js is now a small helper/pool port (runtime AI goes
// through POST /api/ai/complete; Setting `ai:providers` is the only source).
// This test locks the shared in-memory semantics: sticky pin, strategy
// rotation, 429 escalation, 401 disable, 10-min forgiveness, no env loader.
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { KeyPool } = require(join(ROOT, 'scripts', 'ai-gateway.js'));

const FREE_A = 'sk-free-key-aaaa-0001';
const FREE_B = 'sk-free-key-bbbb-0002';

function poolWith(keys, provider = 'free1') {
  const p = new KeyPool();
  p.registerProvider(provider, 'https://free.invalid/v1', 'm', keys);
  return p;
}

describe('gateway-js-parity', () => {
  it('has no env-key loader and no local HTTP gateway', () => {
    const js = readFileSync(join(ROOT, 'scripts', 'ai-gateway.js'), 'utf8');
    assert.doesNotMatch(js, /loadFromEnv|AI_KEYS|OPENROUTER|getGateway/);
  });

  it('pins sessionKey deterministically; unknown provider degrades across pool', () => {
    const p = poolWith([{ key: FREE_A }, { key: FREE_B }]);
    const first = p.select('free1', 'enquiry:chat:123:user@x');
    assert.equal(p.select('free1', 'enquiry:chat:123:user@x').id, first.id);
    assert.equal(p.select('other').provider, 'free1');
  });

  it('disables on 401, escalates 429 cooldowns (120s→240s), rotates', () => {
    const p = poolWith([{ key: FREE_A }, { key: FREE_B }]);
    const k = p.select();
    assert.equal(p.reportFailure(k, Object.assign(new Error('HTTP 401'), { status: 401 })), 0);
    assert.equal(k.enabled, false);
    const k2 = p.select();
    assert.notEqual(k2.id, k.id);
    assert.equal(p.reportFailure(k2, Object.assign(new Error('HTTP 429'), { status: 429 })), 120000);
    k2.cooldownUntil = 0;
    assert.equal(p.reportFailure(k2, Object.assign(new Error('HTTP 429'), { status: 429 })), 240000);
  });

  it('forgives >10min-old failures and resets on success', () => {
    const p = poolWith([{ key: FREE_A }, { key: FREE_B }]);
    p.keys[0].failures = 3;
    p.keys[0].lastFailureAt = Date.now() - 11 * 60 * 1000;
    p.keys[1].failures = 1;
    p.keys[1].lastFailureAt = Date.now();
    assert.equal(p.select().id, p.keys[0].id);
    p.reportSuccess(p.keys[1]);
    assert.equal(p.keys[1].failures, 0);
    assert.equal(p.keys[1].successCount, 1);
  });

  it('skips cooling/disabled keys and tracks earliestCooldownMs', () => {
    const p = poolWith([{ key: FREE_A }, { key: FREE_B }]);
    p.keys[0].cooldownUntil = Date.now() + 60000;
    p.keys[1].enabled = false;
    assert.equal(p.select(), null);
    assert.ok(p.earliestCooldownMs() > 0);
  });
});
