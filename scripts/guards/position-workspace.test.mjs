// position-workspace.test.mjs — Guard: root-only position builder (phase 1).
//
// Locks: registry titles ⊆ chart, widgets known, severity/flash pure,
// hierarchy preview rule, root-only gate, no fetch in pure/presentational
// layers (ratchet fe.raw_fetch_api).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleToFile, FRONTEND_SRC, REPO_ROOT } from './_bundle.mjs';

const fe = (...p) => readFileSync(join(FRONTEND_SRC, ...p), 'utf8');
const bundlePath = bundleToFile(join(FRONTEND_SRC, 'hr', 'position-dashboards.ts'), { alias: { '@': FRONTEND_SRC } });
const reg = await import(pathToFileURL(bundlePath).href);

describe('position workspace builder (phase 1, root-only)', () => {
  it('registry titles are real chart positions; Sales Head pack is live first', () => {
    assert.ok(reg.positionDashboard('Sales Head'), 'Sales Head pack must exist');
    assert.ok(reg.positionDashboard('Telecaller'), 'Telecaller pack must exist');
    assert.equal(reg.isLiveDashboardTitle('Sales Head'), true);
    assert.equal(reg.isLiveDashboardTitle('Telecaller'), false);
    for (const t of ['Sales Head', 'Telecaller']) {
      const def = reg.positionDashboard(t);
      for (const w of def.widgets) {
        assert.ok(reg.POSITION_WIDGETS.includes(w), `${t} uses unknown widget ${w}`);
      }
    }
    // Deferred title never holes — default pack.
    const deferred = reg.positionDashboard('Procurement');
    assert.ok(deferred && deferred.widgets.length > 0, 'deferred titles need a default pack');
    assert.equal(reg.positionDashboard('Nope'), null);
  });

  it('severity mapping is total + flash only on critical/overdue-high', () => {
    assert.equal(reg.severityFor({ escalationLevel: 3 }), 'critical');
    assert.equal(reg.severityFor({ escalationLevel: 2 }), 'high');
    assert.equal(reg.severityFor({ dueAt: new Date(Date.now() - 1000).toISOString() }), 'high');
    assert.equal(reg.severityFor({}), 'info');
    assert.equal(reg.shouldFlash('critical'), true);
    assert.equal(reg.shouldFlash('low'), false);
    assert.equal(reg.shouldFlash('high', null), false);
  });

  it('hierarchy preview: self + descendants only', () => {
    assert.equal(reg.canPreviewByTitles('Sales Head', 'Telecaller'), true);
    assert.equal(reg.canPreviewByTitles('Telecaller', 'Sales Head'), false);
    assert.equal(reg.canPreviewByTitles('Telecaller', 'Telecaller'), true);
    assert.equal(reg.canPreviewByTitles('', 'Telecaller'), false);
  });

  it('pure + presentational layers never fetch', () => {
    for (const f of ['hr/position-dashboards.ts', 'position-widgets/SeverityFeed.tsx', 'position-widgets/MyTasksWidget.tsx', 'position-widgets/TargetTileWidget.tsx', 'position-widgets/PresenceDots.tsx']) {
      assert.ok(!fe(f).includes('fetch('), `${f} must not fetch (domain api only)`);
    }
    const api = fe('personal/api.ts');
    assert.ok(api.includes('/api/work/team') && api.includes('/api/notifications'), 'personal api must own work + notifications reads');
    assert.ok(api.includes('worker/routes/work.ts'), 'personal api must name its backend mirror');
  });

  it('sidebar: dashboard tile grid + root-only gallery', () => {
    const nav = fe('components/layout/nav.tsx');
    assert.ok(nav.includes('{ view: "session"'), 'tile-grid sidebar row must exist (/session)');
    assert.ok(nav.includes('{ view: "workspace"'), 'gallery row must exist (/workspace, root-only)');
    assert.ok(nav.includes('"session"'), 'session stays routable (the dashboard grid URL)');
    const page = fe('app/page.tsx');
    assert.ok(!page.includes('strictSingle'), 'no forced single-dashboard bounce (dashboard-based)');
    assert.ok(page.includes('canonicalNavSlug'), 'legacy aliases still canonicalize to one replace');
  });

  it('builder is one gallery: peek into the live dashboard and take control', () => {
    const gallery = fe('views/workspace/WorkspaceView.tsx');
    assert.ok(gallery.includes('SalesHeadDashboard'), 'gallery must mount the REAL live dashboard (never a mock)');
    assert.ok(gallery.includes('ORG_POSITIONS'), 'gallery lists every chart position (live + soon)');
    assert.ok(gallery.includes('isLiveDashboardTitle'), 'cards know which packs are live');
    assert.ok(!gallery.includes('fetch('), 'gallery reads through the domain api module');
    const perms = fe('auth/permissions.ts');
    assert.ok(perms.includes('if (viewOrSlug === "workspace") return me.isRoot'), 'gallery stays root-only');
  });

  it('sales tabs live once, shared by both surfaces', () => {
    const tabs = fe('sales/tabs.ts');
    assert.ok(tabs.includes('useSalesTabs'), 'one hook owns the tab list');
    assert.ok(tabs.includes('SALES_TAB_STORAGE_KEY'), 'both surfaces share the persisted pick');
    assert.ok(!tabs.includes('fetch('), 'tab config is pure (gates only, no data)');
    const sales = fe('components/SalesWorkspace.tsx');
    assert.ok(sales.includes('useSalesTabs'), 'Sales keeps working through the shared hook');
    const head = fe('views/workspace/SalesHeadDashboard.tsx');
    assert.ok(head.includes('useSalesTabs'), 'custom dashboard reuses the same tabs (never a second list)');
    assert.ok(head.includes('TabBar'), 'same tab component, same feel');
    assert.ok(!head.includes('My Day') && !head.includes('TargetTileWidget') && !head.includes('MyTasksWidget') && !head.includes('SeverityFeed'), 'no My Day hero on the Sales Head dashboard (founder decision 2026-11-16 — header + tabs only)');
    assert.ok(!head.includes('LazySection'), 'one panel mounts at a time — no scroll-mount needed');
  });

  it('dashboard-based home: tile grid lists granted sheets, gallery previews anyone', () => {
    // Dashboard-based (founder decision 2026-11-17): /session is the tile grid
    // (pinned + all), /workspace is the root-only gallery that mounts the REAL
    // live dashboard for preview + audited take-control.
    const session = fe('views/session/SessionView.tsx');
    assert.ok(session.includes('WorkspaceGrid'), 'session page must be the tile grid');
    assert.ok(session.includes('WorkspaceFrame'), 'open tile renders the REAL sheet via WorkspaceFrame');
    assert.ok(!session.includes('SalesHeadDashboard'), 'session home must not force a single custom dashboard');
    assert.ok(!session.includes('PersonWorkspace'), 'tabbed pile retired with the single-dashboard home');

    const head = fe('views/workspace/SalesHeadDashboard.tsx');
    for (const panel of ['TelecallingDashboard', 'ZohoEstimates', 'EnquiryTracker', 'MasterDataView', 'SalesDispatchPanel', 'FieldStaffPanel', 'SalesObjectionsPanel', 'SalesControllerPanel']) {
      assert.ok(head.includes(panel), `Sales Head page must compose the real ${panel} (never a copy)`);
    }
    assert.ok(head.includes('NotificationDock'), 'delay bell rides the custom dashboard');
    assert.ok(head.includes('useWorkspaces') && head.includes('WorkspaceRenderer'), 'admin-granted sheets beyond Sales render as extra tabs (same renderer other roles get)');
    assert.ok(head.includes('IMPLIED_SCOPES'), 'root preview scopes extras to the sales-head bundle — never root omniscience');
    assert.ok(!head.includes('fetch('), 'custom dashboard must go through domain api modules');

    const motion = fe('components/ui/motion.tsx');
    assert.ok(motion.includes('LazySection'), 'lazy-mount lives in the shared kit (reused per pack)');

    const navHook = fe('hooks/useDashboardNav.ts');
    assert.ok(!navHook.includes('sales-head'), 'sidebar pile shows every granted sheet (no role hides it)');

    const page = fe('app/page.tsx');
    assert.ok(!page.includes('strictSingle'), 'no forced single-dashboard bounce');
  });
});
