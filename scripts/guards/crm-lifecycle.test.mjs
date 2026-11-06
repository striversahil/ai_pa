// crm-lifecycle.test.mjs — Guard: backend ↔ frontend dispatch-floor contract.
//
// The floor's rules exist twice on purpose (one copy per runtime):
//   backend  → src/modules/crm/scheduling.ts   + queues.ts
//   frontend → src/crm/lifecycle.ts           + queue.ts
// Both sides are bundled here and run over the same fixture corpus. Any
// disagreement — derived lifecycle, overdue verdict, tab membership, or the
// validation result of a schedule/reschedule/dispatch call — fails the guard.
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BACKEND_DIR, FRONTEND_SRC, bundleToFile } from './_bundle.mjs';

const be = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'crm', 'scheduling.ts')));
const fe = await import(bundleToFile(join(FRONTEND_SRC, 'crm', 'lifecycle.ts'), { alias: { '@': FRONTEND_SRC } }));
const beTypes = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'crm', 'types.ts')));
const feTypes = await import(bundleToFile(join(FRONTEND_SRC, 'crm', 'types.ts'), { alias: { '@': FRONTEND_SRC } }));
const beQ = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'crm', 'queues.ts')));
const feQ = await import(bundleToFile(join(FRONTEND_SRC, 'crm', 'queue.ts'), { alias: { '@': FRONTEND_SRC } }));

const TODAY = '2026-11-03';

// ── Fixtures: every branch of the state machine ────────────────────────────
const item = (over = {}) => ({
  id: 'i1',
  dispatchState: 'unscheduled',
  tentativeDispatchDate: null,
  delayReason: null,
  qty: 10,
  dispatchedQty: 0,
  ...over,
});

const ITEM_SETS = {
  empty: [],
  allUnscheduled: [item({ id: 'a' }), item({ id: 'b' })],
  allScheduled: [item({ id: 'a', dispatchState: 'scheduled', tentativeDispatchDate: TODAY }), item({ id: 'b', dispatchState: 'scheduled', tentativeDispatchDate: '2026-11-05' })],
  partial: [item({ id: 'a', dispatchState: 'scheduled', tentativeDispatchDate: TODAY }), item({ id: 'b', delayReason: 'vendor delayed the steel' })],
  scheduledWithoutDate: [item({ id: 'a', dispatchState: 'scheduled', tentativeDispatchDate: null })],
  allDispatched: [item({ id: 'a', dispatchState: 'dispatched', tentativeDispatchDate: TODAY, dispatchedQty: 10 }), item({ id: 'b', dispatchState: 'dispatched', tentativeDispatchDate: '2026-11-01', dispatchedQty: 5 })],
  halfDispatched: [item({ id: 'a', dispatchState: 'dispatched', tentativeDispatchDate: TODAY, dispatchedQty: 10 }), item({ id: 'b', dispatchState: 'scheduled', tentativeDispatchDate: '2026-11-01' })],
  overdue: [item({ id: 'a', dispatchState: 'scheduled', tentativeDispatchDate: '2026-10-30' })],
  overdueAndToday: [item({ id: 'a', dispatchState: 'scheduled', tentativeDispatchDate: '2026-10-30' }), item({ id: 'b', dispatchState: 'scheduled', tentativeDispatchDate: TODAY })],
  cancelled: [item({ id: 'a', dispatchState: 'scheduled', tentativeDispatchDate: TODAY })],
};

const ORDERS = [
  null,
  {},
  { status: 'open' },
  { status: 'cancelled' },
  { status: 'void' },
  { status: 'OPEN' },
  { status: 'open', orderStatus: 'closed' },
];

const VIEWS = ['dispatch-floor', 'unscheduled', 'scheduled', 'dispatched', 'source-deleted', 'all', 'incomplete', 'completed'];
const SOURCES = ['active', 'deleted_source'];

const parse = (fn) => {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
};

const lifecycleFixtures = () => {
  const out = [];
  for (const [name, items] of Object.entries(ITEM_SETS)) {
    for (const order of ORDERS) out.push({ name, items, order });
  }
  return out;
};

