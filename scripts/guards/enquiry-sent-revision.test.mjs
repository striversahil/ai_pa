// check-enquiry-sent-revision — the "added an item but no rate ever appears"
// and "Reopen says only sent enquiries" dead ends (2026-11-28).
//
// Two ways a SENT enquiry must reopen, and one reject that must stop rejecting:
//   1. appending a line (sales tracker / AI add) is an implicit revision;
//   2. the first vendor quote on a line that had none reopens a concluded row;
//   3. the revise verb accepts a row the UI shows as sent even when the DB is
//      still `finalized` (the Zoho promotion is a droppable waitUntil).
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/enquiry-sent-revision.test.mjs`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const be = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'update-parts', 'pure.ts')));

const quoted = { name: 'Bearing', qty: '2', rates: [{ vendor: 'A', rate: 900 }], finalRate: 900 };
const bare = { name: 'Seal', qty: '1', rates: [], finalRate: null };
const stored = (over = {}) => ({
  id: 'e1',
  rateStatus: 'sent',
  procurementSubmittedAt: '2026-11-21T10:00:00.000Z',
  items: [quoted],
  ...over,
});

describe('implicit sent revision', () => {
  it('reopens a sent row when a line is appended', () => {
    const updates = { items: [quoted, bare] };
    assert.equal(be.applyImplicitSentRevision(updates, { stored: stored() }), true);
    assert.equal(updates.rateStatus, 'finalized');
    assert.equal(updates.procurementSubmittedAt, '');
    assert.ok(updates.sentRevisionAt, 'stamps the under-revision marker');
  });

  it('never triggers from the procurement surface (they add quotes, not lines)', () => {
    const updates = { items: [quoted, bare] };
    assert.equal(be.applyImplicitSentRevision(updates, { stored: stored(), surface: 'procurement' }), false);
    assert.equal(updates.rateStatus, undefined);
  });

  it('ignores edits, reorders and deletes (same item count)', () => {
    const updates = { items: [{ ...quoted, qty: '3' }] };
    assert.equal(be.applyImplicitSentRevision(updates, { stored: stored() }), false);
  });

  it('ignores rows that are not sent — they already loop both queues', () => {
    const updates = { items: [quoted, bare] };
    assert.equal(be.applyImplicitSentRevision(updates, { stored: stored({ rateStatus: 'finalized' }) }), false);
  });

  it('never overrides an explicit rateStatus in the same write', () => {
    const updates = { items: [quoted, bare], rateStatus: 'sent' };
    assert.equal(be.applyImplicitSentRevision(updates, { stored: stored() }), false);
  });
});

describe('first quote on an unquoted line', () => {
  const rateCtx = (storedRow) => ({
    storedForItems: storedRow,
    storedItems: storedRow.items,
    privileged: false,
    restricted: false,
    canConclude: true,
  });

  it('reopens a concluded row (clears the stamp)', () => {
    const row = stored({ items: [bare] });
    const updates = { items: [quoted] };
    be.applyRateLifecycles(updates, rateCtx(row));
    assert.equal(updates.procurementSubmittedAt, '');
    assert.equal(updates.rateStatus, undefined, 'reopen, not a finalize');
  });

  it('marks an already-sent row under revision', () => {
    const row = stored({ procurementSubmittedAt: '', items: [bare] });
    const updates = { items: [quoted] };
    be.applyRateLifecycles(updates, rateCtx(row));
    assert.ok(updates.sentRevisionAt, 'management can decide the new line');
  });

  it('leaves a late quote on an already-quoted line alone', () => {
    const row = stored({ procurementSubmittedAt: '', items: [quoted] });
    const updates = { items: [{ ...quoted, rates: [...quoted.rates, { vendor: 'B', rate: 850 }] }] };
    be.applyRateLifecycles(updates, rateCtx(row));
    assert.equal(updates.sentRevisionAt, undefined);
  });
});

describe('revise verb', () => {
  it('accepts a row the UI shows as sent while the DB is still finalized', () => {
    const updates = { reviseSent: true };
    const err = be.applySentRevision(updates, {
      storedRateStatus: 'finalized',
      storedRevision: '',
      privileged: true,
    });
    assert.equal(err, null);
    assert.equal(updates.rateStatus, 'finalized');
    assert.ok(updates.sentRevisionAt);
  });

  it('still refuses a genuinely unsent row', () => {
    const updates = { reviseSent: true };
    const err = be.applySentRevision(updates, {
      storedRateStatus: 'rate_pending',
      storedRevision: '',
      privileged: false,
    });
    assert.match(String(err), /Only sent enquiries can be revised/);
  });
});
