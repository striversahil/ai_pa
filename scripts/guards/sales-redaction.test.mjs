// sales-redaction.test.mjs — Guard: sales never sees vendor information.
//
// Founder rule: vendor names (and vendor descriptions, which identify the
// source) must never reach a sales payload — not in rate rows (decided,
// shared or unshared), and not inside internal loop notes (e.g. the
// late-quote audit note, which names the vendor). Internal + rates-kind
// loops are stripped for sales readers; the decided row keeps only the
// `selected` marker, shared rows keep their anonymized salesNote/final rate.
// Management/procurement payloads are untouched (vendors + discounts intact).
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/sales-redaction.test.mjs`
// Exit: 0 = invariant holds, 1 = regression.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const { stripMarginFields } = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'scopes.ts')));

// Kota Dal Mill shape (2026-11-12 incident): decided item, selected vendor
// row, one unshared late vendor quote, internal late-quote audit note naming
// the vendor, one open rates request, one answered spec ask.
const kotaRow = () => ({
  items: [{
    name: 'Expansion food grade bellow 4 inch',
    selectedVendor: 'Girnar rubber pvt ltd',
    markup: 500,
    finalRate: 5590,
    rates: [
      { vendor: 'Girnar rubber pvt ltd', rate: 5090, description: 'Raj Engineers', discountPercent: 2, quotedAt: '2026-11-12T07:31:34.537Z', sharedWithSales: true, salesNote: 'best option', sharedFinalRate: 5590 },
      { vendor: 'Namrata Rubber Product Pvt. Ltd.', rate: 4900, quotedAt: '2026-11-12T09:29:37.904Z' },
    ],
    loops: [
      { id: 'lp_note', kind: 'note', text: 'Late vendor quote (Namrata Rubber Product Pvt. Ltd.) — previous rate kept for sales', openedBy: 'sales', openedAt: '2026-11-12T09:30:00.000Z', holder: 'sales', status: 'answered', internal: true, answer: { text: 't', by: 'sales', at: '2026-11-12T09:30:00.000Z' }, closedAt: '2026-11-12T09:30:00.000Z' },
      { id: 'lp_rates', kind: 'rates', text: 'need vendor', openedBy: 'management', openedAt: '2026-11-12T06:00:00.000Z', holder: 'procurement', status: 'open' },
      { id: 'lp_spec', kind: 'spec', text: 'Send pic of these items', openedBy: 'procurement', openedAt: '2026-11-12T06:00:00.000Z', holder: 'sales', status: 'answered' },
    ],
  }],
});

const VENDOR_STRINGS = ['Namrata', 'Girnar', 'Raj Engineers'];

describe('sales redaction: no vendor information in sales payloads', () => {
  it('sales (hideRequests): zero vendor strings anywhere in the row', () => {
    const out = stripMarginFields(kotaRow(), { hideRequests: true });
    const s = JSON.stringify(out);
    for (const v of VENDOR_STRINGS) {
      assert.ok(!s.includes(v), `sales payload leaks vendor string ${v}`);
    }
  });

  it('sales (hideRequests): internal + rates loops stripped, spec ask stays', () => {
    const out = stripMarginFields(kotaRow(), { hideRequests: true });
    const loops = out.items[0].loops;
    assert.ok(!loops.some((l) => l?.internal === true), 'internal note reaches sales');
    assert.ok(!loops.some((l) => l?.kind === 'rates'), 'rates request reaches sales');
    assert.ok(loops.some((l) => l?.kind === 'spec'), 'spec ask must stay visible to sales');
  });

  it('sales (hideRequests): decision context survives (selected, finalRate, salesNote)', () => {
    const out = stripMarginFields(kotaRow(), { hideRequests: true });
    const [sel, alt] = out.items[0].rates;
    assert.strictEqual(sel.selected, true);
    assert.strictEqual(sel.salesNote, 'best option');
    assert.strictEqual(out.items[0].finalRate, 5590);
    assert.strictEqual(out.items[0].selectedVendor, undefined);
    assert.strictEqual(out.items[0].markup, undefined);
    assert.strictEqual(alt.vendor, undefined);
  });

  it('management/procurement (no hideRequests): vendors, discounts and internals intact', () => {
    const out = stripMarginFields(kotaRow(), {});
    const s = JSON.stringify(out);
    for (const v of VENDOR_STRINGS) {
      assert.ok(s.includes(v), `manager payload lost ${v}`);
    }
    assert.strictEqual(out.items[0].rates[0].discountPercent, 2);
    assert.ok(out.items[0].loops.some((l) => l?.internal === true), 'manager must keep internal notes');
  });
});
