// check-queue-mirror.mjs — Guard 2: backend↔frontend queue-predicate contract.
//
// backend/src/modules/enquiries/queues.ts and frontend/src/enquiry/queue.ts
// must export the same names with the same semantics ("change both together").
// This guard runs every function present on BOTH sides over a shared fixture
// corpus and fails on any disagreement (return-value or throw/no-throw).
// Functions present on only one side are reported, not failed — each side may
// legitimately own consumer-specific helpers.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/queue-mirror.test.mjs`
// Exit: 0 = mirrors agree, 1 = drift.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BACKEND_DIR, FRONTEND_SRC, bundleToFile } from './_bundle.mjs';

const be = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'queues.ts')));
const fe = await import(bundleToFile(join(FRONTEND_SRC, 'enquiry', 'queue.ts'), { alias: { '@': FRONTEND_SRC } }));

const isFn = (m, k) => typeof m[k] === 'function';
const common = Object.keys(be).filter((k) => isFn(be, k) && isFn(fe, k));
const onlyBe = Object.keys(be).filter((k) => isFn(be, k) && !isFn(fe, k));
const onlyFe = Object.keys(fe).filter((k) => isFn(fe, k) && !isFn(be, k));

// ── Shared fixture corpus: plain data exercising every predicate branch ──
// Loop records are the ONLY loop mechanism — fixtures carry explicit records
// (legacy text/thread fields no longer exist; migration is covered by the
// backend lifecycle check, not the mirror).
const rate = (over = {}) => ({ quotedAt: '2026-09-01T10:00:00+05:30', sharedWithSales: false, ...over });
const NOW_ISO = new Date().toISOString();
let lpN = 0;
const loop = (over = {}) => ({
  id: `lp_fixture_${++lpN}`,
  kind: 'query',
  text: 'ask',
  openedBy: 'sales',
  openedAt: '2026-09-01T10:00:00+05:30',
  holder: 'management',
  status: 'open',
  ...over,
});
const answeredLoop = (over = {}) => ({
  ...loop({ status: 'answered', closedAt: NOW_ISO }),
  answer: { text: 'done', by: 'management', at: NOW_ISO },
  ...over,
});
const ITEMS = [
  { name: 'bare item' },                                                              // all-absent
  { rateAvailable: true, rates: [rate()], finalRate: 100 },                            // decided+available
  { rates: [], finalRate: null },                                                      // fresh unquoted
  { rates: [rate()], finalRate: null },                                                // quoted, undecided
  { rates: [rate()], finalRate: 120, finalizedAt: '2026-09-02T10:00:00+05:30' },        // decided, reviewed
  { rates: [rate({ quotedAt: '2026-09-05T10:00:00+05:30' })], finalRate: 120, finalizedAt: '2026-09-02T10:00:00+05:30' }, // unreviewed quotes
  { rates: [rate({ quotedAt: '2026-09-05T10:00:00+05:30', sharedWithSales: true })], finalRate: 120, finalizedAt: '2026-09-02T10:00:00+05:30' }, // shared → reviewed
  { rates: [rate({ quotedAt: 'not-a-date' })], finalRate: 120, finalizedAt: '2026-09-02T10:00:00+05:30' }, // bad date → not pending
  { notAvailable: true },                                                              // unavailable
  { loops: [loop({ kind: 'not_available', openedBy: 'procurement', holder: 'management', text: 'No stock' })] }, // awaiting approval
  { internalRates: true, rates: [rate()], finalRate: null },                           // internal, undecided
  { loops: [loop({ kind: 'spec', openedBy: 'procurement', holder: 'sales', text: 'missing size' })] }, // spec hold
  { rates: [rate()], finalRate: null, loops: [loop({ kind: 'rates', openedBy: 'management', holder: 'procurement', text: 'need vendor' })] }, // re-requested
  { loops: [loop({ kind: 'query', openedBy: 'sales', holder: 'management', text: 'other make please' })] }, // sales ask with management
  { loops: [loop({ kind: 'query', openedBy: 'sales', holder: 'procurement', text: 'other make please', forwarded: { by: 'management', at: '2026-09-02T10:00:00+05:30', from: 'management', to: 'procurement' } })] }, // forwarded → procurement
  { loops: [answeredLoop({ kind: 'query', openedBy: 'sales', holder: 'management' })] }, // answered query (resolved window)
  { loops: [answeredLoop({ kind: 'note', openedBy: 'sales', holder: 'sales', text: 'called' })] }, // audit note, no queue effect
  { rates: [], finalRate: undefined, internalRates: false },                            // explicit undefineds
];
const ENQUIRIES = [
  {},
  { items: [] },
  { items: ITEMS.slice(0, 4) },
  { procurementSubmittedAt: '2026-09-03T10:00:00+05:30', items: [{ rates: [], finalRate: null }] },
  { procurementSubmittedAt: '  ', items: [] },                                         // blank handoff
  { sentRevisionAt: '2026-09-04T10:00:00+05:30', items: [] },
  { rateStatus: 'finalized', items: [{ rates: [rate()], finalRate: 100 }] },
  {
    items: [{ loops: [answeredLoop({ kind: 'note', openedBy: 'sales', holder: 'sales', text: 'called' })], rates: [], comments: [{ content: 'x', visibility: 'sales' }] }],
  },
];
const STATUSES = ['draft', 'sent', 'cancelled', 'closed', 'CANCELLED', 'Sent', '', '  ', 'won', null];
const EDGES = [null, undefined, {}, [], 0, '', 'x'];

const CORPUS = [...ITEMS, ...ENQUIRIES, ...STATUSES, ...EDGES];

function outcome(fn, arg) {
  try {
    return { ok: true, value: fn(arg) };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 120) };
  }
}

describe('queue-mirror', () => {
  it(`has a non-empty intersection (backend ∩ frontend = ${common.length} fns)`, () => {
    assert.ok(common.length >= 15, `intersection suspiciously small (${common.length}) — mirror files renamed?`);
  });

  for (const name of common) {
    it(`${name} agrees on ${CORPUS.length} shared fixtures`, () => {
      for (const fix of CORPUS) {
        const a = outcome(be[name], fix);
        const b = outcome(fe[name], fix);
        assert.deepEqual(b, a, `${name} drift on ${JSON.stringify(fix)?.slice(0, 160)}: backend=${JSON.stringify(a)?.slice(0, 160)} frontend=${JSON.stringify(b)?.slice(0, 160)}`);
      }
    });
  }

  it('reports single-sided helpers (info only)', () => {
    console.log(`   mirror: ${common.length} shared fns agree`);
    if (onlyBe.length) console.log(`     backend-only: ${onlyBe.join(', ')}`);
    if (onlyFe.length) console.log(`     frontend-only: ${onlyFe.join(', ')}`);
  });
});
