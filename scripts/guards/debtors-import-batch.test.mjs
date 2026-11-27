// debtors-import-batch.test.mjs — Guard: a paste import is BULK, not per row.
//
// Regression this locks (2026-11-27): every pasted row cost TWO D1 round trips
// (the d1-prisma shim's create/update read-back) plus a full-book core mirror,
// so a 1,000-row paste issued ~2,000 queries in one Worker invocation and the
// edge killed it — the user saw a bare 503 and a half-applied sheet.
//
// Rules pinned here:
//  · one prepared statement per mutated row, flushed 50-per `db.batch()`;
//  · no SELECT in the write plan (reads stay outside the row loop);
//  · the invoice upsert targets the composite unique key, so a re-paste can
//    never create a second receivable for (invoiceNo, customerName);
//  · a dated received event is only emitted for a real money movement;
//  · the import functions contain no `prisma.X.create/update` per-row write.
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const TRACKER = join(BACKEND_DIR, 'src', 'automations', 'debtors-tracker');
const plan = await import(bundleToFile(join(TRACKER, 'imports-parts', 'plan.ts')));

const read = (rel) => readFileSync(join(TRACKER, rel), 'utf8');

describe('plan statements are single-statement writes (no read-back)', () => {
  it('invoice insert upserts on the composite unique key', () => {
    const s = plan.debtorInvoiceInsert({ id: 'i1', invoiceNo: 'BUI/1', customerName: 'ACME', invoiceAmount: 100 });
    assert.match(s.sql, /^INSERT INTO "DebtorInvoice"/);
    assert.match(s.sql, /ON CONFLICT \("invoiceNo", "customerName"\) DO UPDATE SET/);
    assert.doesNotMatch(s.sql, /SELECT/);
    // id / createdAt are never overwritten when the row already exists.
    assert.doesNotMatch(s.sql, /SET[^]*"id" = excluded/);
    assert.doesNotMatch(s.sql, /SET[^]*"createdAt" = excluded/);
  });
  it('invoice update is one UPDATE by id', () => {
    const s = plan.debtorInvoiceUpdate('i1', { remarks: 'x', deleted: false });
    assert.match(s.sql, /^UPDATE "DebtorInvoice" SET "remarks" = \?, "deleted" = \? WHERE "id" = \?$/);
    assert.deepEqual(s.params.slice(-1), ['i1']);
    // booleans bind as 0/1 exactly like the shim
    assert.deepEqual(s.params, ['x', 0, 'i1']);
  });
  it('collection insert upserts on dedupKey; update is by id', () => {
    const ins = plan.paymentCollectionInsert({ id: 'c1', dedupKey: 'receipt:9', amount: 5 });
    assert.match(ins.sql, /ON CONFLICT \("dedupKey"\)/);
    const upd = plan.paymentCollectionUpdate('c1', { deleted: true });
    assert.match(upd.sql, /^UPDATE "PaymentCollection" SET "deleted" = \? WHERE "id" = \?$/);
  });
  it('customer insert upserts on customerKey', () => {
    const s = plan.paymentCustomerInsert({ customerKey: 'acme', customerName: 'ACME' });
    assert.match(s.sql, /ON CONFLICT \("customerKey"\)/);
  });
});

describe('received history — only a real movement', () => {
  it('is a no-op under Rs 0.005 (a re-paste that changes nothing writes nothing)', () => {
    assert.equal(plan.receivedEventStatement({ invoiceId: 'i1', day: '2026-11-27', amountDelta: 0 }), null);
    assert.equal(plan.receivedEventStatement({ invoiceId: 'i1', day: '2026-11-27', amountDelta: 0.004 }), null);
    assert.equal(plan.receivedEventStatement({ invoiceId: '', day: '2026-11-27', amountDelta: 10 }), null);
  });
  it('records the delta (rounded to paise) as one row', () => {
    const s = plan.receivedEventStatement({ invoiceId: 'i1', day: '2026-11-27', amountDelta: 12.345, importedBy: 'a@b' });
    assert.match(s.sql, /^INSERT INTO "DebtorInvoiceReceivedEvent"/);
    assert.equal(s.params[1], 'i1');
    assert.equal(s.params[3], 12.35);
  });
});

describe('query budget — a 1,000-row paste stays flat', () => {
  it('chunks 50 statements per round trip', () => {
    const statements = Array.from({ length: 1000 }, () => ({ sql: 'x', params: [] }));
    const chunks = plan.chunkStatements(statements);
    assert.equal(plan.STATEMENTS_PER_BATCH, 50);
    assert.equal(chunks.length, 20);
    assert.equal(chunks.every((c) => c.length <= 50), true);
    assert.equal(chunks.reduce((n, c) => n + c.length, 0), 1000);
  });
  it('1,000 invoices cost ~20 D1 calls, not ~2,000', () => {
    const perRow = plan.debtorInvoiceInsert({ id: 'x', invoiceNo: 'n', customerName: 'c' });
    assert.equal(perRow.params.length > 0, true);
    const calls = Math.ceil(1000 / plan.STATEMENTS_PER_BATCH);
    assert.equal(calls <= 25, true, `a 1,000-row paste must stay under 25 batch calls (got ${calls})`);
  });
});

describe('import loops never write row-by-row through the shim', () => {
  const io = read('imports-parts/io.ts');
  const slice = (name) => {
    const from = io.indexOf(`export async function ${name}(`);
    assert.notEqual(from, -1, `${name} must exist`);
    const next = io.indexOf('\nexport async function ', from + 1);
    return io.slice(from, next === -1 ? io.length : next);
  };
  for (const fn of ['importDebtors', 'importCollections']) {
    it(`${fn} batches its writes`, () => {
      const body = slice(fn);
      assert.doesNotMatch(body, /prisma\.\w+\.(create|update)\(/, `${fn} must push statements, not await shim writes`);
      assert.match(body, /runStatements\(writes\)/);
    });
  }
  it('the customer master batches too', () => {
    const customers = read('customers.ts');
    const from = customers.indexOf('export async function ensureCustomers(');
    const body = customers.slice(from, customers.indexOf('\nexport ', from + 1));
    assert.doesNotMatch(body, /prisma\.\w+\.(create|update)\(/);
    assert.match(body, /runStatements\(writes\)/);
  });
  it('the route hands the core mirror to waitUntil (never the request path)', () => {
    const route = readFileSync(join(BACKEND_DIR, 'src', 'worker', 'routes', 'debtors-tracker.ts'), 'utf8');
    assert.match(route, /waitUntil\(run\)/);
    assert.match(route, /if \(report\.done === false \|\| !report\.parsed\) return;/);
  });
});
