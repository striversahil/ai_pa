// roster-mapping.test.mjs — Guard: Phase A mapping queue contract.
// Backend: POST /api/telecallers/from-directory shares validation + field
// mapping with POST /api/telecallers (one home: telecallerCreateData);
// duplicate email → 409 with linkTo (Link, never silent double-create);
// region required; root refused; sales-head/MIS gate; Worker-only; mirror.
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

  it('sales-head/MIS gate + Worker-only (no Express mirror)', () => {
    const block = route.slice(route.indexOf('from-directory'));
    assert.ok(block.includes('requireSalesManager'), 'mapping must be sales-head/MIS gated');
    let express = '';
    try {
      express = readFileSync(join(BACKEND_DIR, 'src', 'routes', 'telecalling.ts'), 'utf8');
    } catch { express = ''; }
    assert.ok(!express.includes('from-directory'), 'no Express mirror (frozen)');
  });

  it('new rows mirror into core (directory converges on next read)', () => {
    const block = route.slice(route.indexOf('from-directory'));
    assert.ok(block.includes("mirrorRosterRow('telecaller'"), 'mapped rows must mirror into core');
  });

  it('frontend fetchers live in the domain api module', () => {
    const api = readFileSync(join(BACKEND_DIR, '..', 'founder-os_frontend', 'src', 'telecalling', 'api.ts'), 'utf8');
    assert.ok(api.includes('/api/telecallers/from-directory'), 'domain api must call the mapping endpoint');
    assert.ok(api.includes('worker/routes/telecalling.ts'), 'domain api must name its backend mirror');
    assert.ok(api.includes('linkTo'), 'conflict must surface linkTo for the Link offer');
  });
});
