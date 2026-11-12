// workspace-scoping.test.mjs — viewer scoping for workspace data reads
// (modules/workspaces/scoping.ts), with fake resolvers.
//
// Locks the behavior that used to live inline in GET /api/automations/:slug/data:
// who gets their own slice, who gets the full view, who is refused, and which
// errors are swallowed. The anonymous paths are additionally covered end-to-end
// by founder-os_backend/scripts/workspace-parity.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const sc = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'workspaces', 'scoping.ts')));

const me = (scopes = [], extra = {}) => ({ user: { email: 'x@y' }, scopes, roles: [], isAdmin: false, isRoot: false, ...extra });
const ADMIN = me([], { isAdmin: true });

function resolvers(viewer, over = {}) {
  return {
    loadMe: async () => viewer,
    resolveSelfTelecallerId: async () => 'tc-42',
    resolveSelfAccountant: async (as) => `acct:${as ?? 'session'}`,
    resolveSelfDigitalMarketingManager: async (as) => `dm:${as ?? 'session'}`,
    resolveSelfHumanResourcesMember: async () => 'hr-self',
    accessScopesFor: (slug) => (slug === 'debtors-tracker' ? ['debtors-tracker', 'payment-tracker', 'accounts'] : [slug]),
    canViewMaster: (m) => !!m && (m.isAdmin || m.scopes.includes('master-data')),
    viewableDepartments: (m) => (m && m.scopes.includes('reporting-sheet') ? ['sales'] : []),
    ...over,
  };
}
const run = (slug, viewer, query = {}, over) => sc.scopeWorkspaceQuery(slug, query, resolvers(viewer, over));

describe('telecalling', () => {
  it('drops client selfAgentId for anonymous viewers (public endpoint)', async () => {
    assert.deepEqual(await run('telecalling', null, { selfAgentId: 'evil', converters: '1' }), { ok: true, query: { converters: '1' } });
  });
  it('injects the agent roster id for a plain telecaller', async () => {
    assert.deepEqual(await run('telecalling', me(['telecalling']), { selfAgentId: 'evil' }), { ok: true, query: { selfAgentId: 'tc-42' } });
  });
  for (const [label, v] of [['admin', ADMIN], ['sales-head', me(['sales-head'])]]) {
    it(`${label} sees the full team`, async () => {
      assert.deepEqual(await run('telecalling', v, { selfAgentId: 'evil' }), { ok: true, query: {} });
    });
  }
  it('an unknown scope grants nothing (no stale-scope backdoor)', async () => {
    assert.deepEqual(await run('telecalling', me(['ghost']), { selfAgentId: 'evil' }), { ok: true, query: { selfAgentId: 'tc-42' } });
  });
  it('swallows lookup errors (unscoped, never the client id)', async () => {
    const r = await run('telecalling', me(['telecalling']), { selfAgentId: 'evil' }, { resolveSelfTelecallerId: async () => { throw new Error('d1'); } });
    assert.deepEqual(r, { ok: true, query: {} });
  });
  it('does not mutate the caller query object', async () => {
    const q = { selfAgentId: 'evil' };
    await run('telecalling', null, q);
    assert.deepEqual(q, { selfAgentId: 'evil' });
  });
});

describe('accounts / digital-marketing lanes', () => {
  it('non-admin gets own lane via ?as=', async () => {
    assert.deepEqual((await run('accounts', me(['accounts']), { as: 'ravi' })).query.scope, { scope: 'acct:ravi', isAdmin: false });
    assert.deepEqual((await run('digital-marketing', me(['digital-marketing']))).query.scope, { scope: 'dm:session', isAdmin: false });
  });
  it('admin gets the full view; unknown scopes buy nothing', async () => {
    assert.deepEqual((await run('accounts', ADMIN)).query.scope, { scope: null, isAdmin: true });
    assert.deepEqual((await run('digital-marketing', me(['ghost']))).query.scope, { scope: 'dm:session', isAdmin: false });
  });
  it('anonymous stays unscoped', async () => {
    assert.deepEqual(await run('accounts', null, { as: 'x' }), { ok: true, query: { as: 'x' } });
  });
});

describe('human-resources', () => {
  it('HR grant = full view; others = self only', async () => {
    assert.deepEqual((await run('human-resources', me(['human-resources']))).query.scope, { scope: null, isAdmin: true });
    assert.deepEqual((await run('human-resources', me(['sales']))).query.scope, { scope: 'hr-self', isAdmin: false });
  });
});

describe('guarded workspaces', () => {
  it('debtors-tracker: 401 anonymous, 403 without scope, ok via legacy accounts scope', async () => {
    assert.deepEqual(await run('debtors-tracker', null), { ok: false, status: 401, error: 'Authentication required' });
    assert.deepEqual(await run('debtors-tracker', me(['stock'])), { ok: false, status: 403, error: "Requires 'debtors-tracker' permission" });
    assert.equal((await run('debtors-tracker', me(['accounts']))).ok, true);
    assert.equal((await run('debtors-tracker', ADMIN)).ok, true);
  });
  it('debtors-tracker rethrows non-auth errors (→ 404 upstream)', async () => {
    await assert.rejects(run('debtors-tracker', null, {}, { loadMe: async () => { throw new Error('d1 down'); } }));
  });
  it('master-data: 403 without grant, 403 on lookup failure', async () => {
    assert.deepEqual(await run('master-data', me(['sales'])), { ok: false, status: 403, error: "Requires 'master-data' permission" });
    assert.deepEqual(await run('master-data', ADMIN, {}, { loadMe: async () => { throw new Error('x'); } }), { ok: false, status: 403, error: "Requires 'master-data' permission" });
    assert.equal((await run('master-data', me(['master-data']))).ok, true);
  });
  it('reporting-sheet: 403 without departments; attaches the viewer otherwise', async () => {
    assert.deepEqual(await run('reporting-sheet', me(['sales'])), { ok: false, status: 403, error: "Requires 'reporting-sheet' permission" });
    const v = me(['reporting-sheet']);
    assert.deepEqual(await run('reporting-sheet', v), { ok: true, query: { reportingMe: v } });
  });
});

describe('unscoped workspaces', () => {
  it('pass the query through untouched', async () => {
    assert.deepEqual(await run('stock', null, { a: '1' }), { ok: true, query: { a: '1' } });
  });
});
