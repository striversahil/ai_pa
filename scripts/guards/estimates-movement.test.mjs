// estimates-movement.test.mjs — the Analyzer movement endpoint aggregates
// sales orders over a custom range + region without guessing.
//
// Locks: normalizeMovementRange (invalid ends → today, from>to swaps),
// bucketOf (only R1–R4 pass, everything else is UNMAPPED),
// aggregateSalesOrderMovement (date-window + org + region filter, per-region
// totals over the date+org scope, newest-first rows). Region resolution itself
// (masterHomeRegions: normalized exact, single-region only) is locked by
// scripts/guards/enquiry-region-writeback.test.mjs — this guard only feeds it
// pre-resolved buckets, never re-implements the rule.
// Mirror: founder-os_backend/src/modules/estimates/movement-parts/pure.ts.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/estimates-movement.test.mjs`
// Exit: 0 = invariant holds, 1 = regression.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const { normalizeMovementRange, normalizeRegionParam, bucketOf, aggregateSalesOrderMovement } = await import(
  bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'estimates', 'movement-parts', 'pure.ts'))
);

const row = (over = {}) => ({
  so: 'SO-1', ref: '', customer: 'Acme', total: 100, status: 'open',
  createdDate: '2026-11-10', org: '676267428', region: '', bucket: 'UNMAPPED',
  ...over,
});

describe('movement range normalization', () => {
  it('passes a valid range through', () => {
    assert.deepEqual(normalizeMovementRange('2026-11-01', '2026-11-10', '2026-11-14'), { from: '2026-11-01', to: '2026-11-10' });
  });

  it('invalid ends fall back to today', () => {
    assert.deepEqual(normalizeMovementRange(undefined, 'nope', '2026-11-14'), { from: '2026-11-14', to: '2026-11-14' });
  });

  it('swaps a reversed range', () => {
    assert.deepEqual(normalizeMovementRange('2026-11-10', '2026-11-01', '2026-11-14'), { from: '2026-11-01', to: '2026-11-10' });
  });
});

describe('region buckets', () => {
  it('passes R1–R4, everything else is UNMAPPED', () => {
    assert.equal(bucketOf('R2'), 'R2');
    assert.equal(bucketOf('r3'), 'R3');
    assert.equal(bucketOf(''), 'UNMAPPED');
    assert.equal(bucketOf('R5'), 'UNMAPPED');
    assert.equal(bucketOf(null), 'UNMAPPED');
  });

  it('normalizes the region param', () => {
    assert.equal(normalizeRegionParam('r1'), 'R1');
    assert.equal(normalizeRegionParam('unmapped'), 'UNMAPPED');
    assert.equal(normalizeRegionParam('junk'), 'all');
    assert.equal(normalizeRegionParam(''), 'all');
  });
});

describe('sales-order aggregation', () => {
  const rows = [
    row({ so: 'SO-1', createdDate: '2026-11-10', total: 100, bucket: 'R1' }),
    row({ so: 'SO-2', createdDate: '2026-11-12', total: 200, bucket: 'R2', org: '744573214' }),
    row({ so: 'SO-3', createdDate: '2026-11-12', total: 300, bucket: 'UNMAPPED' }),
    row({ so: 'SO-4', createdDate: '2026-10-01', total: 400, bucket: 'R1' }),
  ];
  const params = { from: '2026-11-01', to: '2026-11-14', region: 'all', org: 'all' };

  it('filters to the date window and sums', () => {
    const r = aggregateSalesOrderMovement(rows, params);
    assert.equal(r.salesOrders.count, 3);
    assert.equal(r.salesOrders.totalValue, 600);
  });

  it('filters by org', () => {
    const r = aggregateSalesOrderMovement(rows, { ...params, org: '744573214' });
    assert.equal(r.salesOrders.count, 1);
    assert.equal(r.salesOrders.rows[0].so, 'SO-2');
  });

  it('filters by region and keeps per-region totals over the whole scope', () => {
    const r = aggregateSalesOrderMovement(rows, { ...params, region: 'R1' });
    assert.equal(r.salesOrders.count, 1);
    assert.equal(r.salesOrders.rows[0].so, 'SO-1');
    assert.equal(r.byRegion.R1.count, 1);
    assert.equal(r.byRegion.R2.count, 1);
    assert.equal(r.byRegion.UNMAPPED.count, 1);
    assert.equal(r.byRegion.R1.totalValue, 100);
  });

  it('UNMAPPED region selects only unmapped rows', () => {
    const r = aggregateSalesOrderMovement(rows, { ...params, region: 'UNMAPPED' });
    assert.equal(r.salesOrders.count, 1);
    assert.equal(r.salesOrders.rows[0].so, 'SO-3');
  });

  it('sorts rows newest first', () => {
    const r = aggregateSalesOrderMovement(rows, params);
    assert.deepEqual(r.salesOrders.rows.map((x) => x.so), ['SO-2', 'SO-3', 'SO-1']);
  });

  it('drops rows with blank or unparsable dates', () => {
    const r = aggregateSalesOrderMovement([...rows, row({ so: 'SO-X', createdDate: '' })], params);
    assert.equal(r.salesOrders.count, 3);
  });
});
