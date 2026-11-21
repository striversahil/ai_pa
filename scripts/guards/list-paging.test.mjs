// list-paging.test.mjs — founder paging standard (2026-11-21): page numbers,
// 50 rows (max 100), whole-table server search, COUNT totals, change banner.
// Locks the shared helpers (BE shared/paging.ts ↔ FE lib/paging.ts) and the
// product-line rollout (no capped whole-table rate slice may come back).
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
