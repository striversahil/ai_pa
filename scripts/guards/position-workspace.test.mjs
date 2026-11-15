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
  it('registry titles are real chart positions; phase-1 packs are the answered two', () => {
    assert.ok(reg.positionDashboard('Sales Head'), 'Sales Head pack must exist');
    assert.ok(reg.positionDashboard('Telecaller'), 'Telecaller pack must exist');
    assert.equal(reg.isPhaseOneTitle('Sales Head'), true);
    assert.equal(reg.isPhaseOneTitle('Telecaller'), true);
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

  it('builder is root-only and staff sheets are untouched', () => {
    const perms = fe('auth/permissions.ts');
    assert.ok(perms.includes('if (viewOrSlug === "workspace") return me.isRoot'), 'workspace view must be root-only');
    const nav = fe('components/layout/nav.tsx');
    assert.ok(nav.includes('workspace'), 'nav must include the builder view');
    const page = fe('app/page.tsx');
    assert.ok(page.includes('WorkspaceBuilderView'), 'page must mount the builder');
    const view = fe('views/workspace/WorkspaceView.tsx');
    assert.ok(view.includes('staff still see their automation sheets'), 'preview banner must state staff are untouched');
    assert.ok(view.includes('completeAction'), 'act-as must reuse the audited complete path');
    assert.ok(!view.includes('fetch('), 'view must go through domain api modules (no inline fetch)');
  });
});
