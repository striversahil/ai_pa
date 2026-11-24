// debtors-as-of.test.mjs — Guard: Debtors Tracker point-in-time ("as of") maths.
//
// The Summary date range rebuilds the ledger from dated rows instead of a
// snapshot, so the money rules must be exact and stable:
//   • asOf = today is byte-identical to the pre-feature computation
//   • invoices/receipts dated after asOf are invisible
//   • the pasted sheet "Amount Received" counts only from the import that
//     recorded it (or from its dated events once migration 0162 is live)
//   • ageing buckets are computed AT asOf, not today
//   • then-vs-now reconciles: receivableChange = invoiced − collected − sheetAdj
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR, REPO_ROOT, bundleToFile } from './_bundle.mjs';

const dir = join(BACKEND_DIR, 'src', 'automations', 'debtors-tracker');
const asOf = await import(bundleToFile(join(dir, 'as-of.ts')));
const ledger = await import(bundleToFile(join(dir, 'ledger.ts')));

const TODAY = '2026-11-24';

const invoice = (over = {}) => ({
  id: 'i1',
  customerName: 'Acme Mills',
  invoiceNo: 'BUI/26-27/751',
  invoiceDate: '2026-10-01',
  creditPeriodDays: 30,
  dueDate: '2026-10-31',
  invoiceAmount: 1000,
  baseReceived: 0,
  collectedAtImport: 0,
  deleted: false,
  deletedAt: null,
  lastImportAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  ...over,
});

const receipt = (over = {}) => ({
  id: 'c1',
  customerName: 'Acme Mills',
  invoiceNo: 'BUI/26-27/751',
  collectionDate: '2026-11-05',
  amount: 300,
  mode: 'NEFT',
  matchStatus: 'invoice',
  resolvedInvoiceId: 'i1',
  deleted: false,
  deletedAt: null,
  createdAt: '2026-11-05T10:00:00.000Z',
  ...over,
});

const addDays = (iso, days) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe('parseAsOfParams', () => {
  it('no params = today, live', () => {
    const p = asOf.parseAsOfParams({}, TODAY);
    assert.equal(p.asOf, TODAY);
    assert.equal(p.from, null);
    assert.equal(p.historical, false);
    assert.equal(p.error, undefined);
  });

  it('a future asOf is clamped to today (shared links keep working)', () => {
    const p = asOf.parseAsOfParams({ asOf: '2027-01-01' }, TODAY);
    assert.equal(p.asOf, TODAY);
    assert.equal(p.historical, false);
  });

  it('malformed dates are an error, never silently "today"', () => {
    assert.match(asOf.parseAsOfParams({ asOf: '31-10-2026' }, TODAY).error ?? '', /asOf must be/);
    assert.match(asOf.parseAsOfParams({ from: 'yesterday' }, TODAY).error ?? '', /from must be/);
  });

  it('from must be before asOf; equal or later is dropped', () => {
    const p = asOf.parseAsOfParams({ asOf: '2026-10-31', from: '2026-10-31' }, TODAY);
    assert.equal(p.from, null);
    assert.equal(p.historical, true);
  });

  it('a span beyond the cap is rejected', () => {
    const p = asOf.parseAsOfParams({ asOf: '2026-11-01', from: '2015-01-01' }, TODAY);
    assert.match(p.error ?? '', /limited/);
  });
});

describe('row visibility (soft deletes)', () => {
  it('a bill deleted AFTER asOf is still visible at asOf', () => {
    const row = invoice({ deleted: true, deletedAt: '2026-11-10' });
    assert.equal(asOf.rowVisibleAt(row, '2026-11-01'), true);
    assert.equal(asOf.rowVisibleAt(row, '2026-11-10'), false);
    assert.equal(asOf.rowVisibleAt(row, TODAY), false);
  });

  it('legacy deleted rows without a stamp stay invisible (pre-feature behaviour)', () => {
    assert.equal(asOf.rowVisibleAt(invoice({ deleted: true, deletedAt: null }), '2020-01-01'), false);
    assert.equal(asOf.rowVisibleAt(invoice({ deleted: false }), '2020-01-01'), true);
  });
});

