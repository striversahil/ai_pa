// ledger-collapse-parity.test.mjs — Guard: the ledger collapse (0137).
//
// Collapse 0137 made TelecallerScoreEvent BECOME core_credit: one table, no
// mirror, no flip. Model names stay stable (TABLE_MAP in the D1 shim), so all
// prisma.telecallerScoreEvent.* call sites work unchanged. This guard locks
// the end state (text-level, zero deps):
//   backend  → no `TelecallerScoreEvent` SQL table refs in unlocked src/
//              (the D1 VIEW bridge covers stragglers; locked modules/core/*
//               excluded — human re-signs; migrations/ history excluded)
//   backend  → migration 0137 (DROP mirror + RENAME + actor cols + bridge)
//   backend  → scoring.ts writes actor-stamped rows, no mirror calls
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR } from './_bundle.mjs';

const SRC = join(BACKEND_DIR, 'src');
const migration = readFileSync(join(BACKEND_DIR, 'migrations', '0137_ledger_collapse.sql'), 'utf8');
const scoring = readFileSync(join(SRC, 'automations', 'telecalling', 'scoring.ts'), 'utf8');
const shim = readFileSync(join(SRC, 'shared', 'd1-prisma.ts'), 'utf8');
const schema = readFileSync(join(BACKEND_DIR, 'prisma', 'schema.prisma'), 'utf8');

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

describe('ledger collapse contract (0137)', () => {
  it('no legacy TelecallerScoreEvent SQL table refs in unlocked src', () => {
    const bad = [];
    for (const f of unlockedTsFiles(SRC)) {
      const s = readFileSync(f, 'utf8');
      if (/(FROM|INTO|UPDATE|TABLE)\s+TelecallerScoreEvent\b/.test(s)) bad.push(f);
    }
    assert.deepEqual(bad, [], `legacy table refs remain: ${bad.join(', ')}`);
  });

  it('shim maps the model to the unified table', () => {
    assert.ok(shim.includes("TelecallerScoreEvent: 'core_credit'"), 'TABLE_MAP must map the ledger model');
  });

  it('writes are single and actor-stamped, no mirror calls', () => {
    assert.ok(!scoring.includes('mirrorCreditRow'), 'credit mirror funnel must be gone');
    assert.ok(!scoring.includes('mirrorCreditPurge'), 'purge mirror funnel must be gone');
    assert.ok(!scoring.includes('shadowCompareLedger'), 'ledger shadow call must be gone');
    assert.ok(scoring.includes('actorId'), 'ledger writes must stamp the actor');
  });

  it('schema carries the unification columns + physical mapping', () => {
    assert.ok(schema.includes('@@map("core_credit")'), 'model must map to the unified table');
    assert.ok(schema.includes('actorId') && schema.includes('actorReason'), 'model must carry actor columns');
  });

  it('migration drops the mirror, renames, unifies, and bridges', () => {
    assert.ok(migration.includes('DROP TABLE core_credit'), 'must drop the verified mirror first');
    assert.ok(migration.includes('ALTER TABLE TelecallerScoreEvent RENAME TO core_credit'), 'must rename legacy into core_*');
    assert.ok(migration.includes('ADD COLUMN actorId') && migration.includes('ADD COLUMN actorReason'), 'must add unification columns');
    assert.ok(migration.includes('CREATE VIEW TelecallerScoreEvent AS SELECT * FROM core_credit'), 'must leave a read bridge on the old name');
    assert.ok(migration.includes('INSTEAD OF INSERT') && migration.includes('INSTEAD OF DELETE'), 'bridge must forward writes too');
  });
});
