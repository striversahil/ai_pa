// gateway-js-parity.test.mjs — Guard 4: JS gateway honors the same pool contract.
//
// scripts/ai-gateway.js is a hand-maintained port of src/shared/ai-gateway.ts
// (see gateway-pool.test.mjs for the TS side). Codegen was rejected (CF-only
// branches would ride along); instead this test locks the SHARED semantics on
// both implementations: provider detection, groq exclusion, sticky pin,
// strict fail-fast, 429 escalation, 401 disable, 10-min forgiveness.
// A behavior added to one side without the other fails here.
//
// Run: `node --test "scripts/guards/*.test.mjs"`
// Exit: 0 = parity, 1 = drift.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { KeyPool } = require(join(ROOT, 'scripts', 'ai-gateway.js'));

const AGNES_A = 'sk-agnes-key-aaaa-0001';
const AGNES_B = 'sk-agnes-key-bbbb-0002';
const OPENROUTER_A = 'sk-or-v1-openrouter-key-0003';

function poolWith(env) {
  const p = new KeyPool();
  p.loadFromEnv(env);
  return p;
}

describe('gateway-js-parity', () => {
  it('detects providers (gsk_/sk-or-*/sk-) and never loads groq', () => {
    const p = poolWith({
      AI_KEYS: `agnes:${AGNES_A}:primary,groq:gsk_drop_me,:${OPENROUTER_A}:auto,openrouter-paid:sk-or-paid-key-0004:paid`,
      GROQ_API_KEYS: 'gsk_legacy_drop_me',
    });
    const byProvider = {};
    for (const k of p.health()) byProvider[k.provider] = (byProvider[k.provider] || 0) + 1;
    assert.deepEqual(byProvider, { agnes: 1, openrouter: 1, 'openrouter-paid': 1 });
  });

  it('pins sessionKey deterministically and fails fast on strictPin exhaustion', () => {
    const p = poolWith({ AI_KEYS: `agnes:${AGNES_A}:a,agnes:${AGNES_B}:b` });
    const first = p.select('agnes', 'enquiry:chat:123:user@x');
    assert.equal(p.select('agnes', 'enquiry:chat:123:user@x').id, first.id);
    const or = poolWith({ OPENROUTER_API_KEYS: OPENROUTER_A });
    assert.equal(or.select('agnes', undefined, true), null);
    assert.equal(or.select('agnes').provider, 'openrouter');
  });

  it('disables on 401, escalates 429 cooldowns (120s→240s), rotates', () => {
    const p = poolWith({ AI_KEYS: `agnes:${AGNES_A}:a,agnes:${AGNES_B}:b` });
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
    const p = poolWith({ AI_KEYS: `agnes:${AGNES_A}:a,agnes:${AGNES_B}:b` });
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
    const p = poolWith({ AI_KEYS: `agnes:${AGNES_A}:a,agnes:${AGNES_B}:b` });
    p.keys[0].cooldownUntil = Date.now() + 60000;
    p.keys[1].enabled = false;
    assert.equal(p.select(), null);
    assert.ok(p.earliestCooldownMs() > 0);
  });
});
