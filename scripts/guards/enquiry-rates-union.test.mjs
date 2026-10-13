// enquiry-rates-union.test.mjs — Guard: vendor quotes are append-only.
//
// The Oct-2026 Greaves incident: a stale management snapshot save silently
// deleted a vendor rate + its revised decision (last-writer-wins full-array
// replace). The invariant now lives in ONE place — normalizeItemWrites in
// backend src/modules/enquiries/update.ts — and covers all three loops
// (sales / procurement / management) because every PATCH funnels through it:
//
//   1. rates merge by vendor|rate identity (stored-only quotes survive),
//   2. deletion ONLY via explicit `removedRates` ["vendor|rate"],
//   3. dangling incoming selections keep the stored one,
//   4. every reinstate/delete stamps the item trail.
//
// This guard replays stale-snapshot saves from each writer role over a stored
// row that already holds two vendors + a decision, and fails if any quote,
// decision, or trail entry is lost.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/enquiry-rates-union.test.mjs`
// Exit: 0 = invariant holds, 1 = regression.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const { normalizeItemWrites } = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'update.ts')));
const { pickEnquiryFields } = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'parse.ts')));

const CBPL_GEAR = { vendor: 'CBPL', rate: 45763, description: 'gearbox', quotedAt: '2026-10-06T09:21:32.017Z' };
const CBPL_MOTOR = { vendor: 'CBPL', rate: 19121, description: 'motor', quotedAt: '2026-10-06T09:22:35.647Z' };
const GREAVES = { vendor: 'Greaves', rate: 23110, description: 'Raj Engineers', quotedAt: '2026-10-07T10:00:00.000Z' };

// Stored row AFTER the Greaves revision: both vendors + Greaves decision.
const storedGreavesItem = () => ({
  name: 'Reduction Gear Motor', qty: '', spec: '5 HP',
  rates: [{ ...CBPL_GEAR }, { ...CBPL_MOTOR }, { ...GREAVES }],
  selectedVendor: 'Greaves', markup: 5000, finalRate: 62000, finalizedAt: '2026-10-07T11:00:00.000Z',
  thread: [],
});

// Stale pre-Greaves snapshot (the Oct-6 CBPL finalize) as each role would send it.
const staleCbplItem = () => ({
  name: 'Reduction Gear Motor', qty: '', spec: '5 HP',
  rates: [{ ...CBPL_GEAR }, { ...CBPL_MOTOR }],
  selectedVendor: 'CBPL', markup: 9157, finalRate: 54920, finalizedAt: '2026-10-06T10:11:09.544Z',
  thread: [],
});

const CTX = {
  management: { storedItems: [], privileged: true, restricted: false, actingProcurement: false },
  procurementViewer: { storedItems: [], privileged: false, restricted: true, actingProcurement: true },
  procurementMis: { storedItems: [], privileged: true, restricted: false, actingProcurement: true },
  sales: { storedItems: [], privileged: false, restricted: false, actingProcurement: false },
};
const withStored = (role) => ({ ...CTX[role], storedItems: [storedGreavesItem()] });
const vendorsOf = (item) => (item.rates ?? []).map((r) => r.vendor).sort();

