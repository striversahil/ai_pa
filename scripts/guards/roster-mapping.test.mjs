// roster-mapping.test.mjs — Guard: Phase A mapping queue contract.
// Backend: POST /api/telecallers/from-directory shares validation + field
// mapping with POST /api/telecallers (one home: telecallerCreateData);
// duplicate email → 409 with linkTo (Link, never silent double-create);
// region required; root refused; sales-head/HR gate; Worker-only; mirror.
// Frontend: fetchers live in the telecalling domain api module (ratchet-clean).
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR } from './_bundle.mjs';

const SRC = join(BACKEND_DIR, 'src');
const route = readFileSync(join(SRC, 'worker', 'routes', 'telecalling.ts'), 'utf8');

describe('roster mapping queue contract (Phase A)', () => {
  it('validation + field mapping live in one shared builder', () => {
    assert.ok(route.includes('function telecallerCreateData'), 'shared builder must exist');
    const uses = (route.match(/telecallerCreateData\(/g) ?? []).length;
    assert.ok(uses >= 3, `builder must serve both routes (found ${uses} refs incl. definition)`);
    const fieldStaffRules = (route.match(/staffType === 'field_staff' \? false/g) ?? []).length;
    assert.equal(fieldStaffRules, 1, `field-staff close rule must live in exactly one place (found ${fieldStaffRules})`);
  });

  it('from-directory: login-resolved, region-required, duplicate → 409 linkTo', () => {
    assert.ok(route.includes("'/api/telecallers/from-directory'"), 'route must be registered');
    assert.ok(route.includes('userId required'), 'userId must be required');
    assert.ok(route.includes('region required'), 'region must be required');
    assert.ok(route.includes('linkTo'), 'duplicate must return linkTo for Link');
    assert.ok(route.includes('root login cannot be rostered'), 'root must be refused');
    assert.ok(route.includes('login has no email'), 'emailless logins must be refused');
  });

  it('sales-head/HR gate + Worker-only (no Express mirror)', () => {
    assert.ok(route.includes('requireRosterManager'), 'mapping must use the roster-manager gate (sales-head + HR)');
    assert.ok(route.includes("scopes.includes('human-resources')"), 'HR holders must pass the gate');
    let express = '';
    try {
      express = readFileSync(join(BACKEND_DIR, 'src', 'routes', 'telecalling.ts'), 'utf8');
    } catch { express = ''; }
    assert.ok(!express.includes('from-directory') && !express.includes('/link'), 'no Express mirror (frozen)');
  });

  it('new rows mirror into core (directory converges on next read)', () => {
    const block = route.slice(route.indexOf('from-directory'));
    assert.ok(block.includes("mirrorRosterRow('telecaller'"), 'mapped rows must mirror into core');
  });

  it('link endpoint attaches a login email to an existing row (HR-capable)', () => {
    assert.ok(route.includes("'/api/telecallers/link'"), 'link route must be registered');
    const start = route.indexOf('/api/telecallers/link');
    const next = route.indexOf('\n  app.', start + 1);
    const block = next === -1 ? route.slice(start) : route.slice(start, next);
    assert.ok(block.includes('requireRosterManager'), 'link must share the roster-manager gate');
    assert.ok(block.includes('rowId and userId required'), 'link must require row + login');
    assert.ok(block.includes('email already on another roster row'), 'link must refuse double-claims with 409');
    assert.ok(block.includes("mirrorRosterRow('telecaller', rowId)"), 'linked rows must mirror into core');
    assert.ok(!block.includes("app.put('/api/telecallers/:id'"), 'link must not widen the legacy PUT gate');
  });

  it('frontend fetchers live in the domain api module', () => {
    const api = readFileSync(join(BACKEND_DIR, '..', 'founder-os_frontend', 'src', 'telecalling', 'api.ts'), 'utf8');
    assert.ok(api.includes('/api/telecallers/from-directory'), 'domain api must call the mapping endpoint');
    assert.ok(api.includes('/api/telecallers/link'), 'domain api must call the scoped link endpoint');
    assert.ok(api.includes('worker/routes/telecalling.ts'), 'domain api must name its backend mirror');
    assert.ok(api.includes('linkTo'), 'conflict must surface linkTo for the Link offer');
    assert.ok(api.includes('fetchSalesRoster'), 'roster read must live in the domain api (no raw fetch in components)');
  });

  it('roster read is HR-capable (HR needs the roster to Map/Link)', () => {
    const getStart = route.indexOf("app.get('/api/telecallers'");
    assert.ok(getStart !== -1, 'GET roster must exist');
    const getNext = route.indexOf('\n  app.', getStart + 1);
    const getBlock = getNext === -1 ? route.slice(getStart) : route.slice(getStart, getNext);
    assert.ok(getBlock.includes('requireRosterManager'), 'GET must use the roster-manager gate (sales-head + HR)');
    assert.ok(!getBlock.includes("app.put('/api/telecallers/:id'"), 'read gate change must not touch the legacy PUT');
  });

  it('mapping lives in the HR Organization tree (one home, composition — never a fork)', () => {
    const fe = join(BACKEND_DIR, '..', 'founder-os_frontend', 'src');
    const row = readFileSync(join(fe, 'components', 'human-resources', 'OrgLoginMapRow.tsx'), 'utf8');
    assert.ok(row.includes('mapRosterFromDirectory'), 'tree row must call the domain api mapper');
    assert.ok(row.includes('linkRosterByLogin'), 'tree row must offer Link on a 409');
    assert.ok(row.includes('linkTo'), 'tree row must read linkTo off the conflict');
    assert.ok(!row.includes('fetch('), 'tree row must never fetch inline (domain api only)');

    const node = readFileSync(join(fe, 'components', 'human-resources', 'OrgNodeCard.tsx'), 'utf8');
    assert.ok(node.includes('OrgLoginMapRow'), 'org tree node must host the Map/Link row');

    // Founder decision 2026-11-13: the unmapped-logins queue left both the HR
    // Employees tab and the Sales Controller — the org tree is its one home.
    const employees = readFileSync(join(fe, 'components', 'human-resources', 'EmployeesTab.tsx'), 'utf8');
    assert.ok(!employees.includes('MappingSection'), 'Employees tab must no longer host a mapping queue');
    assert.ok(employees.includes('listMembers'), 'employee read must go through the domain api (no raw fetch)');

    const controller = readFileSync(join(fe, 'components', 'SalesControllerPanel.tsx'), 'utf8');
    assert.ok(!controller.includes('MappingSection'), 'Sales Controller must no longer host a mapping queue');
  });
});
