// enquiry-region-writeback.test.mjs — region write-back stays strict.
//
// When an estimate's creator has no roster region (sales-head/manager rows),
// the heals resolve the home region through the Customer Master. This locks
// the write rule (pickWritebackRegion — stricter than the ledger on purpose):
// manual overrides and single-region exact matches write; fuzzy, ambiguous,
// region-less and invalid-region resolutions never write (row stays Unmapped
// for a human re-home). Mirror: client-segments-parts/pure.ts.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/enquiry-region-writeback.test.mjs`
// Exit: 0 = invariant holds, 1 = regression.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const { pickWritebackRegion, normalizeClientKey } = await import(
  bundleToFile(join(BACKEND_DIR, 'src', 'automations', 'telecalling', 'client-segments-parts', 'pure.ts'))
);

describe('region write-back rule', () => {
  it('exact match in a single region writes', () => {
    assert.strictEqual(
      pickWritebackRegion({ matchKind: 'exact', masterRegion: 'R2' }, ['R2']),
      'R2',
    );
  });

  it('manual override writes even without exact hits', () => {
    assert.strictEqual(
      pickWritebackRegion({ matchKind: 'manual', masterRegion: 'R3' }, []),
      'R3',
    );
  });

  it('exact key hitting two regions never writes', () => {
    assert.strictEqual(
      pickWritebackRegion({ matchKind: 'exact', masterRegion: 'R2' }, ['R2', 'R4']),
      '',
    );
  });

  it('fuzzy matches never write (ledger-only)', () => {
    for (const kind of ['fuzzy-unique', 'fuzzy-best']) {
      assert.strictEqual(pickWritebackRegion({ matchKind: kind, masterRegion: 'R1' }, ['R1']), '');
    }
  });

  it('ambiguous / none / region-less resolutions never write', () => {
    assert.strictEqual(pickWritebackRegion({ matchKind: 'ambiguous', masterRegion: '' }, []), '');
    assert.strictEqual(pickWritebackRegion({ matchKind: 'none', masterRegion: '' }, []), '');
    assert.strictEqual(pickWritebackRegion({ matchKind: 'exact', masterRegion: '' }, []), '');
    assert.strictEqual(pickWritebackRegion(null, ['R1']), '');
  });

  it('invalid regions never write', () => {
    assert.strictEqual(pickWritebackRegion({ matchKind: 'exact', masterRegion: 'R5' }, ['R5']), '');
    assert.strictEqual(pickWritebackRegion({ matchKind: 'manual', masterRegion: '' }, []), '');
  });

  it('keys normalize the same way the ledger joins on', () => {
    assert.strictEqual(normalizeClientKey('Sakambari Flour Mills WB'), 'SAKAMBARI FLOUR MILLS WB');
    assert.strictEqual(normalizeClientKey('Amar Jyoti Industries (UP)'), normalizeClientKey('amar jyoti industries'));
  });
});
