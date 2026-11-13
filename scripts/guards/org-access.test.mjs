// org-access.test.mjs — Guard: the Organization chart is the one person editor.
//
// Founder decision 2026-11-14: the Controller roster editor and the login →
// roster mapping queue are retired. One person save (PUT /api/org/people/:id)
// owns position, region(s), tlLevel, WhatsApp, office phone, NeoDove mapping,
// access chips and active state — through the existing services, never raw.
// The telecalling module keeps the roster READ (leaderboard, Export, the
// field-staff picker in EnquiryTracker) and no write endpoints.
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR, FRONTEND_SRC } from './_bundle.mjs';

const SRC = join(BACKEND_DIR, 'src');
const read = (p) => readFileSync(join(SRC, p), 'utf8');
const readFe = (p) => readFileSync(join(FRONTEND_SRC, p), 'utf8');

const route = read(join('worker', 'routes', 'org.ts'));
const access = read(join('modules', 'org', 'access.ts'));
// io.ts is a compat re-export (extract, never rewrite) — the logic lives in
// read.ts (the people read) + write.ts (the person save + backfill).
const io = read(join('modules', 'org', 'write.ts')) + '\n' + read(join('modules', 'org', 'read.ts'));
const ioShim = read(join('modules', 'org', 'io.ts'));
const tele = read(join('worker', 'routes', 'telecalling.ts'));

describe('org person contract (one save, server-decided)', () => {
  it('route surface is exactly read + save + backfill (Worker-only)', () => {
    assert.ok(ioShim.includes('export * from "./read"') && ioShim.includes('export * from "./write"'), 'io.ts stays a compat re-export (split, never rewritten)');
    assert.ok(route.includes("'/api/org/people'"), 'GET people must be registered');
    assert.ok(route.includes("'/api/org/people/:id'"), 'PUT person must be registered');
    assert.ok(route.includes("'/api/org/backfill'"), 'POST backfill must be registered');
    assert.ok(route.includes('getOrgPeople') && route.includes('assignPerson') && route.includes('backfillEmployees'), 'thin handler: logic lives in modules/org');
    let express = '';
    try {
      express = readFileSync(join(BACKEND_DIR, 'src', 'routes', 'org.ts'), 'utf8');
    } catch { express = ''; }
    assert.equal(express, '', 'no Express mirror (frozen)');
  });

  it('permission lives in one pure function (root/admin, HR all, sales-head → Sales, dept managers → own dept)', () => {
    assert.ok(access.includes('function canManagePerson'), 'canManagePerson must exist');
    assert.ok(access.includes('"human-resources"'), 'HR must manage everyone');
    assert.ok(access.includes('"sales-head"') && access.includes('Sales'), 'sales-head must manage Sales people');
    assert.ok(access.includes('"digital-marketing"') && access.includes('"procurement"') && access.includes('"accounts"'), 'dept managers must manage their own dept');
    assert.ok(!access.includes('fetch(') && !access.includes('prisma'), 'pure: no fetch, no DB');
  });

  it('only Sales titles hold a roster row (Sales Head has none, non-sales never map)', () => {
    assert.ok(access.includes('Team Lead') && access.includes('Telecaller') && access.includes('Field Staff'), 'three sales titles');
    for (const t of ['Sales Head', 'Digital Marketing', 'Accountant', 'Procurement', 'HR', 'MIS']) {
      assert.ok(!new RegExp(`^\\s*"${t}":\\s*"telecaller"|"${t}":\\s*"field_staff"|"${t}":\\s*"team_lead"`, 'm').test(access), `${t} must not map to a roster type`);
    }
  });

  it('chart title → login-position map mirrors the frontend taxonomy', () => {
    const fe = readFe(join('hr', 'organization.ts'));
    for (const [title, key] of Object.entries({
      'Sales Head': 'sales-head', 'Team Lead': 'team-lead', Telecaller: 'telecaller',
      'Field Staff': 'field-staff', 'Digital Marketing - Senior': 'dm-senior',
      'Senior Accountant': 'accountant', Procurement: 'procurement', HR: 'hr',
    })) {
      assert.ok(fe.includes(`"${title}"`), `frontend taxonomy must cover ${title}`);
      assert.ok(access.includes(`"${title}": "${key}"`), `backend map must agree on ${title} → ${key}`);
    }
  });

  it('save reuses existing services (validation, phone, pair rule, mirror, scopes) — never rewritten', () => {
    assert.ok(io.includes('tlPairError'), 'TL1 pair rule reused');
    assert.ok(io.includes('isValidRegion'), 'region validation reused');
    assert.ok(io.includes('normalizeAgentPhone'), 'office-phone normalization reused');
    assert.ok(io.includes('updateEmployee'), 'employee master write reused');
    assert.ok(io.includes('setUserScopes'), 'login access write reused');
    assert.ok(io.includes("mirrorRosterRow"), 'roster rows mirror into core');
    assert.ok(io.includes('invalidateRiskCache'), 'leaderboard cache busted on save');
    assert.ok(io.includes('force-keep') || io.includes('locked'), 'beyond-power grants are force-kept, never stripped');
  });

  it('region is required for sales staff, second region is Team-Lead-only', () => {
    assert.ok(io.includes('region required for sales staff'), 'region must be required');
    assert.ok(io.includes('second region is Team-Lead-only') || io.includes('Team-Lead-only'), 'region2 must be TL-only');
  });

  it('telecalling keeps the roster READ and no write endpoints', () => {
    assert.ok(tele.includes("app.get('/api/telecallers'"), 'GET roster stays (leaderboard, Export, field-staff picker)');
    for (const ep of ["'/api/telecallers/from-directory'", "'/api/telecallers/link'", "app.post('/api/telecallers'", "app.put('/api/telecallers/:id'", "app.delete('/api/telecallers/:id'"]) {
      assert.ok(!tele.includes(ep), `retired endpoint must be gone: ${ep}`);
    }
  });

  it('frontend: one chart component mounted twice, fetchers in the org domain api', () => {
    const api = readFe(join('org', 'api.ts'));
    assert.ok(api.includes('/api/org/people'), 'domain api must call the org read');
    assert.ok(api.includes('/api/org/backfill'), 'domain api must call backfill');
    assert.ok(api.includes('worker/routes/org.ts'), 'domain api must name its backend mirror');
    const tab = readFe(join('components', 'human-resources', 'OrganizationTab.tsx'));
    assert.ok(tab.includes('department'), 'tab must accept the department scope (Sales mount)');
    assert.ok(!tab.includes('fetchSalesRoster') && !tab.includes('/api/telecallers'), 'tab must read people from /api/org/people only');
    const controller = readFe(join('components', 'SalesControllerPanel.tsx'));
    assert.ok(controller.includes('OrganizationTab') && controller.includes('department="Sales"'), 'Controller mounts the Sales-scoped chart');
    assert.ok(!controller.includes('RosterSection') && !controller.includes('RosterEditModal'), 'Controller roster editor must be gone');
    assert.ok(!controller.includes('from-directory') && !controller.includes('saveRoster'), 'Controller roster writes must be gone');
  });

  it('frontend access mirror carries the same sales titles (display-only; server enforces)', () => {
    const feAccess = readFe(join('org', 'access.ts'));
    assert.ok(feAccess.includes('founder-os_backend/src/modules/org/access.ts'), 'mirror comment must name the backend source');
    for (const t of ['Team Lead', 'Telecaller', 'Field Staff']) {
      assert.ok(feAccess.includes(t), `mirror must list ${t}`);
    }
  });
});