describe('rates union: stale snapshots never delete quotes', () => {
  for (const role of ['management', 'procurementViewer', 'procurementMis', 'sales']) {
    it(`[${role}] stale pre-Greaves save keeps all quotes + stamps trail`, () => {
      const out = normalizeItemWrites([staleCbplItem()], withStored(role))[0];
      assert.deepStrictEqual(vendorsOf(out), ['CBPL', 'CBPL', 'Greaves']);
      // Trail records the rescue.
      const trail = Array.isArray(out.thread) ? out.thread : [];
      assert.ok(trail.some((e) => String(e?.text ?? '').includes('kept')), `trail stamps reinstatement, got: ${JSON.stringify(trail)}`);
    });
  }

  it('[non-privileged] stale save can never rewind the stored decision', () => {
    for (const role of ['procurementViewer', 'sales']) {
      const out = normalizeItemWrites([staleCbplItem()], withStored(role))[0];
      assert.strictEqual(out.selectedVendor, 'Greaves');
      assert.strictEqual(out.finalRate, 62000);
      assert.strictEqual(out.finalizedAt, '2026-10-07T11:00:00.000Z');
    }
  });

  it('[management] explicit privileged decisions are honored (rates still unioned)', () => {
    // A deliberate switch back to CBPL is a real choice, not staleness:
    // the decision applies, but Greaves rates survive for one-click reselect.
    const out = normalizeItemWrites([staleCbplItem()], withStored('management'))[0];
    assert.strictEqual(out.selectedVendor, 'CBPL');
    assert.deepStrictEqual(vendorsOf(out), ['CBPL', 'CBPL', 'Greaves']);
  });

  it('[management] dangling selection (vendor gone from quotes) keeps stored', () => {
    const incoming = staleCbplItem();
    incoming.selectedVendor = 'GhostVendor';
    const out = normalizeItemWrites([incoming], withStored('management'))[0];
    assert.strictEqual(out.selectedVendor, 'Greaves');
    assert.deepStrictEqual(vendorsOf(out), ['CBPL', 'CBPL', 'Greaves']);
  });

  it('[sales] availability-flip with omitted rates keeps stored quotes (old guard, still covered)', () => {
    const incoming = staleCbplItem();
    delete incoming.rates;
    incoming.rateAvailable = true;
    const stored = storedGreavesItem();
    stored.rateAvailable = false;
    const out = normalizeItemWrites([incoming], { ...CTX.sales, storedItems: [stored] })[0];
    assert.deepStrictEqual(vendorsOf(out), ['CBPL', 'CBPL', 'Greaves']);
  });

  it('explicit removedRates deletes exactly the named quote (management + sales)', () => {
    for (const role of ['management', 'sales']) {
      const incoming = staleCbplItem();
      // Fresh snapshot first (has Greaves), then an explicit delete of one CBPL row.
      const fresh = { ...storedGreavesItem() };
      fresh.removedRates = ['CBPL|19121'];
      fresh.rates = fresh.rates.filter((r) => !(r.vendor === 'CBPL' && r.rate === 19121));
      const out = normalizeItemWrites([fresh], withStored(role))[0];
      assert.deepStrictEqual(vendorsOf(out), ['CBPL', 'Greaves']);
      const trail = Array.isArray(out.thread) ? out.thread : [];
      assert.ok(trail.some((e) => String(e?.text ?? '').includes('removed')), `trail stamps deletion, got: ${JSON.stringify(trail)}`);
    }
  });

  it('fresh vendor add passes through untouched with no rescue stamp', () => {
    const stored = { name: 'X', qty: '', spec: 's', rates: [{ ...CBPL_GEAR }], thread: [] };
    const incoming = { name: 'X', qty: '', spec: 's', rates: [{ ...CBPL_GEAR }, { ...GREAVES }] };
    const out = normalizeItemWrites([incoming], { ...CTX.management, storedItems: [stored] })[0];
    assert.deepStrictEqual(vendorsOf(out), ['CBPL', 'Greaves']);
    assert.strictEqual((out.thread ?? []).length, 0);
  });

  it('removedRates never persists on the stored row', () => {
    const fresh = { ...storedGreavesItem(), removedRates: ['CBPL|19121'] };
    fresh.rates = fresh.rates.filter((r) => !(r.vendor === 'CBPL' && r.rate === 19121));
    const out = normalizeItemWrites([fresh], withStored('management'))[0];
    assert.strictEqual(out.removedRates, undefined);
  });

  it('identical vendor|rate twins never collapse (descriptions survive)', () => {
    const twinA = { vendor: 'CBPL', rate: 19121, description: 'gearbox note' };
    const twinB = { vendor: 'CBPL', rate: 19121, description: 'motor note' };
    const stored = { name: 'X', qty: '', spec: 's', rates: [twinA, twinB], thread: [] };
    // Stale save carrying only one twin: the other is reinstated, not merged away.
    const out = normalizeItemWrites(
      [{ name: 'X', qty: '', spec: 's', rates: [{ ...twinA }] }],
      { ...CTX.management, storedItems: [stored] },
    )[0];
    assert.strictEqual(out.rates.length, 2);
    assert.deepStrictEqual(out.rates.map((r) => r.description).sort(), ['gearbox note', 'motor note']);
    // Explicit delete removes exactly one twin: the incoming-carried twin
    // (gearbox — still in the user's view) pairs and stays; the leftover
    // twin (motor) is what the marker kills.
    const del = normalizeItemWrites(
      [{ name: 'X', qty: '', spec: 's', rates: [{ ...twinA }], removedRates: ['CBPL|19121'] }],
      { ...CTX.management, storedItems: [stored] },
    )[0];
    assert.strictEqual(del.rates.length, 1);
    assert.strictEqual(del.rates[0].description, 'gearbox note');
  });

  it('full PATCH pipeline: stale panel payload survives pickEnquiryFields whitelist', () => {
    // The exact Greaves incident replay: frozen pre-Greaves panel snapshot
    // goes through the real field whitelist, then the real merge.
    const body = { items: [staleCbplItem()] };
    const picked = pickEnquiryFields(body);
    assert.ok(picked && Array.isArray(picked.items) && picked.items.length === 1);
    const out = normalizeItemWrites(picked.items, withStored('management'))[0];
    assert.deepStrictEqual(vendorsOf(out), ['CBPL', 'CBPL', 'Greaves']);
  });

  it('full PATCH pipeline: explicit delete marker survives the whitelist and deletes', () => {
    // Real delete UIs send the filtered array (row gone) PLUS the marker.
    const gone = { ...storedGreavesItem() };
    gone.rates = gone.rates.filter((r) => !(r.vendor === 'Greaves' && r.rate === 23110));
    gone.removedRates = ['Greaves|23110'];
    const body = { items: [gone] };
    const picked = pickEnquiryFields(body);
    assert.deepStrictEqual(picked.items[0].removedRates, ['Greaves|23110']);
    const out = normalizeItemWrites(picked.items, withStored('management'))[0];
    assert.deepStrictEqual(vendorsOf(out), ['CBPL', 'CBPL']);
  });
});
