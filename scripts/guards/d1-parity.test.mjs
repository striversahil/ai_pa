// check-d1-parity.mjs — Guard 1: D1 shim registries cover every Prisma model.
//
// The live Worker never uses the real Prisma client: src/shared/d1-prisma.ts
// hand-maps models via BOOL/DATE/ID/UNIQUE/FLOAT_FIELDS + RELATIONS. A model
// (or field entry) missing from those registries silently misbehaves on D1.
// This guard fails on drift in EITHER direction:
//   schema model with no registry coverage  → FAIL (unless allowlisted)
//   registry key / RELATIONS ref with no schema model → FAIL (stale entry)
//   RELATIONS `model:` ref to an uncovered model → FAIL (dangling include)
//
// Models served by raw-SQL stores (custom table names the shim cannot map)
// are allowlisted with reasons — visible in output, not silent.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/d1-parity.test.mjs`
// Exit: 0 = parity, 1 = drift.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR } from './_bundle.mjs';

// Raw-SQL D1 stores with custom table names (auth_user, auth_session,
// chat_channel, …) that the model-name-based shim cannot serve. Each entry
// needs a reason; add new ones deliberately, never by default.
const ALLOWLIST = new Map([
  ['AuthUser', 'raw-SQL D1AuthStore (auth_user table)'],
  ['AuthSession', 'raw-SQL D1AuthStore (auth_session table)'],
  ['AuthScope', 'raw-SQL D1AuthStore (auth_scope table)'],
  ['AuthUserScope', 'raw-SQL D1AuthStore (auth_user_scope table)'],
  ['AuthRole', 'raw-SQL D1AuthStore (auth_role table)'],
  ['AuthRoleScope', 'raw-SQL D1AuthStore (auth_role_scope table)'],
  ['AuthUserRole', 'raw-SQL D1AuthStore (auth_user_role table)'],
  ['ChatChannel', 'raw-SQL chat store (chat_channel table)'],
  ['ChatMessage', 'raw-SQL chat store (chat_message table)'],
  ['ChatReadState', 'raw-SQL chat store (chat_read_state table)'],
  ['ChatMember', 'raw-SQL chat store (chat_member table)'],
]);

const REGISTRIES = ['BOOL_FIELDS', 'DATE_FIELDS', 'ID_FIELDS', 'UNIQUE_FIELDS', 'FLOAT_FIELDS', 'RELATIONS'];

function schemaModels() {
  const text = readFileSync(join(BACKEND_DIR, 'prisma', 'schema.prisma'), 'utf8');
  return [...text.matchAll(/^model (\w+)/gm)].map((m) => m[1]);
}

/** Top-level `  Model:` keys inside one `const NAME = { … };` block. */
function registryKeys(src, name) {
  const start = src.indexOf(`const ${name}`);
  assert.ok(start !== -1, `registry ${name} not found in d1-prisma.ts`);
  const end = src.indexOf('\n};', start);
  assert.ok(end !== -1, `registry ${name} block never closes`);
  const block = src.slice(start, end);
  const keys = [...block.matchAll(/^ {2}([A-Za-z_]\w*):/gm)].map((m) => m[1]);
  assert.ok(keys.length > 0, `registry ${name} parsed zero keys — regex rot?`);
  return keys;
}

function relationRefs(src) {
  return [...src.matchAll(/model: '(\w+)'/g)].map((m) => m[1]);
}

describe('d1-parity', () => {
  const models = schemaModels();
  const shimSrc = readFileSync(join(BACKEND_DIR, 'src', 'shared', 'd1-prisma.ts'), 'utf8');
  const covered = new Set(REGISTRIES.flatMap((r) => registryKeys(shimSrc, r)));

  it(`covers all ${models.length} schema models (or allowlists them)`, () => {
    const missing = models.filter((m) => !covered.has(m) && !ALLOWLIST.has(m));
    assert.deepEqual(missing, [], `models with NO shim coverage: ${missing.join(', ')} — register in d1-prisma.ts or allowlist with reason`);
  });

  it('has no stale registry keys (every key is a real schema model)', () => {
    const stale = [...covered].filter((k) => !models.includes(k));
    assert.deepEqual(stale, [], `stale registry keys (no such model): ${stale.join(', ')}`);
  });

  it('has no dangling RELATIONS refs', () => {
    const dangling = [...new Set(relationRefs(shimSrc))].filter((m) => !covered.has(m) && !ALLOWLIST.has(m));
    assert.deepEqual(dangling, [], `RELATIONS refs to uncovered models: ${dangling.join(', ')}`);
  });

  it('allowlist entries are all still unregistered (no dead entries)', () => {
    const dead = [...ALLOWLIST.keys()].filter((m) => covered.has(m));
    assert.deepEqual(dead, [], `allowlisted but now covered — drop from ALLOWLIST: ${dead.join(', ')}`);
  });

  it('prints coverage summary', () => {
    console.log(`   d1-parity: ${models.length} models, ${covered.size} shim-covered, ${ALLOWLIST.size} allowlisted (raw-SQL stores)`);
    for (const [m, reason] of ALLOWLIST) console.log(`     allowlist: ${m} — ${reason}`);
  });
});
