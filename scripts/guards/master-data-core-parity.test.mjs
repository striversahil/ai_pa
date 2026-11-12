// master-data-core-parity.test.mjs — Guard: the customer collapse (0136).
//
// Collapse 0136 made MasterCustomer BECOME core_customer: one table, no
// mirror, no flip flag. This guard locks the end state (text-level, so it
// runs anywhere with zero deps):
//   backend  → src/modules/master-data/store.ts   (single-table reads + tombstone writes)
//   backend  → migration 0136                      (RENAME + unification cols + bridge)
//   backend  → no `MasterCustomer` SQL table refs in unlocked code
//              (locked modules/core/* excluded — human re-sign removes it;
//               migrations/ history excluded — it records the rename itself)
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR } from './_bundle.mjs';

const SRC = join(BACKEND_DIR, 'src');
const store = readFileSync(join(SRC, 'modules', 'master-data', 'store.ts'), 'utf8');
const service = readFileSync(join(SRC, 'modules', 'master-data', 'service.ts'), 'utf8');
const migration = readFileSync(join(BACKEND_DIR, 'migrations', '0136_customer_collapse.sql'), 'utf8');

function unlockedTsFiles(dir, out = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (p.includes(`${'/'}modules${'/'}core`)) continue; // locked — human re-signs
      unlockedTsFiles(p, out);
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

describe('customer collapse contract (0136)', () => {
  it('no legacy MasterCustomer SQL table refs in unlocked code', () => {
    const bad = [];
    for (const f of unlockedTsFiles(SRC)) {
      const s = readFileSync(f, 'utf8');
      if (/(FROM|INTO|UPDATE|TABLE)\s+MasterCustomer\b/.test(s)) bad.push(f);
    }
    assert.deepEqual(bad, [], `legacy table refs remain: ${bad.join(', ')}`);
  });

  it('book reads hit the unified table with tombstones excluded', () => {
    assert.ok(store.includes('LIVE_WHERE'), 'missing tombstone predicate');
    for (const fn of ['listAllCustomers', 'getCustomerRow', 'listCustomerIds', 'countCustomers']) {
      assert.ok(store.includes(fn), `missing ${fn}`);
    }
    assert.ok(!store.includes('FROM MasterCustomer'), 'store still reads the legacy name');
    assert.ok(store.includes('FROM core_customer'), 'store must read the unified table');
  });

  it('deletes tombstone — no row-deletes of the book', () => {
    assert.ok(!/DELETE\s+FROM\s+core_customer/i.test(store), 'store must never row-delete the book');
    assert.ok(store.includes("status = 'DELETED'"), 'delete path must tombstone');
    assert.ok(store.includes('tombstonedAt'), 'tombstone must be timestamped');
    assert.ok(store.includes('actorId'), 'writes must stamp the actor (unification column)');
  });

  it('service has no mirror calls and no flip flag', () => {
    assert.ok(!service.includes('mirrorCustomers'), 'dual-write funnel must be gone');
    assert.ok(!service.includes('mirrorCustomerRemoved'), 'tombstone funnel must be gone');
    assert.ok(!service.includes('read-source'), 'flip flag machinery must be gone');
    assert.ok(!existsSync(join(SRC, 'modules', 'master-data', 'read-source.ts')), 'read-source.ts must be deleted');
  });

  it('migration renames, unifies, and bridges', () => {
    assert.ok(migration.includes('DROP TABLE core_customer'), 'must drop the verified mirror first');
    assert.ok(migration.includes('ALTER TABLE MasterCustomer RENAME TO core_customer'), 'must rename legacy into core_*');
    for (const col of ['actorId', 'actorReason', 'tombstonedAt']) {
      assert.ok(migration.includes(`ADD COLUMN ${col}`), `missing unification column ${col}`);
    }
    assert.ok(migration.includes('CREATE VIEW MasterCustomer AS SELECT * FROM core_customer'), 'must leave a read bridge on the old name');
    assert.ok(migration.includes('INSTEAD OF INSERT') && migration.includes('INSTEAD OF UPDATE') && migration.includes('INSTEAD OF DELETE'), 'bridge must forward writes too');
  });
});
