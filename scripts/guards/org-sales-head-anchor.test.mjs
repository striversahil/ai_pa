// org-sales-head-anchor.test.mjs — the person save must never auto-retire
// the sales-head's roster row.
//
// Incident 2026-11-13: saving Muskan's person card (title "Sales Head" maps
// to no roster type) soft-deleted her telecaller row. Deleted rows are
// skipped by creator inference AND the agents list, so her new enquiries
// saved unattributed (Enquiry No 15, MR Engineers) and her name vanished
// from every row including old ones. The whole attribution chain (enquiries,
// estimates, leaderboard, NeoDove) keys off that row.
//
// Rule (modules/org/access.ts retireRosterOnSave, consulted by write.ts):
// a missing roster type retires the row ONLY when the linked login does NOT
// hold sales-head power (scope or role). A sales-head who genuinely leaves
// loses the row when their access is removed, never as a card-save side
// effect.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/org-sales-head-anchor.test.mjs`
// Exit: 0 = invariant holds, 1 = regression.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const { retireRosterOnSave, rosterTypeFor } = await import(
  bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'org', 'access.ts'))
);
const writeSrc = readFileSync(join(BACKEND_DIR, 'src', 'modules', 'org', 'write.ts'), 'utf8');

describe('sales-head roster anchor', () => {
  it('"Sales Head" maps to no roster type (the trap this guards)', () => {
    assert.strictEqual(rosterTypeFor('Sales Head'), null);
    assert.strictEqual(rosterTypeFor('Telecaller'), 'telecaller');
  });

  it('sales-head power blocks the auto-retire', () => {
    assert.strictEqual(retireRosterOnSave({ rosterType: null, holdsSalesHeadPower: true }), false);
  });

  it('ordinary non-sales titles still retire', () => {
    assert.strictEqual(retireRosterOnSave({ rosterType: null, holdsSalesHeadPower: false }), true);
  });

  it('sales titles never retire through this branch', () => {
    for (const t of ['telecaller', 'field_staff', 'team_lead']) {
      assert.strictEqual(retireRosterOnSave({ rosterType: t, holdsSalesHeadPower: false }), false);
      assert.strictEqual(retireRosterOnSave({ rosterType: t, holdsSalesHeadPower: true }), false);
    }
  });

  it('write.ts consults the rule with the login’s sales-head power', () => {
    assert.ok(writeSrc.includes('retireRosterOnSave'), 'person save must call retireRosterOnSave');
    assert.ok(writeSrc.includes('getUserScopeKeys') && writeSrc.includes('getUserRoleKeys'), 'power check reads scope + role grants');
  });
});
