/**
 * zoho-sync-session.test.mjs — the 15-min runner must never lose its session
 * to a stack overflow.
 *
 * 2026-11-27 incident: `zctx()` was `return _runtime || zctx()`. When the DB
 * instance was missing (no Zoho row in hlp_integration_instance, so
 * /api/runner/integrations/resolve answers 409) `_runtime` became `false` and
 * EVERY tick died with "Maximum call stack size exceeded" — sales-orders-today
 * swallowed it, fetchEstimatesAll was fatal, and the cause was never named.
 * The runner now falls back to the saved curl export (same file crm-runner
 * uses) and warns why.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const fetchPath = join(repo, 'scripts', 'zoho-sync', 'fetch.js');
const credPath = join(repo, 'scripts', 'zoho-sync', 'credentials.js');
const source = readFileSync(fetchPath, 'utf8');
const require = createRequire(import.meta.url);

test('session resolution never calls itself', () => {
  assert.ok(!/return _runtime \|\| zctx\(\)/.test(source), 'zctx() recurses again');
  assert.match(source, /function zctx\(\) \{ return _runtime \|\| zohoContext\(\); \}/);
  assert.match(source, /_runtime = zohoContext\(\);/, 'the export fallback is gone');
  assert.match(source, /using the saved curl export/, 'the fallback must say why');
  assert.match(source, /sessionSource/, 'the source must be reportable');
});

test('no DB instance still yields a usable export context', () => {
  const cred = require(credPath);
  const original = cred.resolveZohoRuntime;
  cred.resolveZohoRuntime = async () => null;
  try {
    const fetchMod = require(fetchPath);
    let ctx;
    assert.doesNotThrow(() => { ctx = fetchMod.zohoContext(); });
    assert.equal(typeof ctx.url, 'string');
    assert.match(ctx.url, /organization_id=\d+/);
    assert.ok(Array.isArray(ctx.orgIds) && ctx.orgIds.length > 0);
    assert.ok(ctx.headers && Object.keys(ctx.headers).length > 0, 'export headers missing');
  } finally {
    cred.resolveZohoRuntime = original;
    delete require.cache[require.resolve(fetchPath)];
  }
});
