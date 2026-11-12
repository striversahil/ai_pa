// master-data-core-parity.test.mjs — Guard: the Phase 3a customer-display flip.
//
// The flip serves the dashboard payload from `core_customer` when the
// `masterdata:readCore` Setting is on, with legacy fallback on any mismatch.
// This guard locks the three invariants the flip depends on (text-level, so it
// runs anywhere with zero deps):
//   backend  → src/modules/master-data/store.ts   (LIST_COLUMNS + core reader)
//   backend  → src/modules/master-data/service.ts  (flag + fallback)
//   backend  → src/modules/core/customers.ts       (MIRROR_COLUMNS — read truth)
//   backend  → src/worker/routes/master-data.ts    (manager-only flip route)
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR } from './_bundle.mjs';

const store = readFileSync(join(BACKEND_DIR, 'src', 'modules', 'master-data', 'store.ts'), 'utf8');
const service = readFileSync(join(BACKEND_DIR, 'src', 'modules', 'master-data', 'service.ts'), 'utf8');
const readSource = readFileSync(join(BACKEND_DIR, 'src', 'modules', 'master-data', 'read-source.ts'), 'utf8');
const core = readFileSync(join(BACKEND_DIR, 'src', 'modules', 'core', 'customers.ts'), 'utf8');
const routes = readFileSync(join(BACKEND_DIR, 'src', 'worker', 'routes', 'master-data.ts'), 'utf8');

function quotedList(src, name) {
  const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`));
  assert.ok(m, `${name} array not found`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('master-data core flip contract', () => {
  it('every legacy LIST_COLUMNS column exists in the core mirror', () => {
    const legacy = quotedList(store, 'LIST_COLUMNS');
    const mirror = new Set(quotedList(core, 'MIRROR_COLUMNS'));
    assert.ok(legacy.length > 20, 'expected a real column list');
    for (const col of legacy) {
      assert.ok(mirror.has(col), `core_customer is missing legacy column: ${col}`);
    }
  });

  it('core reader excludes DELETED tombstones (legacy hard-deletes rows)', () => {
    assert.ok(store.includes('listAllCustomersCore'), 'missing listAllCustomersCore');
    assert.ok(store.includes("`(\"status\" IS NULL OR \"status\" <> 'DELETED')`") ||
      store.includes(`"status" <> 'DELETED'`),
      'core reader must filter DELETED tombstones to match legacy semantics');
    assert.ok(store.includes('core_customer'), 'core reader must query core_customer');
  });

  it('flag defaults OFF and the payload falls back to legacy', () => {
    assert.ok(readSource.includes('MASTER_READ_CORE_KEY'), 'missing flip flag key');
    assert.ok(readSource.includes('return false'), 'flag read must default OFF on error');
    assert.ok(readSource.includes('listAllCustomersCore()'), 'read-source must try core when on');
    assert.ok(readSource.includes('serving legacy'), 'read-source must fall back to legacy on mismatch/error');
    assert.ok(service.includes('readBookRows()'), 'payload compute must read through the guarded switch');
  });

  it('flip route is manager-only and busts the cache', () => {
    assert.ok(routes.includes("app.put('/api/master-data/read-source'"), 'missing flip route');
    assert.ok(routes.includes('requireManager'), 'flip route must be manager-only');
    assert.ok(routes.includes('setMasterReadCore'), 'route must use the service flip');
    assert.ok(routes.includes('invalidateMasterDataCache'), 'flip must bust the payload cache');
  });
});
