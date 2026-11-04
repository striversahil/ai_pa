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
    const proof = { invoiceId: 'att-inv', beforeId: 'att-before', afterId: 'att-after' };
    const cases = [
      { items: ITEM_SETS.allScheduled, entries: [] },
      { items: ITEM_SETS.allScheduled, entries: [], proof },
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }] },
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }], proof },
      { items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }], proof: { invoiceId: 'att-inv', beforeId: '', afterId: 'att-after' } },
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
    // The gate itself: proof present dispatches, anything else is proof_required.
    assert.equal(be.validateDispatch({ items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }], proof }).ok, true);
    assert.equal(fe.validateDispatch({ items: ITEM_SETS.allScheduled, entries: [{ itemId: 'a' }], proof }).ok, true);
    for (const bad of [undefined, null, {}, { invoiceId: 'x' }]) {
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
});
