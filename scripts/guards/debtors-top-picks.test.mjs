// debtors-top-picks.test.mjs — Guard: TEMPORARY Top-receivables flag contract.
//
// TEMPORARY (2026-11-13, migration 0140): manual accountant pins live in
// `DebtorsTopPick`, ride the payload as `topPicks: string[]`, and render as
// the Top chip (manual pins ∪ auto top-N by gross due, Top-only ignores the
// region filter). Backend and frontend payload shapes must stay identical;
// delete this guard with the feature (migration 0140 + payload field + UI).
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const beTypes = readFileSync(join(root, 'founder-os_backend', 'src', 'automations', 'debtors-tracker', 'types-parts', 'types.ts'), 'utf8');
const feTypes = readFileSync(join(root, 'founder-os_frontend', 'src', 'debtors-tracker', 'types.ts'), 'utf8');
const routes = readFileSync(join(root, 'founder-os_backend', 'src', 'worker', 'routes', 'debtors-tracker.ts'), 'utf8');
const ageing = readFileSync(join(root, 'founder-os_frontend', 'src', 'components', 'debtors-tracker', 'tabs', 'AgeingTab.tsx'), 'utf8');

describe('debtors Top pins (temporary)', () => {
  it('backend and frontend payloads both carry topPicks: string[]', () => {
    assert.match(beTypes, /topPicks:\s*string\[\]/, 'backend payload missing topPicks');
    assert.match(feTypes, /topPicks:\s*string\[\]/, 'frontend payload missing topPicks');
  });

  it('migration 0140 creates DebtorsTopPick', () => {
    const sql = join(root, 'founder-os_backend', 'migrations', '0140_debtors_top_picks.sql');
    assert.ok(existsSync(sql), 'migration 0140 missing');
    assert.match(readFileSync(sql, 'utf8'), /CREATE TABLE IF NOT EXISTS DebtorsTopPick/, 'table not created');
  });

  it('routes expose accounts-only pin/unpin with live broadcast', () => {
    assert.match(routes, /top-picks/, 'no top-picks routes');
    assert.match(routes, /requireAccountsScope/, 'pin routes must be accounts-only');
    assert.match(routes, /addTopPick|removeTopPick/, 'service wiring missing');
  });

  it('Ageing tab renders the Top chip and honours Top-only over region', () => {
    assert.match(ageing, /topOnly/, 'no Top-only toggle');
    // Top-only must bypass the region predicate (Top ignores region).
    assert.match(ageing, /topOnly \? true : matchesDebtorRegion/, 'Top-only must skip the region filter');
    assert.match(ageing, /buildTopSet/, 'auto top-N union missing');
  });
});
