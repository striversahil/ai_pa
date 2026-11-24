// sales-range.test.mjs — the Sales leaderboard's custom from -> to filter.
//
// The board is a pure from->to window; presets are only a name->dates resolver.
// resolvePeriod is the ONE place a client range is validated, so the cache key,
// the working-day target and every downstream read see the same normalized
// window. Locks: swap, no-future clamp, the 93-day cap, preset parity, the
// precedence (from/to > period) and the day mode (null).
// Mirror: founder-os_backend/src/automations/telecalling/service-parts/pure.ts.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/sales-range.test.mjs`
// Exit: 0 = invariant holds, 1 = regression.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const { resolvePeriod, periodRange, periodPrefix, MAX_CUSTOM_RANGE_DAYS } = await import(
  bundleToFile(join(BACKEND_DIR, 'src', 'automations', 'telecalling', 'service-parts', 'pure.ts'))
);

const TODAY = '2026-11-23';
const IO = join(BACKEND_DIR, 'src', 'automations', 'telecalling', 'service-parts', 'io.ts');
const spanOf = (w) => Math.round((Date.parse(w.to) - Date.parse(w.from)) / 86_400_000) + 1;

describe('sales range — custom from -> to window', () => {
  it('passes a valid range through, labelled and typed', () => {
    assert.deepEqual(resolvePeriod({ from: '2026-11-01', to: '2026-11-10' }, TODAY), {
      from: '2026-11-01', to: '2026-11-10', label: 'Custom range', kind: 'custom', clamped: false,
    });
  });

  it('swaps a reversed range (a date picker can emit them in either order)', () => {
    assert.deepEqual(resolvePeriod({ from: '2026-11-10', to: '2026-11-01' }, TODAY), {
      from: '2026-11-01', to: '2026-11-10', label: 'Custom range', kind: 'custom', clamped: false,
    });
  });

  it('never reaches into the future — that would inflate the ₹/working-day target', () => {
    const w = resolvePeriod({ from: '2026-11-01', to: '2027-03-01' }, TODAY);
    assert.equal(w.to, TODAY);
    assert.equal(w.from, '2026-11-01');
  });

  it('caps the span at MAX_CUSTOM_RANGE_DAYS and flags it', () => {
    const w = resolvePeriod({ from: '2026-01-01', to: TODAY }, TODAY);
    assert.equal(w.clamped, true);
    assert.equal(spanOf(w), MAX_CUSTOM_RANGE_DAYS);
    assert.equal(w.to, TODAY);
  });

  it('a range at the cap is NOT flagged', () => {
    const from = new Date(Date.UTC(2026, 10, 23) - (MAX_CUSTOM_RANGE_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
    const w = resolvePeriod({ from, to: TODAY }, TODAY);
    assert.equal(spanOf(w), MAX_CUSTOM_RANGE_DAYS);
    assert.equal(w.clamped, false);
  });

  it('needs BOTH ends: a lone date falls back to the preset path', () => {
    assert.equal(resolvePeriod({ from: '2026-11-01' }, TODAY), null);
    assert.equal(resolvePeriod({ period: 'month', from: '2026-11-01' }, TODAY).kind, 'preset');
  });

  it('from/to beat the period param', () => {
    const w = resolvePeriod({ period: 'year', from: '2026-11-02', to: '2026-11-05' }, TODAY);
    assert.equal(w.kind, 'custom');
    assert.equal(w.from, '2026-11-02');
  });

  it('junk ends fall through instead of producing a window', () => {
    assert.equal(resolvePeriod({ from: 'nope', to: '2026-11-01' }, TODAY), null);
    assert.equal(resolvePeriod({ from: 123, to: null }, TODAY), null);
  });

  it('presets resolve byte-identically to periodRange, typed as preset', () => {
    for (const p of ['week', 'lastweek', 'month', 'lastmonth', 'year', 'lastyear']) {
      assert.deepEqual(resolvePeriod({ period: p }, TODAY), { ...periodRange(p, TODAY), kind: 'preset' });
    }
  });

  it('keeps day mode (today / ?date=) as null', () => {
    assert.equal(resolvePeriod({}, TODAY), null);
    assert.equal(resolvePeriod({ period: 'today' }, TODAY), null);
  });

  it('prefix for the target line reads as a range, not a week', () => {
    assert.equal(periodPrefix('custom'), 'range');
  });
});

describe('sales range — the dashboard cache key rides the RESOLVED window', () => {
  const src = readFileSync(IO, 'utf8');

  it('the board key uses the resolved token, never the raw range', () => {
    assert.match(src, /telecalling:dashboard:\$\{revs\}:\$\{periodToken\}/);
    assert.ok(!src.includes('q.from'), 'raw client dates must never reach a key or a read');
  });

  it('the aggregation resolves the window once from the same helper', () => {
    assert.match(src, /const periodRangeInfo = resolvePeriod\(q, istDate\(\)\);/);
    assert.match(src, /const win = resolvePeriod\(q, istDate\(\)\);/);
  });

  it('the payload tells the header which mode it is in (and whether it was capped)', () => {
    assert.match(src, /periodKind: periodRangeInfo\?\.kind \?\? 'day',/);
    assert.match(src, /periodClamped: !!periodRangeInfo\?\.clamped,/);
  });
});
