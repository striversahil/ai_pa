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
import { BACKEND_DIR, FRONTEND_SRC, bundleToFile } from './_bundle.mjs';

const { stripMarginFields } = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'scopes.ts')));
// The sales payload is USELESS if the client normalizer throws the brief away:
// it used to keep a quote row only when it carried a vendor name, which a
// sales payload never does — so the ORDER BRIEF ("order this spec" + "note
// from management") rendered for root and for nobody else. Pin both halves.
const { toEnquiry } = await import(bundleToFile(join(FRONTEND_SRC, 'enquiry', 'normalize.ts'), { alias: { '@': FRONTEND_SRC } }));
const { normalizeItemWrites } = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'update-parts', 'pure.ts')));

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
      { vendor: 'Girnar rubber pvt ltd', rate: 5090, description: 'Raj Engineers', discountPercent: 2, quotedAt: '2026-11-12T07:31:34.537Z', sharedWithSales: true, salesNote: 'best option', sharedFinalRate: 5590, specSame: false, specDiff: 'Rubber 150mm (not 4 inch)' },
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

  it('procurement keeps the vendor on a management-shared alternate it quoted', () => {
    const out = stripMarginFields({
      items: [{ selectedVendor: 'A Corp', rates: [{ vendor: 'A Corp', rate: 100, sharedWithSales: true }, { vendor: 'B Corp', rate: 90, sharedWithSales: true }] }],
    }, {});
    assert.strictEqual(out.items[0].rates[1].vendor, 'B Corp', 'shared alternate must stay identifiable for procurement');
  });
});

describe('sales order brief: the appended row survives the client normalizer', () => {
  it('server marks exactly the forwardable rows anonymous (decided + shared)', () => {
    const out = stripMarginFields(kotaRow(), { hideRequests: true });
    const [sel, alt] = out.items[0].rates;
    assert.strictEqual(sel.anonymous, true);
    assert.strictEqual(sel.selected, true);
    assert.strictEqual(alt.anonymous, undefined, 'unshared alternate must stay unmarked (invisible to sales)');
  });

  it('non-root sales keeps the decided quote: salesNote + specDiff + selected', () => {
    const out = stripMarginFields(kotaRow(), { hideRequests: true });
    const it = toEnquiry(out).items[0];
    assert.strictEqual(it.rates.length, 1, 'decided quote must survive normalization for sales');
    const decided = it.rates[0];
    assert.strictEqual(decided.salesNote, 'best option');
    assert.strictEqual(decided.specSame, false);
    assert.strictEqual(decided.specDiff, 'Rubber 150mm (not 4 inch)');
    assert.strictEqual(decided.selected, true);
    assert.strictEqual(decided.vendor, '', 'vendor name must still be gone');
  });

  it('an anonymized echo never ghosts a quote (union keeps the 2 stored rows)', () => {
    const storedItems = [{ name: 'x', rates: [{ vendor: 'A Corp', rate: 100 }, { vendor: 'B Corp', rate: 90 }] }];
    const echo = [{ name: 'x', rates: [{ rate: 100, selected: true, anonymous: true }, { rate: 90 }] }];
    const out = normalizeItemWrites(echo, { storedItems, privileged: false, restricted: false, actingProcurement: false });
    assert.strictEqual(out[0].rates.length, 2, 'vendor-less rows must not be merged as new quotes');
    assert.deepStrictEqual(out[0].rates.map((r) => r.vendor).sort(), ['A Corp', 'B Corp']);
  });

  it('management can still add a quote by name', () => {
    const storedItems = [{ name: 'x', rates: [{ vendor: 'A Corp', rate: 100 }] }];
    const out = normalizeItemWrites([{ name: 'x', rates: [{ vendor: 'C Corp', rate: 80 }] }], { storedItems, privileged: true, restricted: false, actingProcurement: false });
    assert.deepStrictEqual(out[0].rates.map((r) => r.vendor).sort(), ['A Corp', 'C Corp']);
  });
});
