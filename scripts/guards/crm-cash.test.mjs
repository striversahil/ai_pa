// crm-cash.test.mjs — Guard: dispatch cash lives on the CRM floor, and the
// scheduling queue is the CRM desk's.
//
// Founder request 2026-11-26, two parts:
//   1. the dispatch-cash ledger moves COMPLETELY to the dispatch floor — one
//      address (/api/crm/cash), no Accounts tab, no Accounts payload fields;
//   2. a dispatch-only login does not see "To Schedule" (the floor ships what
//      is already dated; the CRM desk owns scheduling).
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { BACKEND_DIR, FRONTEND_SRC, REPO_ROOT } from './_bundle.mjs';

const be = (p) => readFileSync(join(BACKEND_DIR, 'src', p), 'utf8');
const fe = (p) => readFileSync(join(FRONTEND_SRC, p), 'utf8');

describe('dispatch cash is a floor surface', () => {
  const route = be('worker/routes/crm-cash.ts');

  it('serves the ledger at /api/crm/cash (read + add + correct + void)', () => {
    for (const m of ['app.get', 'app.post', 'app.patch', 'app.delete']) {
      assert.ok(route.includes(`${m}('/api/crm/cash`), `${m} missing on /api/crm/cash`);
    }
    assert.ok(route.includes('registerCrmCashRoutes'));
    assert.ok(be('worker.ts').includes('registerCrmCashRoutes(app)'), 'route module not registered');
  });

  it('gates on the floor + accounts, never on accounts alone', () => {
    for (const key of ['ScopeKeys.Accounts', 'ScopeKeys.Crm', 'ScopeKeys.Dispatch']) {
      assert.ok(route.includes(key), `${key} missing from the cash gate`);
    }
    assert.ok(route.includes('me.isAdmin'));
    assert.ok(!route.includes('cashWriteGate'), 'the old accounts-only write gate is gone by design');
  });

  it('the ledger core is reused, not forked', () => {
    assert.ok(route.includes("from '../../automations/accounts/cash'"));
    assert.ok(!readFileSync(join(BACKEND_DIR, 'src/automations/accounts/cash.ts'), 'utf8').includes('crm'));
  });

  it('Accounts lost the cash routes and the payload fields', () => {
    const accounts = be('worker/routes/accounts.ts');
    assert.ok(!accounts.includes('/api/accounts/cash'), 'Accounts still serves a cash route');
    assert.ok(!accounts.includes('listCashEntries'), 'Accounts still imports the ledger');
    const io = be('automations/accounts/service-parts/io.ts');
    for (const field of ['cashEntries', 'cashSummary', 'listCashEntries', "timed('cash'"]) {
      assert.ok(!io.includes(field), `accounts payload still carries ${field}`);
    }
  });

  it('the panel moved to the CRM domain and calls the new address', () => {
    const panel = fe('crm/DispatchCash.tsx');
    assert.ok(!panel.includes('/api/accounts/cash'), 'old address left behind');
    assert.ok(panel.includes('/api/crm/cash'), 'new address missing');
    assert.ok(!existsSync(join(FRONTEND_SRC, 'components/accounts/DispatchCash.tsx')), 'the old Accounts panel is still on disk');
  });

  it('Accounts renders no cash tab, types keep none', () => {
    const dash = fe('components/AccountsDashboard.tsx');
    assert.ok(!dash.includes('Dispatch cash'), 'Accounts still offers the tab');
    assert.ok(!dash.includes('DispatchCash'));
    const types = fe('components/accounts-dashboard/types.ts');
    assert.ok(!/cash/i.test(types), 'accounts types still name cash');
    const accountsView = types.slice(types.indexOf('export type AccountsView'));
    assert.ok(!accountsView.includes('"cash"'), 'AccountsView still has a cash member');
  });

  it('the floor tab renders the ledger only when its tab is open', () => {
    const dash = fe('components/CrmDashboard.tsx');
    assert.ok(dash.includes('CASH_TAB'), 'no cash tab on the floor');
    assert.ok(dash.includes('canFloorWrite ? [CASH_TAB] : []'), 'cash tab is not floor-gated');
    assert.ok(dash.includes('<CrmCashPanel canWrite={canFloorWrite} />'));
    const shell = fe('components/CrmCashPanel.tsx');
    assert.ok(shell.includes('useCrmCash'), 'the ledger is not fetched through the domain hook');
    assert.ok(fe('crm/api.ts').includes('cash: () =>'));
    assert.ok(fe('crm/hooks.ts').includes('export function useCrmCash'));
  });
});

describe('a dispatch-only login does not see the scheduling queue', () => {
  it('the server answers canSchedule = CRM desk or root', () => {
    const crm = be('worker/routes/crm.ts');
    assert.ok(crm.includes('canSchedule'), 'viewerMeta does not expose canSchedule');
    assert.match(crm, /canSchedule: isAdmin \|\| scopes\.includes\(ScopeKeys\.Crm\)/);
    assert.match(crm, /canSchedule: v\.canSchedule/);
    assert.ok(crm.includes('canSchedule: boolean;'), 'the Viewer type does not carry canSchedule');
  });

  it('the tab bar drops To Schedule for a dispatch-only floor writer', () => {
    const dash = fe('components/CrmDashboard.tsx');
    assert.ok(dash.includes('viewer.canSchedule'), 'the tab does not read the server flag');
    assert.ok(
      dash.includes('t.key !== "unscheduled" || canSchedule || !canFloorWrite'),
      'the unscheduled tab is not gated on canSchedule',
    );
  });

  it('the scheduling entry points disappear with the tab', () => {
    assert.ok(fe('crm/OrderCard.tsx').includes('flags.canSchedule && canSchedule'));
    const panel = fe('crm/OrderPanel.tsx');
    assert.ok(
      panel.includes('promiseOnly ? key === "view" || key === "schedule" : canSchedule || key !== "schedule"'),
      'the panel still offers a schedule mode',
    );
    assert.ok(panel.includes('initialMode === "schedule" && !canSchedule'), 'a deep-linked schedule mode is not neutralised');
    assert.ok(fe('components/CrmDashboard.tsx').includes('canSchedule={canSchedule}'), 'the flag is not passed down');
  });

  it('visibility only — floor writes stay unchanged', () => {
    const crm = be('worker/routes/crm.ts');
    assert.ok(crm.includes('requireDispatchWrite'), 'the floor write gate vanished');
    assert.ok(!/canSchedule[^;]*403/.test(crm), 'canSchedule must not gate the API');
  });
});
