// list-paging.test.mjs — founder paging standard (2026-11-21): page numbers,
// 50 rows (max 100), whole-table server search, COUNT totals, change banner.
// Locks the shared helpers (BE shared/paging.ts ↔ FE lib/paging.ts) and the
// product-line, Customer Master and Dispatch rollouts (no capped whole-table
// slice may come back; today's dispatches stay unpaged).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR, FRONTEND_SRC, bundleToFile } from './_bundle.mjs';

const BE_SRC = join(BACKEND_DIR, 'src');
const read = (p) => readFileSync(p, 'utf8');
const be = await import(bundleToFile(join(BE_SRC, 'shared', 'paging.ts')));
const fe = await import(bundleToFile(join(FRONTEND_SRC, 'lib', 'paging.ts')));

describe('shared paging helper', () => {
  it('page size mirrors backend ↔ frontend (50, max 100)', () => {
    assert.equal(be.PAGE_SIZE_DEFAULT, 50);
    assert.equal(be.PAGE_SIZE_MAX, 100);
    assert.equal(fe.PAGE_SIZE, be.PAGE_SIZE_DEFAULT);
  });

  it('parsePageQuery clamps page/limit and trims search', () => {
    const q = (o) => be.parsePageQuery((k) => o[k]);
    assert.deepEqual(q({}), { page: 1, limit: 50, offset: 0, q: '' });
    assert.deepEqual(q({ page: '3', limit: '20', q: '  belt ' }), { page: 3, limit: 20, offset: 40, q: 'belt' });
    assert.equal(q({ limit: '5000' }).limit, 100);
    assert.equal(q({ page: '-4' }).page, 1);
    assert.equal(q({ page: 'abc', limit: '0' }).limit, 50);
  });

  it('pageResult computes totalPages from the COUNT total', () => {
    assert.deepEqual(be.pageResult([], 6978, { page: 2, limit: 50 }), { rows: [], total: 6978, page: 2, limit: 50, totalPages: 140 });
    assert.equal(be.pageResult([], 0, { page: 1, limit: 50 }).totalPages, 1);
  });

  it('searchClause: every word must hit some column; wildcards escaped; D1 50-byte LIKE cap', () => {
    assert.deepEqual(be.searchClause(['a', 'b'], '   '), { sql: '', binds: [] });
    const s = be.searchClause(['a', 'b'], 'Rubber 50%_x');
    assert.equal(s.binds.length, 4);
    assert.match(s.sql, /^\(.+ OR .+\) AND \(.+ OR .+\)$/);
    assert.equal(s.binds[0], '%rubber%');
    assert.equal(s.binds[2], '%50\\%\\_x%');
    const long = be.searchClause(['a'], 'x'.repeat(200) + '%'.repeat(10));
    assert.ok(Buffer.byteLength(long.binds[0]) <= 50, 'LIKE pattern must fit D1 limit');
    assert.ok(!/(^|[^\\])\\%$/.test(long.binds[0]), 'no dangling escape before the closing %');
  });

  it('pageWindow keeps 7 slots with gaps', () => {
    assert.deepEqual(fe.pageWindow(1, 5), [1, 2, 3, 4, 5]);
    assert.deepEqual(fe.pageWindow(10, 140), [1, 2, '…', 9, 10, 11, '…', 139, 140]);
  });
});

describe('customer master is paged server-side', () => {
  const lq = read(join(BE_SRC, 'modules', 'master-data', 'list-query.ts'));
  const svc = read(join(BE_SRC, 'modules', 'master-data', 'service.ts'));
  const route = read(join(BE_SRC, 'worker', 'routes', 'master-data.ts'));
  const view = read(join(FRONTEND_SRC, 'components', 'master-data', 'MasterDataView.tsx'));
  const tab = read(join(FRONTEND_SRC, 'components', 'master-data', 'CustomersTab.tsx'));

  it('list/summary/duplicates/export routes are view-gated', () => {
    for (const p of ['/api/master-data/customers', '/api/master-data/summary', '/api/master-data/duplicates', '/api/master-data/export']) {
      const at = route.indexOf(`app.get('${p}'`);
      assert.ok(at >= 0, `missing ${p}`);
      assert.ok(route.slice(at, at + 400).includes('requireView(c)'), `${p} must requireView`);
    }
    assert.ok(lq.includes('pagedQuery') && lq.includes('LIVE_WHERE'), 'paged SQL over the live book');
  });

  it('no whole-book payload reaches the screen', () => {
    assert.ok(!svc.includes('listAllCustomers'), 'service must not load the whole book');
    assert.ok(view.includes('usePagedQuery') && !/getMasterData\b/.test(view), 'view pages via the shared hook');
    assert.ok(!/applyFilters|sortRows|summarizeRows|buildFilterOptions/.test(view + tab), 'no client-side filtering of the book');
    assert.ok(svc.includes('invalidateMasterSummaries'), 'writes must bust the cached summaries');
  });
});

