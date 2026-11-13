// no-mis-role.test.mjs — the MIS role is retired (founder decision 2026-11-12).
// No `mis` scope key, role, guard, or gate text may reappear anywhere except:
//   - debtor-sheet DATA (`mis` CSV column + its mirrors: imports parse/types,
//     ledger rows, the invoice-edit field list), which is a spreadsheet column,
//     not the role;
//   - plain-English "mis-" words (mis-imported, mis-aimed, mismatch…);
//   - the locked-core allowlist below (resolveCaller still references 'mis'
//     until docs/core-change-requests/2026-11-12-drop-mis-resolve-caller.md is
//     re-signed — the scope row is gone from D1 so the check is dead-false);
//   - the organization CHART (`hr/organization.ts` + its parity guard), where
//     MIS is a founder-authored position title that maps to NO login position
//     (`loginPositionsFor('MIS') === []`, "org label only, grants nothing").
// This file documents the retirement, so it is excluded from its own scan.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const allowlist = new Set([
  // debtor-sheet data column + mirrors (NOT the role)
  'founder-os_backend/src/automations/debtors-tracker/parse.ts',
  'founder-os_backend/src/automations/debtors-tracker/ledger.ts',
  'founder-os_backend/src/automations/debtors-tracker/imports-parts/io.ts',
  'founder-os_backend/src/automations/debtors-tracker/types-parts/pure.ts',
  'founder-os_backend/src/automations/debtors-tracker/types-parts/types.ts',
  'founder-os_backend/src/automations/debtors-tracker/imports-parts/pure.ts',
  'founder-os_frontend/src/debtors-tracker/parse.ts',
  'founder-os_frontend/src/debtors-tracker/api.ts',
  'founder-os_frontend/src/debtors-tracker/types.ts',
  'founder-os_frontend/src/components/debtors-tracker/InvoiceEditModal.tsx',
  // locked core — proposal pending, check is dead-false without the scope row
  'founder-os_backend/src/modules/core/permissions.ts',
  'founder-os_backend/src/modules/core/leads.ts',
  // organization chart — MIS is a position TITLE with no login position
  'founder-os_frontend/src/hr/organization.ts',
  'scripts/guards/org-chart-parity.test.mjs',
  // org person module — same chart-title mirror, grants nothing (MIS → "")
  'founder-os_backend/src/modules/org/access.ts',
  'scripts/guards/org-access.test.mjs',
  // org graph wing legend — names the chart title, grants nothing
  'founder-os_frontend/src/org/OrgGraphCanvas.tsx',
]);

const NOISE = /mis-imported|mismatch|mis-aimed|dismiss|promise|promis|missing|admission|optimis|permission|permis|submit|transmit/i;

function hits() {
  const out = execSync(
    `grep -rn -w -e mis -e MIS --include='*.ts' --include='*.tsx' --include='*.mjs' ` +
      `'${join(ROOT, 'founder-os_backend', 'src')}' '${join(ROOT, 'founder-os_frontend', 'src')}' '${join(ROOT, 'scripts', 'guards')}' || true`,
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  return out
    .split('\n')
    .filter(Boolean)
    .filter((line) => !line.includes('no-mis-role.test.mjs'))
    .filter((line) => !NOISE.test(line))
    .map((line) => {
      const rel = line.slice(ROOT.length + 1).split(':')[0];
      return { rel, line };
    })
    .filter(({ rel }) => !allowlist.has(rel));
}

describe('no MIS role', () => {
  it('no mis scope/role/guard/gate text outside the data + locked-core allowlist', () => {
    const bad = hits();
    assert.deepEqual(
      bad.map((b) => b.line),
      [],
      `MIS references found (data columns belong in the allowlist — delete the rest)`,
    );
  });
});
