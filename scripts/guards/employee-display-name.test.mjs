// employee-display-name.test.mjs — Guard: one display-name rule everywhere.
//
// The HR register keeps the legal `name`; an enabled character name is shown
// as "Character Name (Legal Name)". Backend and frontend mirrors must agree,
// the migration must be additive, and the employee API must expose the fields.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleToFile, BACKEND_DIR, FRONTEND_SRC } from './_bundle.mjs';

const be = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src/shared/employee-name.ts'))).href);
const fe = await import(pathToFileURL(bundleToFile(join(FRONTEND_SRC, 'hr/display.ts'), { alias: { '@': FRONTEND_SRC } })).href);

const CASES = [
  { name: 'Rahul Singh', characterName: 'Iron Man', useCharacterName: true },
  { name: 'Rahul Singh', characterName: '  Iron   Man  ', useCharacterName: true },
  { name: 'Rahul Singh', characterName: 'Iron Man', useCharacterName: false },
  { name: 'Rahul Singh', characterName: '', useCharacterName: true },
  { name: 'Rahul Singh', characterName: 'rahul singh', useCharacterName: true },
  { name: '', characterName: 'Iron Man', useCharacterName: true },
  { name: null, characterName: null, useCharacterName: true },
];

describe('employee display name', () => {
  it('formats Character Name (Legal Name) and collapses duplicates', () => {
    assert.equal(be.employeeDisplayName(CASES[0]), 'Iron Man (Rahul Singh)');
    assert.equal(be.employeeDisplayName(CASES[1]), 'Iron Man (Rahul Singh)');
    assert.equal(be.employeeDisplayName(CASES[2]), 'Rahul Singh');
    assert.equal(be.employeeDisplayName(CASES[3]), 'Rahul Singh');
    assert.equal(be.employeeDisplayName(CASES[4]), 'Rahul Singh');
    assert.equal(be.employeeDisplayName(CASES[5]), 'Iron Man');
    assert.equal(be.employeeDisplayName(CASES[6]), '');
  });

  it('frontend mirror is byte-identical for every case', () => {
    for (const row of CASES) assert.equal(fe.employeeDisplayName(row), be.employeeDisplayName(row));
  });

  it('email resolution prefers loginEmail over the contact cell', () => {
    const index = be.buildEmployeeNameIndex([
      { name: 'Legal A', characterName: 'Hero A', useCharacterName: true, loginEmail: 'a@x.com', email: 'shared@x.com' },
      { name: 'Legal B', characterName: 'Hero B', useCharacterName: true, loginEmail: 'b@x.com', email: 'shared@x.com' },
    ]);
    assert.equal(be.displayNameForEmail(index, 'a@x.com', null), 'Hero A (Legal A)');
    assert.equal(be.displayNameForEmail(index, 'shared@x.com', null), 'Hero A (Legal A)');
  });

  it('migration adds both columns without rewriting name', () => {
    const sql = readFileSync(join(BACKEND_DIR, 'migrations/0169_hr_character_name.sql'), 'utf8');
    assert.match(sql, /ADD COLUMN "characterName" TEXT/);
    assert.match(sql, /ADD COLUMN "useCharacterName" INTEGER NOT NULL DEFAULT 0/);
    assert.doesNotMatch(sql, /UPDATE\s+"HumanResourcesMember"\s+SET\s+"name"/i);
  });

  it('HR employee payload exposes the character fields and display name', () => {
    const employees = readFileSync(join(BACKEND_DIR, 'src/automations/human-resources/employees.ts'), 'utf8');
    assert.match(employees, /characterName/);
    assert.match(employees, /useCharacterName/);
    assert.match(employees, /displayName: employeeDisplayName/);
  });
});
