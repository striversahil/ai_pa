// org-sales-head-anchor.test.mjs — a person save must never delete history.
//
// Incident 2026-11-13: saving Muskan's person card (title "Sales Head" maps
// to no roster type) soft-deleted her telecaller row, so her new enquiries
// saved unattributed and her name vanished from old rows too. The whole
// attribution chain keys off that row.
//
// Post-0177 rule: there is no second row to retire. A save that leaves the
// sales chart only clears the profile columns (salesType/salesRegions/
// salesTeamLeadId) on the employee; the employee id in Estimate.createdBy,
// EstimateAssignment, core_credit, FieldVisit, DeviceCall ... is untouched,
// and nothing is ever deleted. "Sales Head" still maps to no roster type.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/org-sales-head-anchor.test.mjs`
// Exit: 0 = invariant holds, 1 = regression.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const { rosterTypeFor } = await import(
  bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'org', 'access.ts'))
);
const accessSrc = readFileSync(join(BACKEND_DIR, 'src', 'modules', 'org', 'access.ts'), 'utf8');
const writeSrc = readFileSync(join(BACKEND_DIR, 'src', 'modules', 'org', 'write.ts'), 'utf8');

describe('sales-head history anchor', () => {
  it('"Sales Head" maps to no roster type (the old trap)', () => {
    assert.strictEqual(rosterTypeFor('Sales Head'), null);
    assert.strictEqual(rosterTypeFor('Telecaller'), 'telecaller');
  });

  it('leaving the chart clears the profile but never deletes the employee', () => {
    assert.ok(writeSrc.includes('profile.salesType = ""'), 'profile is cleared, not the row');
    assert.ok(writeSrc.includes('History keeps their employee'));
    assert.ok(!/prisma\.humanResourcesMember\.delete\b/.test(writeSrc), 'never delete an employee on a save');
    assert.ok(!/deleted:\s*true/.test(writeSrc), 'never soft-delete an employee on a save');
  });

  it('no shadow roster exists to retire', () => {
    assert.ok(!writeSrc.includes('retireRosterOnSave') && !accessSrc.includes('retireRosterOnSave'), 'retire helper is gone');
    assert.ok(!writeSrc.includes('prisma.telecaller'), 'the save never touches the compatibility view');
  });

  it('sales titles keep the profile and a same-title save is a no-op clear', () => {
    for (const t of ['Telecaller', 'Field Staff', 'Team Lead']) assert.ok(rosterTypeFor(t), `${t} is a sales seat`);
    assert.ok(writeSrc.includes('else if (hadProfile)'), 'clearing only runs when a profile existed');
  });
});
