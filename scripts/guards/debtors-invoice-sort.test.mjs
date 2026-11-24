// debtors-invoice-sort.test.mjs — Guard: invoice-number sorting + stacking.
//
// Founder rule (2026-11-26): the invoice number IS the trailing `/` segment
// (`BUI/26-27/751` → 751), and a header click on a new column stacks as a
// sub-level. Both live in `debtors-tracker/multi-sort.ts` and are used by the
// Invoices tab, the Collections tab and the overdue export — so the module is
// bundled here and its comparator pinned.
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { FRONTEND_SRC, bundleToFile } from './_bundle.mjs';

const ms = await import(
  bundleToFile(join(FRONTEND_SRC, 'debtors-tracker', 'multi-sort.ts'), { alias: { '@': FRONTEND_SRC } }),
);

describe('invoiceSerial — the trailing / segment is the invoice number', () => {
  it('reads the serial after the last slash', () => {
    assert.equal(ms.invoiceSerial('BUI/26-27/751'), 751);
    assert.equal(ms.invoiceSerial('BUI/26-27/704'), 704);
    assert.equal(ms.invoiceSerial(' BUI/26-27/12 '), 12);
    assert.equal(ms.invoiceSerial('1836'), 1836);
    assert.equal(ms.invoiceSerial(1836), 1836);
  });
  it('returns null when the last segment is not a plain number', () => {
    for (const bad of ['BUI/TI0476/17-18', 'BUI/26-27/', '', '   ', null, undefined, 'abc']) {
      assert.equal(ms.invoiceSerial(bad), null, `serial of ${JSON.stringify(bad)}`);
    }
  });
});

describe('compareInvoiceNo — always finite, serial first', () => {
  it('orders by serial, not by the whole string', () => {
    // 751 < 1000 even though 'BUI/26-27/751' would lose a plain string compare,
    // and a newer FY (26-27) never outranks a bigger serial (1200).
    const sorted = ['BUI/26-27/1000', 'BUI/25-26/1200', 'BUI/26-27/751', 'BUI/TI0476/17-18', '1836'].sort(ms.compareInvoiceNo);
    assert.deepEqual(sorted, ['BUI/26-27/751', 'BUI/26-27/1000', 'BUI/25-26/1200', '1836', 'BUI/TI0476/17-18']);
  });
  it('never returns NaN for any pair (a NaN comparator kills the sort)', () => {
    const corpus = ['BUI/26-27/751', '1836', null, undefined, '', 'BUI/TI0476/17-18', 'x/y/z', 42, '0'];
    for (const a of corpus) {
      for (const b of corpus) {
        const cmp = ms.compareInvoiceNo(a, b);
        assert.equal(Number.isFinite(cmp), true, `compare(${JSON.stringify(a)}, ${JSON.stringify(b)}) = ${cmp}`);
        const rev = ms.compareInvoiceNo(b, a);
        // 0 vs -0 is equality here: Object.is would treat them as different.
        assert.equal(cmp === 0 ? rev === 0 : Math.sign(cmp) === -Math.sign(rev), true, `antisymmetry ${JSON.stringify(a)}/${JSON.stringify(b)}`);
      }
    }
  });
  it('is stable for equal serials (falls back to the full string)', () => {
    assert.equal(ms.compareInvoiceNo('A/1/7', 'A/1/7'), 0);
    assert.equal(ms.compareInvoiceNo('A/1/7', 'B/2/7') < 0, true);
  });
});

describe('nextSortSpecs — a new column stacks as a sub-level', () => {
  const TEXT_FIRST = new Set(['customer', 'invoice']);
  const DEFAULTS = [{ key: 'date', dir: 'desc' }];

  it('appends on the first click instead of replacing the default', () => {
    const next = ms.nextSortSpecs(DEFAULTS, 'invoice', DEFAULTS, TEXT_FIRST);
    assert.deepEqual(next, [{ key: 'date', dir: 'desc' }, { key: 'invoice', dir: 'asc' }]);
  });
  it('flips, then removes, then falls back to the table default', () => {
    let specs = ms.nextSortSpecs(DEFAULTS, 'invoice', DEFAULTS, TEXT_FIRST);
    specs = ms.nextSortSpecs(specs, 'invoice', DEFAULTS, TEXT_FIRST);
    assert.deepEqual(specs, [{ key: 'date', dir: 'desc' }, { key: 'invoice', dir: 'desc' }]);
    specs = ms.nextSortSpecs(specs, 'invoice', DEFAULTS, TEXT_FIRST);
    assert.deepEqual(specs, DEFAULTS);
  });
  it('keeps the active sub-level while another column is added', () => {
    const one = ms.nextSortSpecs(DEFAULTS, 'invoice', DEFAULTS, TEXT_FIRST);
    const two = ms.nextSortSpecs(one, 'customer', DEFAULTS, TEXT_FIRST);
    assert.deepEqual(two, [
      { key: 'date', dir: 'desc' },
      { key: 'invoice', dir: 'asc' },
      { key: 'customer', dir: 'asc' },
    ]);
  });
});
