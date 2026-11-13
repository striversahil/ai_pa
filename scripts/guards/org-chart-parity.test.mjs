// org-chart-parity.test.mjs — Guard: the organization chart is one source of truth.
//
// The founder edits the repo-root `organization.json`; the app reads
// `founder-os_frontend/src/hr/organization.ts`, which carries a VERBATIM copy
// (ORG_CHART_JSON) because the frontend bundle cannot read a repo file at
// runtime. This guard is what keeps the copy honest.
//
// Locks the 2026-11-13 decisions:
//   · the chart is complete and connected — every position reaches the top;
//   · `count` is never part of the read model (seats come from the HR master);
//   · every chart title maps to a login-position decision (incl. MIS = none).
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleToFile, FRONTEND_SRC, REPO_ROOT } from './_bundle.mjs';

const JSON_PATH = join(REPO_ROOT, 'organization.json');
const source = JSON.parse(readFileSync(JSON_PATH, 'utf8'));

const bundlePath = bundleToFile(join(FRONTEND_SRC, 'hr', 'organization.ts'), {
  alias: { '@': FRONTEND_SRC },
});
const org = await import(pathToFileURL(bundlePath).href);

describe('organization chart parity (frontend mirror ↔ organization.json)', () => {
  it('ORG_CHART_JSON is a verbatim copy of the repo-root chart', () => {
    assert.deepEqual(
      JSON.parse(JSON.stringify(org.ORG_CHART_JSON)),
      source,
      'hr/organization.ts ORG_CHART_JSON drifted from organization.json — update both together',
    );
  });

  it('every chart position is exposed once, with its department and reporting line', () => {
    const expected = source.organization.departments.flatMap((d) =>
      d.positions.map((p) => ({ title: p.title, department: d.name, reportsTo: p.reports_to })),
    );
    assert.deepEqual(
      org.ORG_POSITIONS.map((p) => ({ title: p.title, department: p.department, reportsTo: p.reportsTo })),
      expected,
    );
    const titles = org.ORG_POSITIONS.map((p) => p.title);
    assert.equal(new Set(titles).size, titles.length, 'a chart title appears twice — seats would double-count');
    assert.deepEqual(org.ORG_DEPARTMENTS, source.organization.departments.map((d) => d.name));
    assert.equal(org.ORG_TOP_POSITION, source.organization.top_position);
  });

  it('`count` never reaches the read model (seats come from the HR employee master)', () => {
    for (const position of org.ORG_POSITIONS) {
      assert.equal('count' in position, false, `${position.title} leaks the chart count into the read model`);
    }
    const tree = org.buildOrgTree();
    const walk = (node) => {
      assert.equal('count' in node, false, `${node.title} leaks the chart count into the tree`);
      node.children.forEach(walk);
    };
    walk(tree);
  });

  it('every position is reachable from the top (no orphan appended at the root)', () => {
    const tree = org.buildOrgTree();
    const seen = new Set();
    const walk = (node) => {
      if (!node.isTop) seen.add(node.title);
      node.children.forEach(walk);
    };
    walk(tree);
    const titles = org.ORG_POSITIONS.map((p) => p.title);
    assert.deepEqual([...seen].sort(), [...titles].sort(), 'a position does not hang off the reporting tree');
    assert.deepEqual(
      tree.children.map((c) => c.title).sort(),
      titles.filter((t) => {
        const parent = source.organization.departments
          .flatMap((d) => d.positions)
          .find((p) => p.title === t).reports_to;
        return parent === source.organization.top_position;
      }).sort(),
      'top-level children must be exactly the positions reporting to the top position',
    );
  });

  it('department heads are flagged once and report to the top', () => {
    for (const dept of source.organization.departments) {
      if (!dept.head) continue;
      const match = org.ORG_POSITIONS.filter((p) => p.title === dept.head);
      assert.equal(match.length, 1, `${dept.name} head "${dept.head}" is not exactly one chart position`);
      assert.equal(match[0].isHead, true, `${dept.head} must be flagged as its department head`);
      assert.equal(match[0].department, dept.name, `${dept.head} must belong to ${dept.name}`);
    }
  });

  it('every title has an explicit login-position decision', () => {
    for (const p of org.ORG_POSITIONS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(org.LOGIN_POSITIONS_BY_TITLE, p.title),
        `${p.title} has no login-position mapping — add it (empty array = org label only)`,
      );
    }
    // Founder decision 2026-11-12: MIS is an org label only, the `mis` scope is retired.
    assert.deepEqual(org.loginPositionsFor('MIS'), [], 'MIS must grant no dashboard position');
    assert.equal(org.isOrgLabelOnly('MIS'), true);
    // Both accountant levels share the single `accountant` login position.
    assert.deepEqual(org.loginPositionsFor('Senior Accountant'), ['accountant']);
    assert.deepEqual(org.loginPositionsFor('Junior Accountant'), ['accountant']);
  });

  it('wings group the chart into Sales / Marketing / Operations (display-only)', () => {
    // Founder reading: Sales = whole Sales dept, Marketing = Digital
    // Marketing, Operations = MIS + Procurement + HR + Accounts. Departments
    // and permissions are untouched — the graph colours/legend group by wing.
    assert.deepEqual(org.wingOfDepartment('Sales'), 'Sales');
    assert.deepEqual(org.wingOfDepartment('Digital Marketing'), 'Marketing');
    assert.deepEqual(org.wingOfDepartment('Accounts'), 'Operations');
    assert.deepEqual(org.wingOfDepartment('Operations & Support'), 'Operations');
    for (const d of org.ORG_DEPARTMENTS) {
      assert.ok(org.wingOfDepartment(d), `${d} has no wing — the graph legend would miss it`);
    }
    assert.deepEqual(org.wingOfTitle('Telecaller'), 'Sales');
    assert.deepEqual(org.wingOfTitle('Digital Marketing - Junior'), 'Marketing');
    assert.deepEqual(org.wingOfTitle('Senior Accountant'), 'Operations');
    assert.deepEqual(org.wingOfTitle('MIS'), 'Operations');
    assert.deepEqual(org.wingOfTitle('nope'), null);
  });

  it('title lookup is trimmed + tolerant of unknown/legacy free text', () => {
    assert.equal(org.isOrgTitle('  Telecaller '), true);
    assert.equal(org.isOrgTitle('SR. SALES EXEC'), false);
    assert.equal(org.orgPosition('nope'), null);
    assert.equal(org.loginPositionsFor('nope').length, 0);
  });

  it('legacy suggestions always resolve to a real chart position', () => {
    for (const [from, to] of Object.entries(org.LEGACY_TITLE_SUGGESTIONS)) {
      assert.equal(org.isOrgTitle(to), true, `suggestion "${from}" → "${to}" is not a chart position`);
      assert.equal(org.suggestOrgTitle(from), to);
      // never a silent rewrite: the suggestion only triggers on non-chart text
      assert.equal(org.isOrgTitle(from), false, `"${from}" is already a chart title — drop the suggestion`);
    }
  });

  it('ambiguous legacy text is never guessed', () => {
    // "Sale Coordinator" could be Telecaller or MIS — HR decides (no suggestion).
    assert.equal(org.suggestOrgTitle('Sale Coordinator'), null);
    assert.equal(org.suggestOrgTitle('Sales Co-ordinator'), null);
    assert.equal(org.suggestOrgTitle(''), null);
    assert.equal(org.suggestOrgTitle('Telecaller'), null, 'a chart title needs no suggestion');
  });

  it('suggestion lookup tolerates case, dots and extra spaces', () => {
    assert.equal(org.suggestOrgTitle('jr. accountant'), 'Junior Accountant');
    assert.equal(org.suggestOrgTitle('JR.  ACCOUNTANT'), 'Junior Accountant');
    assert.equal(org.suggestOrgTitle('j.r. accountant'), 'Junior Accountant', 'dots are stripped, not matched literally');
    assert.equal(org.suggestOrgTitle('Sr Telecaller'), 'Telecaller', 'the stored "Sr. Telecaller" key is dot-free too');
    assert.equal(org.suggestOrgTitle('Senior Telecaller'), null, 'a different spelling is a different string — no guess');
  });
});
