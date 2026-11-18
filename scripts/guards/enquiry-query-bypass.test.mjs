// enquiry-query-bypass.test.mjs — Guard: bypassed items run no query loop.
//
// Live incident (Nov-2026): Enquiry No 18 - 13 NOV TL sat stuck in
// Management Review > Estimates Query > Needs action even though every
// item was marked rateAvailable. Root cause: hasOpenQuery counted open
// query loops on bypassed items (rateAvailable/notAvailable/internalRates)
// while applyLoopOps already refuses NEW asks on them — the stranded open
// stayed visible forever with no desk able to clear it by quoting.
//
// Invariant (backend queues.ts + frontend enquiry/queue.ts, change together):
//   1. open query on a bypassed item is invisible to hasOpenQuery,
//      hasPendingVariationWork and hasRoutedQuery (both sides agree),
//   2. the same loops with the bypass removed are visible again
//      (filter-only: toggle-off restores, no mutation),
//   3. open query on a quotable item still shows.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/enquiry-query-bypass.test.mjs`
// Exit: 0 = invariant holds, 1 = regression.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BACKEND_DIR, FRONTEND_SRC, bundleToFile } from './_bundle.mjs';

const be = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'queues.ts')));
const fe = await import(bundleToFile(join(FRONTEND_SRC, 'enquiry', 'queue.ts'), { alias: { '@': FRONTEND_SRC } }));

const qMgmt = {
  id: 'lp_q_mgmt', kind: 'query', text: 'MS - 4 feet width /1250mm',
  openedBy: 'sales', openedAt: '2026-11-13T12:40:00.000Z',
  holder: 'management', status: 'open',
};
const qProc = {
  id: 'lp_q_proc', kind: 'query', text: 'alternate make?',
  openedBy: 'sales', openedAt: '2026-11-13T12:40:00.000Z',
  holder: 'procurement', status: 'open',
  forwarded: { by: 'management', at: '2026-11-13T12:41:00.000Z', from: 'management', to: 'procurement' },
};

// Live shape: Enquiry No 18 - 13 NOV TL — 3x rateAvailable, one stranded open query.
const liveEnquiry = {
  items: [
    { name: 'Sefar', rateAvailable: true, loops: [] },
    { name: 'Wire Mesh', rateAvailable: true, loops: [{ ...qMgmt }] },
    { name: 'Wire Mesh', rateAvailable: true, loops: [] },
  ],
};

const bypassVariants = [
  ['rateAvailable', { name: 'x', rateAvailable: true, loops: [{ ...qMgmt }] }],
  ['notAvailable', { name: 'x', notAvailable: true, loops: [{ ...qMgmt }] }],
  ['internalRates', { name: 'x', internalRates: true, loops: [{ ...qMgmt }] }],
];

describe('query bypass: stranded opens on bypassed items stay out of queues', () => {
  it('live case hidden on both sides (backend + frontend agree)', () => {
    assert.strictEqual(be.hasOpenQuery(liveEnquiry), false);
    assert.strictEqual(fe.hasOpenQuery(liveEnquiry), false);
    assert.strictEqual(be.hasRoutedQuery(liveEnquiry, 'management'), false);
    assert.strictEqual(fe.hasRoutedQuery(liveEnquiry, 'management'), false);
  });

  for (const [label, item] of bypassVariants) {
    it(`${label}: open query hidden (both sides)`, () => {
      const e = { items: [item] };
      assert.strictEqual(be.hasOpenQuery(e), false, `backend ${label}`);
      assert.strictEqual(fe.hasOpenQuery(e), false, `frontend ${label}`);
    });

    it(`${label}: forwarded query does not reopen procurement`, () => {
      const e = { items: [{ ...item, loops: [{ ...qProc }] }] };
      assert.strictEqual(be.hasPendingVariationWork(e), false);
      assert.strictEqual(fe.hasPendingVariationWork(e), false);
    });
  }

  it('quotable item with open query still shows (both sides)', () => {
    const e = { items: [{ name: 'x', loops: [{ ...qMgmt }] }] };
    assert.strictEqual(be.hasOpenQuery(e), true);
    assert.strictEqual(fe.hasOpenQuery(e), true);
    assert.strictEqual(be.hasRoutedQuery(e, 'management'), true);
    assert.strictEqual(fe.hasRoutedQuery(e, 'management'), true);
    const fwd = { items: [{ name: 'x', loops: [{ ...qProc }] }] };
    assert.strictEqual(be.hasPendingVariationWork(fwd), true);
    assert.strictEqual(fe.hasPendingVariationWork(fwd), true);
  });

  it('toggle-off restores visibility (filter-only, no mutation)', () => {
    const bypassed = { items: [{ name: 'x', rateAvailable: true, loops: [{ ...qMgmt }] }] };
    const restored = { items: [{ name: 'x', rateAvailable: false, loops: [{ ...qMgmt }] }] };
    assert.strictEqual(be.hasOpenQuery(bypassed), false);
    assert.strictEqual(be.hasOpenQuery(restored), true);
    assert.strictEqual(fe.hasOpenQuery(bypassed), false);
    assert.strictEqual(fe.hasOpenQuery(restored), true);
  });
});
