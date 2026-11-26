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

  it('save reuses existing services (validation, phone, pair rule, mirror) — never rewritten; access NOT via HR', () => {
    assert.ok(io.includes('validateSalesPosting') && io.includes('impliedTlLevel'), 'HR region catalog + allotment validation reused');
    assert.ok(read(join('modules', 'org', 'regions.ts')).includes('loadPositionAllotment'), 'chart-seat allotment lives in modules/org/regions.ts');
    assert.ok(io.includes('normalizeAgentPhone'), 'office-phone normalization reused');
    assert.ok(io.includes('updateEmployee'), 'employee master write reused');
    assert.ok(io.includes("mirrorRosterRow"), 'roster rows mirror into core');
    assert.ok(io.includes('invalidateRiskCache'), 'leaderboard cache busted on save');
    assert.ok(io.includes('Users & Permissions') && !io.includes('setUserScopes'), 'HR save never writes scopes (roles own access)');
  });

  it('region rules: one region for staff, exactly two for a Team Lead, second region TL-only', () => {
    const regions = read(join('modules', 'org', 'regions.ts'));
    assert.ok(regions.includes('region required for sales staff'), 'region must be required');
    assert.ok(regions.includes('needs exactly two different regions'), 'Team Lead covers exactly two regions');
    assert.ok(io.includes('Team-Lead-only'), 'region2 must be TL-only');
    assert.ok(io.includes('chartRow?.id'), 'the seat allotment is validated against the real chart position');
  });

  it('the Sales Controller owns the region catalog + position allotment (never HR)', () => {
    const route = read(join('worker', 'routes', 'sales-regions.ts'));
    assert.ok(route.includes('/api/sales/regions'), 'region read endpoint');
    assert.ok(route.includes('/api/sales/regions/:code'), 'region edit endpoint');
    assert.ok(route.includes('/api/sales/position-regions/:positionId'), 'allotment endpoint');
    assert.ok(route.includes('requireSalesManager'), 'sales-head/root only');
    assert.ok(!route.includes('access(c)'), 'HR gate retired from region writes');
    const drawer = readFe(join('org', 'OrgPersonDrawer.tsx'));
    assert.ok(drawer.includes('allotment') && drawer.includes('regionOptions'), 'person form filters regions by seat allotment');
    const hrTab = readFe(join('components', 'human-resources', 'ControllerTab.tsx'));
    assert.ok(!hrTab.includes('SalesRegionsSection') && !hrTab.includes('fetchRegions'), 'HR Controller no longer edits regions');
    const salesTab = readFe(join('components', 'SalesControllerPanel.tsx'));
    assert.ok(salesTab.includes('SalesRegionsSection') && salesTab.includes('fetchSalesRegions'), 'Sales Controller mounts the region table + allotment matrix');
    assert.ok(salesTab.includes('chartEditable={false}'), 'Sales Controller chart is read-only');
    const orgTab = readFe(join('components', 'human-resources', 'OrganizationTab.tsx'));
    assert.ok(orgTab.includes('chartEditable') && orgTab.includes('canManageChart = chartEditable'), 'chart add/edit/delete is gated by the mount');
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

  it('implied bundle is backend-owned, frontend is display-only mirror', () => {
    const implied = read(join('modules', 'auth', 'implied.ts'));
    assert.ok(implied.includes('sales-head') && implied.includes('telecalling'), 'canonical bundle must exist backend-side');
    assert.ok(implied.includes('expandScopes'), 'backend must expand scopes (transitive)');
    const viewer = read(join('worker', 'viewer.ts'));
    assert.ok(viewer.includes('expandScopes'), 'viewer must expand implied scopes (backend owns)');
    const perms = readFe(join('auth', 'permissions.ts'));
    assert.ok(perms.includes('modules/auth/implied.ts'), 'frontend mirror comment must name the backend source');
    // Parity: every backend implied entry must appear frontend-side.
    for (const s of ['sales-head', 'dispatch', 'accounts']) {
      assert.ok(implied.includes(s), `backend bundle must contain ${s}`);
      assert.ok(perms.includes(s), `frontend mirror must contain ${s}`);
    }
    for (const pair of [['sales-head', 'telecalling'], ['dispatch', 'crm'], ['accounts', 'debtors-tracker']]) {
      assert.ok(implied.includes(pair[1]), `backend bundle must imply ${pair[1]} for ${pair[0]}`);
      assert.ok(perms.includes(pair[1]), `frontend mirror must imply ${pair[1]} for ${pair[0]}`);
    }
  });

  it('Operations & Support is home for procurement (no migration)', () => {
    assert.ok(access.includes('isHomeDepartment'), 'home-dept helper must exist');
    assert.ok(access.includes('Operations & Support'), 'procurement must map to the chart dept');
    assert.ok(io.includes('Operations & Support'), 'read visibleDepartments must include the chart dept');
    const feAccess = readFe(join('org', 'access.ts'));
    assert.ok(feAccess.includes('isHomeDepartment'), 'frontend mirror must carry the helper');
  });

  it('login match prefers loginEmail; HR drawer never touches access', () => {
    assert.ok(io.includes('loginEmail wins') || io.includes('loginEmailFirst'), 'login lookup must prefer loginEmail');
    const drawer = readFe(join('org', 'OrgPersonDrawer.tsx'));
    assert.ok(!drawer.includes('Dashboard access</h3>'), 'HR drawer must not render access chips');
    assert.ok(!drawer.includes('toggleScope') && !drawer.includes('scopeOptions'), 'HR drawer must not edit scopes');
    assert.ok(drawer.includes('Users & Permissions'), 'HR drawer must point to Users & Permissions for access');
    const inspector = readFe(join('org', 'OrgInspector.tsx'));
    assert.ok(inspector.includes('positions') && inspector.includes('via '), 'inspector shows role-derived positions cleanly');
  });

  it('roles carry ONE chart position (Users & Permissions mapping)', () => {
    const types = read(join('modules', 'auth', 'types.ts'));
    assert.ok(types.includes('position'), 'AuthRole must carry a position');
    const svc = read(join('modules', 'auth', 'service.ts'));
    assert.ok(svc.includes('cleanRolePosition'), 'position must normalize (trimmed or null)');
    assert.ok(svc.includes('updateRole'), 'roles must be updatable (position + scopes)');
    const drawer = readFe(join('components', 'admin', 'AdminDrawers.tsx'));
    assert.ok(drawer.includes('POSITION (ONE CHART TITLE)'), 'RoleDrawer must map one chart position');
    const admin = readFe(join('components', 'UserAdmin.tsx'));
    assert.ok(admin.includes('Orphans'), 'orphan queues live in Users & Permissions');
    assert.ok(admin.includes('/api/auth/roles/${encodeURIComponent(key)}') || admin.includes('/api/auth/roles/'), 'role edit must hit the update endpoint');
    const orgTab = readFe(join('components', 'human-resources', 'OrganizationTab.tsx'));
    assert.ok(!orgTab.includes('Roster rows without') && !orgTab.includes('Logins without'), 'orphan queues must be gone from HR');
    assert.ok(!orgTab.includes('backfillOrgEmployees'), 'HR must not backfill (UserAdmin owns it)');
  });

  it('access writes invalidate caches + broadcast automation refresh', () => {
    const svc = read(join('modules', 'auth', 'service.ts'));
    assert.ok(svc.includes('invalidateAllSessionCaches'), 'cache invalidation must exist');
    // Every access-mutating write must invalidate (not just the org save path).
    const invalidations = (svc.match(/invalidateAllSessionCaches\(\)/g) ?? []).length;
    assert.ok(invalidations >= 4, `all access writes must invalidate (found ${invalidations})`);
    assert.ok(route.includes('LiveEvent.Automation'), 'org save must broadcast automation refresh');
    const ws = readFe(join('workspaces', 'useWorkspaces.ts'));
    assert.ok(ws.includes('human-resources') && ws.includes('telecalling'), 'workspace list must refresh on org writes');
  });
});