describe('buildLiveInvoices — live parity + as-of', () => {
  it('live mode (no opts) never filters and uses the pasted sheet as-is', () => {
    const future = invoice({ id: 'i2', invoiceDate: '2027-01-01', dueDate: '2027-02-01' });
    const { liveInvoices } = ledger.buildLiveInvoices([invoice({ baseReceived: 250 }), future], [], TODAY);
    assert.equal(liveInvoices.length, 2, 'live mode must keep future-dated rows');
    assert.equal(liveInvoices[0].effectiveReceived, 250);
    assert.equal(liveInvoices[0].balance, 750);
  });

  it('as-of hides invoices and receipts dated after the date', () => {
    const { liveInvoices } = ledger.buildLiveInvoices(
      [invoice({ invoiceDate: '2026-10-01' }), invoice({ id: 'i2', invoiceNo: 'X', invoiceDate: '2026-11-20' })],
      [receipt({ amount: 300, collectionDate: '2026-11-05' }), receipt({ id: 'c2', amount: 500, collectionDate: '2026-11-20' })],
      '2026-11-10',
      { asOf: '2026-11-10' },
    );
    assert.equal(liveInvoices.length, 1, 'the November invoice is not booked yet');
    assert.equal(liveInvoices[0].effectiveReceived, 300, 'only the receipt dated before asOf counts');
    assert.equal(liveInvoices[0].balance, 700);
  });

  it('the pasted sheet figure counts only from the import that recorded it', () => {
    const beforeImport = ledger.buildLiveInvoices(
      [invoice({ baseReceived: 400, lastImportAt: '2026-11-20' })],
      [],
      '2026-11-10',
      { asOf: '2026-11-10' },
    );
    assert.equal(beforeImport.liveInvoices[0].effectiveReceived, 0, 'money is unknown before its import');
    assert.equal(beforeImport.liveInvoices[0].balance, 1000);

    const afterImport = ledger.buildLiveInvoices(
      [invoice({ baseReceived: 400, lastImportAt: '2026-11-20' })],
      [],
      '2026-11-21',
      { asOf: '2026-11-21' },
    );
    assert.equal(afterImport.liveInvoices[0].effectiveReceived, 400);
  });

  it('dated sheet events win over the import cutoff', () => {
    const events = new Map([['i1', [{ day: '2026-10-15', amount: 150 }, { day: '2026-11-01', amount: 250 }]]]);
    const oct = ledger.buildLiveInvoices([invoice({ baseReceived: 400, lastImportAt: '2026-11-20' })], [], '2026-10-20', {
      asOf: '2026-10-20',
      eventsByInvoice: events,
    });
    assert.equal(oct.liveInvoices[0].effectiveReceived, 150);
    const nov = ledger.buildLiveInvoices([invoice({ baseReceived: 400, lastImportAt: '2026-11-20' })], [], '2026-11-02', {
      asOf: '2026-11-02',
      eventsByInvoice: events,
    });
    assert.equal(nov.liveInvoices[0].effectiveReceived, 400);
  });

  it('ageing buckets are computed AT asOf, not today', () => {
    const base = invoice({ dueDate: '2026-01-01', invoiceDate: '2026-01-01', invoiceAmount: 1000 });
    const at = (days) => {
      const date = addDays('2026-01-01', days);
      const [inv] = ledger.buildLiveInvoices([base], [], date, { asOf: date }).liveInvoices;
      return { days, bucket: inv.bucket, overdue: inv.daysOverdue };
    };
    assert.deepEqual(at(0), { days: 0, bucket: 'NOT_DUE', overdue: 0 });
    assert.deepEqual(at(30), { days: 30, bucket: 'D0', overdue: 30 });
    assert.deepEqual(at(31), { days: 31, bucket: 'D31', overdue: 31 });
    assert.deepEqual(at(60), { days: 60, bucket: 'D31', overdue: 60 });
    assert.deepEqual(at(61), { days: 61, bucket: 'D61', overdue: 61 });
    assert.deepEqual(at(90), { days: 90, bucket: 'D61', overdue: 90 });
    assert.deepEqual(at(91), { days: 91, bucket: 'D91', overdue: 91 });
    assert.deepEqual(at(180), { days: 180, bucket: 'D91', overdue: 180 });
    assert.deepEqual(at(181), { days: 181, bucket: 'D181', overdue: 181 });
  });

  it('customer advances reduce net due at the as-of date', () => {
    const rows = [
      invoice({ id: 'i1', invoiceAmount: 1000, dueDate: '2026-10-01' }),
      receipt({ id: 'c1', invoiceNo: 'Advance', matchStatus: 'advance', resolvedInvoiceId: null, amount: 250, collectionDate: '2026-10-10' }),
    ];
    const { liveInvoices, advanceByCustomer } = ledger.buildLiveInvoices(rows, [rows[1]], '2026-11-01', { asOf: '2026-11-01' });
    const dues = ledger.buildCustomerAgeing(liveInvoices, advanceByCustomer);
    assert.equal(dues[0].grossDue, 1000);
    assert.equal(dues[0].advanceReceived, 250);
    assert.equal(dues[0].netDue, 750);
  });
});

