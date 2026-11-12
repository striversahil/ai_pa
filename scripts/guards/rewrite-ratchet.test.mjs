// scripts/guards/rewrite-ratchet.test.mjs — duplication + boundary ratchet.
//
// Copied from the founder-os-codekeeper skill. Runs with the existing guard
// suite (`node --test "scripts/guards/*.test.mjs"`, .github/workflows/guards.yml).
// Fails when any metric in scripts/guards/rewrite-baseline.json GROWS.
// After a cleanup lowers a number, refresh the floor:
//   node scripts/dup-audit.mjs . --write-baseline scripts/guards/rewrite-baseline.json
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

test('duplication/boundary metrics never grow (ratchet)', () => {
  let out = '';
  try {
    out = execFileSync('node', [join(root, 'scripts', 'dup-audit.mjs'), root, '--check', join(here, 'rewrite-baseline.json')], { encoding: 'utf8' });
  } catch (e) {
    assert.fail(`ratchet regression:\n${e.stdout ?? ''}${e.stderr ?? ''}`);
  }
  assert.match(out, /ratchet ok/);
});