describe('dispatch tabs are paged; today\'s dispatches stay complete', () => {
  const io = read(join(BE_SRC, 'modules', 'crm', 'store-parts', 'io.ts'));
  const page = read(join(BE_SRC, 'modules', 'crm', 'list-page.ts'));
  const route = read(join(BE_SRC, 'worker', 'routes', 'crm.ts'));
  const hooks = read(join(FRONTEND_SRC, 'crm', 'hooks.ts'));
  const floor = read(join(FRONTEND_SRC, 'components', 'CrmDashboard.tsx'));
  const sales = read(join(FRONTEND_SRC, 'components', 'SalesDispatchPanel.tsx'));

  it('floor scan is uncapped and shared by list + summary', () => {
    assert.ok(!/crmSalesOrder\.findMany\(\{[^}]*take:\s*\d+\s*\}\)\)\s*as any\[\];\s*const bySo/.test(io), 'no capped floor scan');
    assert.equal((io.match(/cachedFloorRows\(scanFloor\)/g) || []).length, 2, 'list + summary share scanFloor');
  });

  it('list route pages via the shared helper; dispatch-floor is never paged', () => {
    const at = route.indexOf("app.get('/api/crm/orders'");
    assert.ok(at >= 0 && route.slice(at, at + 500).includes('listOrdersPaged') && route.slice(at, at + 500).includes('parsePageQuery'));
    assert.ok(/UNPAGED_VIEWS[^=]*=\s*new Set<View>\(\['dispatch-floor'\]\)/.test(page), 'today\'s dispatches + overdue stay complete');
    assert.ok(page.includes('pageResult') && page.includes('withProofDocs'), 'proof docs only for the returned page');
  });

  it('both dispatch screens use the shared hook, pager and change banner', () => {
    assert.ok(hooks.includes('usePagedQuery<CrmOrder, ListResponse>(ORDERS_URL'), 'useCrmOrders = usePagedQuery');
    for (const [name, src] of [['CrmDashboard', floor], ['SalesDispatchPanel', sales]]) {
      assert.ok(src.includes('<Pager') && src.includes('<ChangesBanner'), `${name} renders Pager + ChangesBanner`);
      assert.ok(!/list\.data\?\.orders|useDebouncedValue/.test(src), `${name} has no whole-list read`);
    }
  });
});

describe('product-line rates are paged, never capped', () => {
  const io = read(join(BE_SRC, 'automations', 'product-line', 'service-parts', 'io.ts'));
  const route = read(join(BE_SRC, 'worker', 'routes', 'product-line.ts'));
  const dash = read(join(FRONTEND_SRC, 'components', 'ProductLineDashboard.tsx'));

  it('dashboard payload carries COUNT totals, not a rate slice', () => {
    assert.ok(!/vendorRate\.findMany\(\{\s*orderBy:[^}]*\}\]?,\s*take:/.test(io), 'no capped whole-table rate slice');
    assert.ok(io.includes('rateTotal'), 'payload must carry the COUNT total');
  });

  it('rates list + detail go through the paged endpoint', () => {
    assert.ok(route.includes("app.get('/api/product-line/rates'") && route.includes('parsePageQuery'), 'paged GET endpoint');
    assert.ok(route.includes('getProductSummary'), 'detail endpoint must not ship every rate');
    assert.ok(dash.includes('usePagedQuery'), 'dashboard uses the shared paged hook');
    assert.ok(!/data\?\.rates|detail\.rates/.test(dash), 'no client-side whole rate list');
  });
});
