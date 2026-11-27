// sales-staff-single-master.test.mjs — one master for sales staff.
//
// Founder decision 2026-11-27 (mig 0177): a sales person is an HR employee
// whose chart seat decides telecaller / team lead / field staff. The profile
// (regions 0..N, reporting Team Lead, WhatsApp, NeoDove, follow-ups) lives ON
// HumanResourcesMember; the old table is retired and the old name is a
// read-only VIEW so leaderboards/drills keep reading the same shape.
//
// Locks: no create/update/delete against the roster anywhere; the migration
// re-points history to the employee id before it swaps the table; the region
// helper stays a BE↔FE mirror; notifications + region usage read `regions`.
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR, FRONTEND_SRC, bundleToFile } from './_bundle.mjs';

const SRC = join(BACKEND_DIR, 'src');
const read = (p) => readFileSync(join(SRC, p), 'utf8');
const readFe = (p) => readFileSync(join(FRONTEND_SRC, p), 'utf8');
const migration = readFileSync(join(BACKEND_DIR, 'migrations', '0177_sales_staff_is_the_hr_register.sql'), 'utf8');

const beRegions = await import(bundleToFile(join(SRC, 'automations', 'telecalling', 'regions.ts')));
const feRegions = await import(bundleToFile(join(FRONTEND_SRC, 'telecalling', 'regions.ts')));

describe('sales staff live on the HR employee row', () => {
  it('0177 adds the profile columns + the flexible region array', () => {
    for (const col of ['salesType', 'salesRegions', 'salesTeamLeadId', 'salesAssignFollowUps', 'salesAbsentSince', 'neodoveUserId', 'whatsapp']) {
      assert.ok(migration.includes(`ADD COLUMN "${col}"`), `missing employee column ${col}`);
    }
    assert.ok(migration.includes("salesRegions\" TEXT NOT NULL DEFAULT '[]'"), 'regions are a JSON array, any length');
    assert.ok(!/tlLevel TEXT/.test(migration), 'never store a TL level on a person');
  });

  it('history is re-pointed at the employee id before the table is retired', () => {
    for (const table of ['EstimateAssignment', 'core_credit', 'Estimate', 'ScoreEvent', 'ManualCallLog', 'DeviceCall', 'FieldVisit', 'DialerQueue']) {
      assert.ok(migration.includes(`"${table}"`), `history table ${table} must be re-pointed`);
    }
    assert.ok(migration.includes('ALTER TABLE "Telecaller" RENAME TO "TelecallerArchive"'));
    assert.ok(migration.includes('CREATE VIEW "Telecaller"'), 'old name stays readable');
    assert.ok(!/CREATE TABLE "Telecaller"/.test(migration), 'no second master is recreated');
  });

  it('only employees can be sales staff — no roster/backfill path exists', () => {
    assert.ok(!existsSync(join(SRC, 'modules', 'telecaller', 'service.ts')), 'roster service deleted');
    assert.ok(!existsSync(join(SRC, 'routes', 'telecallers.ts')), 'express roster route deleted');
    const hits = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, name.name);
        if (name.isDirectory()) walk(full);
        else if (/\.ts$/.test(name.name)) {
          const text = readFileSync(full, 'utf8');
          if (/prisma\.telecaller\.(create|update|delete|upsert|createMany|updateMany)/.test(text)) hits.push(full);
        }
      }
    };
    walk(SRC);
    assert.deepEqual(hits, [], 'no code may write the compatibility view');
    const admin = readFe(join('components', 'UserAdmin.tsx'));
    assert.ok(!admin.includes('backfillOrgEmployees'), 'no backfill of roster rows into employees');
    const api = readFe(join('org', 'api.ts'));
    assert.ok(!api.includes('unlinkedRoster'), 'the unlinked-roster queue is retired');
  });

  it('the people read builds the roster from the employee row', () => {
    const readSrc = read(join('modules', 'org', 'read.ts'));
    assert.ok(readSrc.includes('salesRegions') && readSrc.includes('salesTeamLeadId'));
    assert.ok(!readSrc.includes('telecaller.findMany'), 'no join to the compat view');
  });

  it('region helper is a true mirror (0..N, legacy pair only as fallback)', () => {
    const cases = [
      [{ regions: '["R1","R3"]' }, ['R1', 'R3']],
      [{ regions: [] , region: 'R2' }, ['R2']],
      [{ region: 'R2', region2: 'R4' }, ['R2', 'R4']],
      [{ regions: '["R1","R1","ZZ"]' }, ['R1']],
      [{ regions: 'not-json', region: 'R3' }, ['R3']],
    ];
    for (const [input, want] of cases) {
      assert.deepEqual(beRegions.tlRegions(input), want, `backend ${JSON.stringify(input)}`);
      assert.deepEqual(feRegions.tlRegions(input), want, `frontend ${JSON.stringify(input)}`);
    }
  });

  it('region usage + notifications read the full region list', () => {
    const sales = read(join('worker', 'routes', 'sales-regions.ts'));
    assert.ok(sales.includes('salesRegions') && !sales.includes('prisma.telecaller'), 'usage counts come from employee rows');
    const notif = read(join('modules', 'notifications', 'targets.ts'));
    assert.ok(notif.includes('regions'), 'notification targeting uses the region array');
    const write = read(join('modules', 'org', 'write.ts'));
    assert.ok(write.includes('teamLeadId') && !write.includes('tlLevel'), 'the save picks a TL person, never a tier');
  });
});
