// check-enquiry-procurement-ownership — founder decision 2026-11-21.
//
// Procurement owns an enquiry until THEY conclude it
// (`procurementSubmittedAt`, the "Enquiry Concluded" button). Estimate status
// and Zoho's draft/sent state are not locks: they may keep adding vendor
// quotes (several per vendor, and late quotes after management finalized)
// right up to that click.
//
// This guard pins all four halves of that rule so a future "auto-conclude"
// convenience cannot silently take the queue away from them:
//   1. queue predicates (BE + FE): sent-but-unconcluded rows stay in Active;
//   2. no auto-conclude on send in either write path;
//   3. the procurement card has no estimate-status / final-rate lock;
//   4. the thread composer sends on plain Enter (shift = newline).
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/enquiry-procurement-ownership.test.mjs`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR, FRONTEND_SRC, bundleToFile } from './_bundle.mjs';

const be = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'queues.ts')));
const fe = await import(bundleToFile(join(FRONTEND_SRC, 'enquiry', 'queue.ts'), { alias: { '@': FRONTEND_SRC } }));

const read = (...p) => readFileSync(join(BACKEND_DIR, ...p), 'utf8');
const readFe = (...p) => readFileSync(join(FRONTEND_SRC, ...p), 'utf8');

const item = (over = {}) => ({ name: 'Bearing', qty: '2', ...over });
const endedRow = (over = {}) => ({
  id: 'e1',
  items: [item()],
  rateStatus: '',
  zohoStatus: 'draft',
  ...over,
});

// ── 1. Queue predicates ────────────────────────────────────────────────────
describe('procurement queue ownership', () => {
  const pending = (row) => [be.isProcurementPendingEnquiry(row), fe.isProcurementPendingEnquiry(row)];
  const history = (row) => [be.isProcurementHistoryEnquiry(row), fe.isProcurementHistoryEnquiry(row)];

  it('keeps a SENT estimate in the Active queue until procurement concludes it', () => {
    const row = endedRow({ rateStatus: 'sent', zohoStatus: 'sent' });
    assert.deepEqual(pending(row), [true, true]);
    assert.deepEqual(history(row), [false, false]);
  });

  it('keeps a FINALIZED estimate (all rates in) in Active — nothing is locked', () => {
    const row = endedRow({ rateStatus: 'finalized', items: [item({ finalRate: 1200 })] });
    assert.deepEqual(pending(row), [true, true]);
  });

  it('keeps a fully quoted row in Active so late quotes can still be added', () => {
    const row = endedRow({ rateStatus: 'sent', zohoStatus: 'sent', items: [item({ finalRate: 900, rates: [{ vendor: 'A', rate: 900 }] })] });
    assert.deepEqual(pending(row), [true, true]);
  });

  it('moves to History only on the manual conclude stamp', () => {
    const row = endedRow({
      rateStatus: 'sent',
      zohoStatus: 'sent',
      procurementSubmittedAt: '2026-11-21T10:00:00.000Z',
      items: [item({ finalRate: 900, rates: [{ vendor: 'A', rate: 900 }] })],
    });
    assert.deepEqual(pending(row), [false, false]);
    assert.deepEqual(history(row), [true, true]);
  });

  it('returns a concluded row to Active when a line was added after the stamp', () => {
    // Sales added an item to a sent + concluded enquiry: the stamp only covered
    // the old item set, so the fresh line must re-enter procurement instead of
    // sitting invisible in History (no rate, no owner).
    const row = endedRow({
      rateStatus: 'sent',
      zohoStatus: 'sent',
      procurementSubmittedAt: '2026-11-21T10:00:00.000Z',
      items: [
        item({ finalRate: 900, rates: [{ vendor: 'A', rate: 900 }] }),
        item({ name: 'Seal', rates: [], finalRate: null }),
      ],
    });
    assert.deepEqual(pending(row), [true, true]);
    assert.deepEqual(history(row), [false, false]);
  });

  it('refuses to conclude while a procurement-held ask is open', () => {
    const row = endedRow({
      items: [item({
        rates: [{ vendor: 'A', rate: 900 }],
        loops: [{ id: 'lp9', kind: 'rates', text: 'need another vendor', openedBy: 'management', openedAt: '2026-11-21T10:00:00.000Z', holder: 'procurement', status: 'open' }],
      })],
    });
    assert.equal(be.procurementSubmittable(row).ok, false);
    assert.equal(fe.procurementSubmittable(row).ok, false);
  });

  it('treats a dead requirement (cancelled / client-accepted) as History without a stamp', () => {
    for (const zohoStatus of ['cancelled', 'declined', 'void', 'rejected', 'accepted']) {
      const row = endedRow({ zohoStatus });
      assert.deepEqual(pending(row), [false, false], `${zohoStatus} must not be Active`);
      assert.deepEqual(history(row), [true, true], `${zohoStatus} must be History`);
    }
  });

  it('lets an open procurement loop keep a concluded row out of History', () => {
    // History is read-only; a live ask must stay actionable in Active.
    const row = endedRow({
      procurementSubmittedAt: '2026-11-21T10:00:00.000Z',
      items: [item({ loops: [{ id: 'lp1', kind: 'not_available', text: 'ask', openedBy: 'procurement', openedAt: '2026-11-21T10:00:00.000Z', holder: 'procurement', status: 'open' }] })],
    });
    assert.deepEqual(pending(row), [true, true]);
  });

  it('never lists an item-less enquiry in either tab', () => {
    const row = endedRow({ items: [] });
    assert.deepEqual(pending(row), [false, false]);
    assert.deepEqual(history(row), [false, false]);
  });

  it('never lists a row in both tabs', () => {
    const rows = [
      endedRow(),
      endedRow({ rateStatus: 'sent', zohoStatus: 'sent' }),
      endedRow({ rateStatus: 'finalized', items: [item({ finalRate: 100 })] }),
      endedRow({ zohoStatus: 'accepted' }),
      endedRow({ procurementSubmittedAt: '2026-11-21T10:00:00.000Z' }),
    ];
    for (const row of rows) {
      for (const isPending of [be.isProcurementPendingEnquiry, fe.isProcurementPendingEnquiry]) {
        const isHistory = isPending === be.isProcurementPendingEnquiry
          ? be.isProcurementHistoryEnquiry : fe.isProcurementHistoryEnquiry;
        assert.ok(!(isPending(row) && isHistory(row)), `row listed twice: ${JSON.stringify(row)}`);
      }
    }
  });
});

// ── 2. No auto-conclude on send ────────────────────────────────────────────
describe('no automatic procurement conclusion', () => {
  const routes = read('src', 'worker', 'routes', 'enquiries.ts');
  const pure = read('src', 'modules', 'enquiries', 'update-parts', 'pure.ts');

  it('maybePromoteEnquiriesSent stamps only dead rows', () => {
    assert.match(routes, /if \(e\?\.id && isZohoClosedStatus\(s\)/,
      'auto-conclude must be gated on a closed Zoho status');
    assert.doesNotMatch(routes, /isZohoClosedStatus\(s\) \? 'terminal' : 'sent'/,
      'a live sent estimate must not auto-conclude procurement');
  });

  it('applyRateLifecycles never stamps procurementSubmittedAt on `sent`', () => {
    const fn = pure.slice(pure.indexOf('export function applyRateLifecycles'));
    const body = fn.slice(0, fn.indexOf('\nexport function', 1));
    const sentBlock = body.slice(body.indexOf("rateStatus === 'sent'"), body.indexOf("if ((updates as any).procurementSubmittedAt !== undefined)"));
    assert.ok(sentBlock.length > 0, 'sent block must still exist (spec asks still auto-answer)');
    assert.doesNotMatch(sentBlock, /procurementSubmittedAt\s*=/,
      'marking the estimate sent must not conclude procurement');
  });
});

// ── 3. No estimate-status lock on the procurement card ─────────────────────
describe('procurement rate entry is unlocked', () => {
  const queue = readFe('components', 'ProcurementQueue.tsx');

  it('does not switch the item card read-only on finalRate / submitted status', () => {
    assert.doesNotMatch(queue, /item\.finalRate !== undefined && item\.finalRate !== null && openLoops/,
      'a management final must not lock the card');
    assert.doesNotMatch(queue, /readOnly=\{submitted &&/,
      'the conclude stamp must not lock the card — History already renders read-only');
  });

  it('the sourcing card offers another quote from an existing vendor', () => {
    const card = readFe('components', 'ProcurementItemCard.tsx');
    assert.match(card, /seedVendor/, 'ItemRateForm must accept a seeded vendor');
    assert.match(card, /Add another quote from this vendor/, 'repeats need an affordance');
  });
});

// ── 4. Plain Enter sends in the chat composer ──────────────────────────────
describe('thread composer keyboard', () => {
  it('sends on plain Enter and keeps Shift+Enter for a new line', () => {
    for (const file of ['ThreadCard.tsx', 'NewThreadForm.tsx']) {
      const src = readFe('components', 'enquiry-threads', file);
      assert.match(src, /e\.key !== "Enter"/, `${file} must gate on the Enter key`);
      assert.match(src, /e\.shiftKey/, `${file} must keep Shift+Enter as the newline escape`);
      assert.match(src, /e\.preventDefault\(\)/, `${file} must prevent the newline`);
      assert.match(src, /\bsend\(\)|\bsubmit\(\)/, `${file} must actually submit on Enter`);
    }
  });
});