describe('movement reconciliation', () => {
  it('receivableChange = invoiced − collected − sheet adjustments', () => {
    const invoices = [
      invoice({ id: 'i1', invoiceAmount: 1000, invoiceDate: '2026-10-01', dueDate: '2026-10-31', lastImportAt: '2026-10-01' }),
      invoice({ id: 'i2', invoiceNo: 'B2', invoiceAmount: 500, invoiceDate: '2026-11-10', dueDate: '2026-12-10', lastImportAt: '2026-11-10' }),
    ];
    const collections = [receipt({ id: 'c1', amount: 300, collectionDate: '2026-11-05' })];
    const from = '2026-10-31';
    const to = '2026-11-15';
    const then = ledger.buildLiveInvoices(invoices, collections, from, { asOf: from });
    const now = ledger.buildLiveInvoices(invoices, collections, to, { asOf: to });
    const thenDues = ledger.buildCustomerAgeing(then.liveInvoices, then.advanceByCustomer);
    const nowDues = ledger.buildCustomerAgeing(now.liveInvoices, now.advanceByCustomer);
    const sum = (dues, key) => Math.round(dues.reduce((s, r) => s + r[key], 0) * 100) / 100;
    const m = asOf.buildMovement({
      invoices,
      collections,
      from,
      to,
      thenInvoices: then.liveInvoices,
      nowInvoices: now.liveInvoices,
      thenCustomers: thenDues,
      nowCustomers: nowDues,
      thenSummary: { totalReceivable: sum(thenDues, 'totalReceivable'), grossDue: sum(thenDues, 'grossDue'), netDue: sum(thenDues, 'netDue') },
      nowSummary: { totalReceivable: sum(nowDues, 'totalReceivable'), grossDue: sum(nowDues, 'grossDue'), netDue: sum(nowDues, 'netDue') },
      receivedThen: then.liveInvoices.reduce((s, i) => s + i.effectiveReceived, 0),
      receivedNow: now.liveInvoices.reduce((s, i) => s + i.effectiveReceived, 0),
    });
    assert.equal(m.invoicedInRange, 500, 'only the November bill is new');
    assert.equal(m.collectedInRange, 300);
    assert.equal(m.sheetAdjustments, 0);
    assert.equal(m.invoicesBooked, 1);
    assert.equal(
      m.receivableChange,
      Math.round((m.invoicedInRange - m.collectedInRange - m.sheetAdjustments) * 100) / 100,
      'movement must reconcile to the receivable delta',
    );
    assert.equal(m.receivableChange, 200);
  });

  it('bucket transitions are reported then → now', () => {
    const before = invoice({ dueDate: '2026-10-01' });
    const then = ledger.buildLiveInvoices([before], [], '2026-10-05', { asOf: '2026-10-05' });
    const now = ledger.buildLiveInvoices([before], [], '2026-11-10', { asOf: '2026-11-10' });
    const pairs = asOf.bucketMovements(then.liveInvoices, now.liveInvoices);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].fromBucket, 'D0');
    assert.equal(pairs[0].toBucket, 'D31');
    assert.equal(pairs[0].count, 1);
  });
});

describe('migrations + payload contract', () => {
  it('0161 stamps soft deletes, 0162 records dated received deltas', () => {
    const m161 = join(REPO_ROOT, 'founder-os_backend', 'migrations', '0161_debtors_softdelete_stamp.sql');
    const m162 = join(REPO_ROOT, 'founder-os_backend', 'migrations', '0162_debtor_received_events.sql');
    assert.ok(existsSync(m161) && existsSync(m162), 'as-of migrations missing');
    const sql161 = readFileSync(m161, 'utf8');
    assert.match(sql161, /ALTER TABLE "DebtorInvoice" ADD COLUMN "deletedAt"/);
    assert.match(sql161, /ALTER TABLE "PaymentCollection" ADD COLUMN "deletedAt"/);
    const sql162 = readFileSync(m162, 'utf8');
    assert.match(sql162, /CREATE TABLE IF NOT EXISTS "DebtorInvoiceReceivedEvent"/);
    assert.match(sql162, /INSERT INTO "DebtorInvoiceReceivedEvent"/);
  });

  it('backend payload + frontend mirror both carry the as-of meta and compare block', () => {
    const be = readFileSync(join(dir, 'types-parts', 'types.ts'), 'utf8');
    const fe = readFileSync(join(REPO_ROOT, 'founder-os_frontend', 'src', 'debtors-tracker', 'types.ts'), 'utf8');
    for (const src of [be, fe]) {
      assert.match(src, /isHistorical:\s*boolean/);
      assert.match(src, /rangeFrom:\s*string \| null/);
      assert.match(src, /coverage/);
      assert.match(src, /compare\?/);
    }
  });
});