describe('crm lifecycle mirror', () => {
  it('deriveLifecycle agrees on every fixture', () => {
    for (const f of lifecycleFixtures()) {
      const a = be.deriveLifecycle(f.items, f.order);
      const b = fe.deriveLifecycle(f.items, f.order);
      assert.equal(b, a, `deriveLifecycle diverged for ${f.name} / ${JSON.stringify(f.order)}: ${a} vs ${b}`);
    }
  });

  it('isCancelledOrder agrees', () => {
    for (const order of ORDERS) {
      assert.equal(fe.isCancelledOrder(order), be.isCancelledOrder(order), `isCancelledOrder ${JSON.stringify(order)}`);
    }
  });

  it('overdue / due-today helpers agree', () => {
    for (const [name, items] of Object.entries(ITEM_SETS)) {
      assert.equal(fe.isOrderOverdue(items, TODAY), be.isOrderOverdue(items, TODAY), `isOrderOverdue ${name}`);
      assert.equal(fe.countDueToday(items, TODAY), be.countDueToday(items, TODAY), `countDueToday ${name}`);
      for (const it of items) {
        assert.equal(fe.isOverdueItem(it, TODAY), be.isOverdueItem(it, TODAY), `isOverdueItem ${name}`);
        assert.equal(fe.isDueTodayItem(it, TODAY), be.isDueTodayItem(it, TODAY), `isDueTodayItem ${name}`);
      }
    }
  });

  it('tab membership agrees for every view × source state', () => {
    for (const [name, items] of Object.entries(ITEM_SETS)) {
      for (const order of ORDERS) {
        const lifecycle = be.deriveLifecycle(items, order);
        for (const sourceState of SOURCES) {
          const shape = { lifecycle, sourceState, items };
          for (const view of VIEWS) {
            assert.equal(
              feQ.orderMatchesView(shape, view, TODAY),
              beQ.orderMatchesView(shape, view, TODAY),
              `orderMatchesView ${name}/${sourceState}/${view}`,
            );
          }
          const a = beQ.orderFlags(shape, TODAY);
          const b = feQ.orderFlags(shape, TODAY);
          assert.deepEqual(b, a, `orderFlags ${name}/${sourceState}`);
        }
        assert.equal(
          feQ.earliestCommittedDate(items),
          beQ.earliestCommittedDate(items),
          `earliestCommittedDate ${name}`,
        );
      }
    }
  });

  it('tabs are per ITEM, not per lifecycle bucket', () => {
    // One dispatched, one dated, one undated → open in all three tabs. This is
    // the case that used to hide work: the order's lifecycle reads
    // "partially_dispatched" while an undated item was still waiting.
    const mixed = {
      lifecycle: 'partially_dispatched',
      sourceState: 'active',
      items: [
        { id: 'a', dispatchState: 'dispatched', tentativeDispatchDate: '2026-11-01', dispatchedQty: 5, qty: 5, delayReason: null },
        { id: 'b', dispatchState: 'scheduled', tentativeDispatchDate: '2026-11-06', dispatchedQty: 0, qty: 5, delayReason: null },
        { id: 'c', dispatchState: 'unscheduled', tentativeDispatchDate: null, dispatchedQty: 0, qty: 5, delayReason: null },
      ],
    };
    for (const q of [beQ, feQ]) {
      assert.equal(q.orderMatchesView(mixed, 'unscheduled', TODAY), true, 'unscheduled');
      assert.equal(q.orderMatchesView(mixed, 'scheduled', TODAY), true, 'scheduled');
      assert.equal(q.orderMatchesView(mixed, 'dispatched', TODAY), true, 'dispatched');
    }
    // No items captured yet ⇒ unscheduled (nothing ships undated), and nothing
    // pretends to be scheduled or dispatched.
    const bare = { lifecycle: 'unscheduled', sourceState: 'active', items: [] };
    for (const q of [beQ, feQ]) {
      assert.equal(q.orderMatchesView(bare, 'unscheduled', TODAY), true, 'bare unscheduled');
      assert.equal(q.orderMatchesView(bare, 'scheduled', TODAY), false, 'bare scheduled');
      assert.equal(q.orderMatchesView(bare, 'dispatched', TODAY), false, 'bare dispatched');
    }
    // Cancelled is out of every working tab.
    const cancelled = { lifecycle: 'cancelled', sourceState: 'active', items: [item({ id: 'a' })] };
    for (const q of [beQ, feQ]) {
      for (const v of ['unscheduled', 'scheduled', 'dispatched', 'dispatch-floor']) {
        assert.equal(q.orderMatchesView(cancelled, v, TODAY), false, `cancelled/${v}`);
      }
    }
  });

  it('validateSchedule agrees (including the mandatory-reason branches)', () => {
    const cases = [
      { items: ITEM_SETS.allUnscheduled, entries: [] },
      { items: ITEM_SETS.allUnscheduled, entries: [{ itemId: 'a', date: TODAY }, { itemId: 'b', date: TODAY }] },
      { items: ITEM_SETS.allUnscheduled, entries: [{ itemId: 'a', date: TODAY }] },
      { items: ITEM_SETS.allUnscheduled, entries: [{ itemId: 'a', date: TODAY }], soReason: 'vendor delayed the material' },
      { items: ITEM_SETS.allUnscheduled, entries: [{ itemId: 'a', date: '2026-10-01' }], soReason: 'vendor delayed the material' },
      { items: ITEM_SETS.allUnscheduled, entries: [{ itemId: 'a', date: 'nope' }] },
      { items: ITEM_SETS.allUnscheduled, entries: [{ itemId: 'zzz', date: TODAY }] },
      { items: ITEM_SETS.allUnscheduled, entries: [{ itemId: 'a' }], soReason: 'short' },
      { items: ITEM_SETS.allUnscheduled, entries: [{ itemId: 'a' }], soReason: 'waiting on the vendor delivery' },
      { items: ITEM_SETS.allUnscheduled, entries: [{ itemId: 'a', date: TODAY }, { itemId: 'b', reason: 'not enough stock' }] },
      { items: ITEM_SETS.allDispatched, entries: [{ itemId: 'a', date: TODAY }] },
      { items: ITEM_SETS.partial, entries: [{ itemId: 'b', date: TODAY }] },
    ];
    for (const c of cases) {
      const a = be.validateSchedule({ today: TODAY, ...c });
      const b = fe.validateSchedule({ today: TODAY, ...c });
      assert.deepEqual(b, a, `validateSchedule ${JSON.stringify(c)}`);
    }
  });

  it('validateReschedule agrees', () => {
    const cases = [
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a', date: '2026-11-06' }], reason: '' },
      { items: ITEM_SETS.allScheduled, entries: [], reason: 'vendor delayed the material' },
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a', date: '2026-10-01' }], reason: 'vendor delayed the material' },
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a', date: '2026-11-06' }], reason: 'vendor delayed the material' },
      { items: ITEM_SETS.allUnscheduled, entries: [{ itemId: 'a', date: '2026-11-06' }], reason: 'vendor delayed the material' },
      { items: ITEM_SETS.allDispatched, entries: [{ itemId: 'a', date: '2026-11-06' }], reason: 'vendor delayed the material' },
    ];
    for (const c of cases) {
      const a = be.validateReschedule({ today: TODAY, ...c });
      const b = fe.validateReschedule({ today: TODAY, ...c });
      assert.deepEqual(b, a, `validateReschedule ${JSON.stringify(c)}`);
    }
  });

  it('validateDispatch agrees', () => {
    const proof = {
      invoiceId: 'att-inv', beforeId: 'att-before', afterId: 'att-after',
      transportId: 'att-transport', courierId: 'att-courier', packingListId: 'att-list',
    };
    const cases = [
      { items: ITEM_SETS.allScheduled, entries: [] },
      { items: ITEM_SETS.allScheduled, entries: [], proof },
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }] },
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }], proof },
      // Packing photos are optional — invoice alone dispatches.
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }], proof: { invoiceId: 'att-inv' } },
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }], proof: { invoiceId: 'att-inv', beforeId: '', afterId: null } },
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }], proof: { invoiceId: '  ', beforeId: 'att-before', afterId: 'att-after' } },
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }], proof: null },
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a', qty: 3 }], proof },
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a', qty: 0 }], proof },
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a', qty: 99 }], proof },
      { items: ITEM_SETS.halfDispatched, entries: [{ itemId: 'a' }], proof },
      { items: ITEM_SETS.allUnscheduled, entries: [{ itemId: 'a' }], proof },
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'nope' }], proof },
    ];
    for (const c of cases) {
      const a = be.validateDispatch(c);
      const b = fe.validateDispatch(c);
      assert.deepEqual(b, a, `validateDispatch ${JSON.stringify(c)}`);
    }
    // The gate itself: invoice alone dispatches, anything without one is proof_required.
    assert.equal(be.validateDispatch({ items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }], proof: { invoiceId: 'att-inv' } }).ok, true);
    assert.equal(fe.validateDispatch({ items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }], proof: { invoiceId: 'att-inv' } }).ok, true);
    // The five extra documents are optional on both sides — invoice-only is fine
    // whether none, some or all of them are attached.
    for (const extra of [
      {},
      { transportId: 'att-transport' },
      { courierId: 'att-courier' },
      { packingListId: 'att-list' },
      { transportId: 'att-transport', courierId: 'att-courier', packingListId: 'att-list' },
    ]) {
      const a = be.validateDispatch({ items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }], proof: { invoiceId: 'att-inv', ...extra } });
      const b = fe.validateDispatch({ items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }], proof: { invoiceId: 'att-inv', ...extra } });
      assert.deepEqual(b, a, `optional proof ${JSON.stringify(extra)}`);
      assert.equal(a.ok, true);
    }
    for (const bad of [undefined, null, {}, { beforeId: 'x', afterId: 'y' }, { transportId: 'x', courierId: 'y', packingListId: 'z' }]) {
      const a = be.validateDispatch({ items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }], proof: bad });
      const b = fe.validateDispatch({ items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }], proof: bad });
      assert.deepEqual(b, a);
      assert.equal(a.ok, false);
      assert.equal(a.code, 'proof_required');
    }
  });

  it('resolveDispatchQty agrees', () => {
    for (const [name, items] of Object.entries(ITEM_SETS)) {
      for (const entry of [undefined, { itemId: 'a' }, { itemId: 'a', qty: 0 }, { itemId: 'a', qty: 4 }, { itemId: 'a', qty: 500 }, { itemId: 'a', qty: -2 }]) {
        const it = items[0];
        assert.equal(
          fe.resolveDispatchQty(it, entry),
          be.resolveDispatchQty(it, entry),
          `resolveDispatchQty ${name} ${JSON.stringify(entry)}`,
        );
      }
    }
  });

  it('REASON_MIN matches on both sides', () => {
    assert.equal(fe.REASON_MIN, beTypes.REASON_MIN);
  });

  it('view contract matches (unified Sales buckets included)', () => {
    assert.deepEqual([...feTypes.VIEWS], [...beTypes.VIEWS]);
    assert.deepEqual([...feTypes.SALES_BUCKETS], [...beTypes.SALES_BUCKETS]);
  });

  it('sales buckets split on the payment boundary, identically', () => {
    // Zoho status combinations the floor actually receives. The split must be
    // "still owed" vs "paid in full": closed-with-nothing-outstanding counts
    // as completed, a partially-paid closed order does NOT.
    const payments = [
      { status: 'open', orderStatus: 'draft', paidStatus: '' },
      { status: 'open', orderStatus: 'open', paidStatus: '' },
      { status: 'open', orderStatus: 'invoiced', paidStatus: '' },
      { status: 'open', orderStatus: 'invoiced', paidStatus: 'partially_paid' },
      { status: 'open', orderStatus: 'closed', paidStatus: 'partially_paid' },
      { status: 'open', orderStatus: 'closed', paidStatus: '' },
      { status: 'open', orderStatus: 'closed', paidStatus: 'paid' },
      { status: 'open', orderStatus: 'draft', paidStatus: 'paid' },
      { status: 'cancelled', orderStatus: 'closed', paidStatus: 'paid' },
      { status: 'void', orderStatus: 'closed', paidStatus: 'paid' },
    ];
    for (const payment of payments) {
      for (const sourceState of SOURCES) {
        const shape = {
          lifecycle: payment.status === 'cancelled' ? 'cancelled' : 'dispatched',
          sourceState,
          items: ITEM_SETS.allDispatched,
          ...payment,
        };
        const label = `${JSON.stringify(payment)}/${sourceState}`;
        assert.equal(feQ.isPaymentComplete(shape), beQ.isPaymentComplete(shape), `isPaymentComplete ${label}`);
        assert.equal(feQ.salesBucket(shape), beQ.salesBucket(shape), `salesBucket ${label}`);
        for (const view of ['incomplete', 'completed']) {
          assert.equal(
            feQ.orderMatchesView(shape, view, TODAY),
            beQ.orderMatchesView(shape, view, TODAY),
            `orderMatchesView ${view} ${label}`,
          );
        }
      }
    }
    // Cancelled/void/source-deleted belong to NEITHER bucket.
    const gone = { lifecycle: 'cancelled', sourceState: 'active', items: ITEM_SETS.allUnscheduled, status: 'cancelled', orderStatus: '', paidStatus: '' };
    const deleted = { lifecycle: 'dispatched', sourceState: 'deleted_source', items: ITEM_SETS.allDispatched, status: 'open', orderStatus: '', paidStatus: '' };
    for (const shape of [gone, deleted]) {
      for (const q of [beQ, feQ]) {
        assert.equal(q.salesBucket(shape), null);
        assert.equal(q.orderMatchesView(shape, 'incomplete', TODAY), false);
        assert.equal(q.orderMatchesView(shape, 'completed', TODAY), false);
      }
    }
  });

  it('empty input is rejected identically, never thrown', () => {
    const cases = [
      ['validateSchedule', { today: TODAY, items: [], entries: [], soReason: null }],
      ['validateDispatch', { items: [], entries: [] }],
      ['validateReschedule', { today: TODAY, items: [], entries: [], reason: 'vendor delayed the material' }],
    ];
    for (const [fn, args] of cases) {
      const a = parse(() => be[fn](args));
      const b = parse(() => fe[fn](args));
      assert.deepEqual(b, a, `${fn} empty-input behaviour diverged`);
      assert.ok(!a.ok || a.value.ok === false, `${fn} should reject empty input`);
    }
    // deriveLifecycle must survive an empty/garbage item list on both sides.
    for (const input of [[], null, undefined]) {
      assert.equal(fe.deriveLifecycle(input), be.deriveLifecycle(input), `deriveLifecycle(${String(input)})`);
    }
  });

  it('removed lines leave every queue and lifecycle on both sides', () => {
    const gone = { id: 'x', dispatchState: 'scheduled', tentativeDispatchDate: TODAY, qty: 10, dispatchedQty: 0, removedAt: '2026-11-06T00:00:00.000Z' };
    const live = { id: 'y', dispatchState: 'unscheduled', tentativeDispatchDate: null, qty: 5, dispatchedQty: 0 };
    for (const q of [be, fe]) {
      assert.equal(q.isRemovedItem(gone), true);
      assert.equal(q.isRemovedItem(live), false);
      assert.equal(q.isOrderOverdue([gone], TODAY), false, 'removed overdue must not flag');
      assert.equal(q.countDueToday([gone], TODAY), 0, 'removed due-today must not count');
      assert.equal(q.deriveLifecycle([gone], null), 'unscheduled', 'only-removed reads empty');
    }
    assert.equal(fe.deriveLifecycle([gone, live], null), be.deriveLifecycle([gone, live], null));
    for (const qq of [beQ, feQ]) {
      // Only removed lines ⇒ reads like a bare order: unscheduled, but with
      // nothing left to schedule or dispatch.
      const shape = { lifecycle: 'unscheduled', sourceState: 'active', items: [gone] };
      assert.equal(qq.orderMatchesView(shape, 'unscheduled', TODAY), true, 'removed/unscheduled');
      assert.equal(qq.orderMatchesView(shape, 'scheduled', TODAY), false, 'removed/scheduled');
      assert.equal(qq.orderFlags(shape, TODAY).canSchedule, false, 'removed/canSchedule');
    }
  });

  it('effectiveQty prefers the amended override on both sides', () => {
    const amended = { id: 'a', dispatchState: 'scheduled', tentativeDispatchDate: TODAY, qty: 10, dispatchedQty: 2, amendedQty: 7 };
    for (const q of [be, fe]) {
      assert.equal(q.effectiveQty(amended), 7);
      assert.equal(q.effectiveQty({ qty: 10 }), 10);
      assert.equal(q.resolveDispatchQty(amended, { itemId: 'a' }), 5);
    }
    // Dispatch beyond the amended remainder fails identically.
    for (const q of [be, fe]) {
      const r = q.validateDispatch({ items: [amended], entries: [{ itemId: 'a', qty: 6 }], proof: { invoiceId: 'att-inv' } });
      assert.equal(r.ok, false);
      assert.equal(r.code, 'bad_qty');
    }
    // Removed lines cannot schedule/reschedule/dispatch on either side.
    const removed = { id: 'r', dispatchState: 'scheduled', tentativeDispatchDate: TODAY, qty: 5, dispatchedQty: 0, removedAt: '2026-11-06T00:00:00.000Z' };
    const gate = { invoiceId: 'att-inv' };
    assert.deepEqual(
      fe.validateSchedule({ today: TODAY, items: [removed], entries: [{ itemId: 'r', date: TODAY }] }),
      be.validateSchedule({ today: TODAY, items: [removed], entries: [{ itemId: 'r', date: TODAY }] }),
    );
    assert.deepEqual(
      fe.validateReschedule({ today: TODAY, items: [removed], entries: [{ itemId: 'r', date: '2026-11-08' }], reason: 'vendor delayed the material' }),
      be.validateReschedule({ today: TODAY, items: [removed], entries: [{ itemId: 'r', date: '2026-11-08' }], reason: 'vendor delayed the material' }),
    );
    assert.deepEqual(
      fe.validateDispatch({ items: [removed], entries: [{ itemId: 'r' }], proof: gate }),
      be.validateDispatch({ items: [removed], entries: [{ itemId: 'r' }], proof: gate }),
    );
    assert.equal(be.validateDispatch({ items: [removed], entries: [{ itemId: 'r' }], proof: gate }).code, 'removed_item');
  });

  it('validateAmend + validateLocalCancel agree on every branch', () => {
    const open = [
      { id: 'a', dispatchState: 'unscheduled', tentativeDispatchDate: null, qty: 10, dispatchedQty: 0 },
      { id: 'b', dispatchState: 'scheduled', tentativeDispatchDate: TODAY, qty: 5, dispatchedQty: 2 },
      { id: 'c', dispatchState: 'dispatched', tentativeDispatchDate: TODAY, qty: 5, dispatchedQty: 5 },
    ];
    const amendCases = [
      {},
      { items: open, reason: 'short' },
      { items: open, reason: 'client confirmed fewer pieces' },
      { items: open, qtyChanges: [{ itemId: 'a', qty: 8 }], reason: 'client confirmed fewer pieces' },
      { items: open, qtyChanges: [{ itemId: 'b', qty: 1 }], reason: 'client confirmed fewer pieces' },
      { items: open, qtyChanges: [{ itemId: 'zzz', qty: 8 }], reason: 'client confirmed fewer pieces' },
      { items: open, qtyChanges: [{ itemId: 'a', qty: 0 }], reason: 'client confirmed fewer pieces' },
      { items: open, qtyChanges: [{ itemId: 'a', qty: 8 }, { itemId: 'a', qty: 9 }], reason: 'client confirmed fewer pieces' },
      { items: open, removals: [{ itemId: 'a' }], reason: 'client dropped this line item' },
      { items: open, removals: [{ itemId: 'c' }], reason: 'client dropped this line item' },
      { items: open, additions: [{ name: 'Extra belt', qty: 2 }], reason: 'client added an extra line' },
      { items: open, additions: [{ name: '', qty: 2 }], reason: 'client added an extra line' },
      { items: open, additions: [{ name: 'Extra belt', qty: 0 }], reason: 'client added an extra line' },
    ];
    for (const c of amendCases) {
      assert.deepEqual(fe.validateAmend(c), be.validateAmend(c), `validateAmend ${JSON.stringify(c)}`);
    }
    const cancelCases = [
      {},
      { reason: 'short' },
      { reason: 'client cancelled the full order', order: { status: 'open' } },
      { reason: 'client cancelled the full order', order: { status: 'cancelled' } },
      { reason: 'client cancelled the full order', localCancelledAt: '2026-11-06T00:00:00.000Z' },
    ];
    for (const c of cancelCases) {
      assert.deepEqual(fe.validateLocalCancel(c), be.validateLocalCancel(c), `validateLocalCancel ${JSON.stringify(c)}`);
    }
  });
});
