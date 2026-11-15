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

  it('builder is one gallery: peek into the live dashboard and take control', () => {
    const gallery = fe('views/workspace/WorkspaceView.tsx');
    assert.ok(gallery.includes('SalesHeadDashboard'), 'gallery must mount the REAL live dashboard (never a mock)');
    assert.ok(gallery.includes('ORG_POSITIONS'), 'gallery lists every chart position (live + soon)');
    assert.ok(gallery.includes('isLiveDashboardTitle'), 'cards know which packs are live');
    assert.ok(!gallery.includes('fetch('), 'gallery reads through the domain api module');
    const perms = fe('auth/permissions.ts');
    assert.ok(perms.includes('if (viewOrSlug === "workspace") return me.isRoot'), 'gallery stays root-only');
  });

  it('person workspace replaces the sheet pile (sales-head first, tabbed)', () => {
    // Old tile grid is retired — the session page branches: single custom
    // dashboard for sales-head/root, tabbed pile for everyone else.
    const session = fe('views/session/SessionView.tsx');
    assert.ok(!session.includes('WorkspaceGrid'), 'old tile grid must be retired');
    assert.ok(session.includes('SalesHeadDashboard'), 'session page must render the custom Sales Head dashboard');
    assert.ok(session.includes('PersonWorkspace'), 'other roles keep the tabbed pile until their pack ships');

    const head = fe('views/workspace/SalesHeadDashboard.tsx');
    for (const panel of ['TelecallingDashboard', 'ZohoEstimates', 'EnquiryTracker', 'MasterDataView', 'SalesDispatchPanel', 'FieldStaffPanel', 'SalesObjectionsPanel', 'SalesControllerPanel']) {
      assert.ok(head.includes(panel), `Sales Head page must compose the real ${panel} (never a copy)`);
    }
    assert.ok(head.includes('LazySection'), 'below-fold sections must lazy-mount (paint stays fast)');
    assert.ok(head.includes('NotificationDock'), 'delay bell rides the custom dashboard');
    assert.ok(head.includes('completeAction'), 'act-as must reuse the audited complete path');
    assert.ok(!head.includes('fetch('), 'custom dashboard must go through domain api modules');

    const motion = fe('components/ui/motion.tsx');
    assert.ok(motion.includes('LazySection'), 'lazy-mount lives in the shared kit (reused per pack)');

    const person = fe('views/workspace/PersonWorkspace.tsx');
    assert.ok(person.includes('WorkspaceRenderer'), 'fallback pile renders the REAL sheet components');
    assert.ok(person.includes('NotificationDock'), 'delay bell rides every tab');

    const page = fe('app/page.tsx');
    assert.ok(page.includes('strictSingle'), 'sales-head deep links redirect to their Workspace home');
  });
});
