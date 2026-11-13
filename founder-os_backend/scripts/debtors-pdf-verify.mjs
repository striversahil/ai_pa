// Verifies, against the REAL bundled worker:
//  1. Separator-tolerant FY matching: slash-FY ledger rows, dot/underscore
//     variants, and the overlapping-scan guard (76/17 must NOT read as FY).
//  2. PDF survival: hard-delete an invoice row (simulates reset), re-paste
//     the sheet, attachment re-links (report pdfsRelinked=1, file serves).
import { fakeD1 } from './d1-mock.mjs';
const app = (await import('../dist-worker/worker.js')).default;

const db = fakeD1();
const kvStore = new Map();
const env = {
  DB: db, SHARED_SECRET: 'test-secret',
  GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', AUTH_PUBLIC_ORIGIN: 'https://example.test',
  CHAT_FILES: {
    async getWithMetadata(key) {
      const v = kvStore.get(key);
      return { value: v ? await Promise.resolve(v) : null, metadata: {} };
    },
    async put(key, val) { kvStore.set(key, val); },
    async delete(key) { kvStore.delete(key); },
  },
};
const future = new Date(Date.now() + 360_0000).toISOString();
const now = new Date().toISOString();
await db.prepare('INSERT INTO auth_user (id, email, name, picture, isRoot, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
  .bind('acc', 'acc@example.test', 'acc', null, 0, now).run();
await db.prepare('INSERT INTO auth_session (id, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)')
  .bind('sess-acc', 'acc', future, now).run();
await db.prepare('INSERT INTO auth_user_scope (id, userId, scopeKey) VALUES (?, ?, ?)')
  .bind('acc-accounts', 'acc', 'accounts').run();

// Ledger rows: A slash-FY, B dash-FY same serial, C dotted, D TI-style.
const seed = [
  ['inv-A', 'T/24/25/751', 'Acme Mill'],
  ['inv-B', 'T/26-27/751', 'Acme Mill'],
  ['inv-C', 'BUI.26-27.720', 'Dot Mill'],
  ['inv-D', 'BUI/TI0476/17-18', 'Old Mill'],
];
for (const [id, no, cust] of seed) {
  await db.prepare('INSERT INTO DebtorInvoice (id, invoiceNo, customerName, deleted, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, no, cust, 0, now, now).run();
}
// Attachment on B (dash-FY 751).
await db.prepare('INSERT INTO DebtorInvoiceAttachment (id, invoiceId, invoiceNo, fileName, mime, size, kvKey, source, uploadedBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .bind('att-B', 'inv-B', 'T/26-27/751', 'T_26-27_751.pdf', 'application/pdf', 4, 'inv/inv-B/b.pdf', 'bulk-zip', 'seed', now).run();
kvStore.set('inv/inv-B/b.pdf', new Uint8Array([37, 80, 68, 70]).buffer);

const call = async (path, who, init = {}) => {
  const res = await app.fetch(new Request(`http://local${path}`, {
    ...init,
    headers: { cookie: `fos_session=sess-${who}`, ...(init.headers || {}) },
  }), env, {});
  let body = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/pdf')) body = `PDF:${(await res.arrayBuffer()).byteLength}b`;
  else { try { body = await res.json(); } catch { body = await res.text(); } }
  return { status: res.status, body };
};
const post = (path, data) => call(path, 'acc', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});

let fail = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) fail++; };

// 1. plan-zip with separator variants.
const plan = await post('/api/debtors-tracker/invoices/plan-zip', { files: [
  'T-24-25-751.pdf',      // dash file vs slash-FY ledger row A
  'BUI_26_27_720.pdf',    // underscores vs dotted ledger row C
  'BUI_TI0476_17-18.pdf', // overlap hazard: must read FY 17-18, not 76-17
  'T_26-27_751.pdf',      // B already carries a PDF → skipped, never steals A
  'T-24-25-999.pdf',      // no such invoice
]});
const m = Object.fromEntries((plan.body?.matched ?? []).map((x) => [x.fileName, x.invoiceNo]));
check('slash-FY row matched via dash file', m['T-24-25-751.pdf'] === 'T/24/25/751', JSON.stringify(m));
check('dotted row matched via underscore file', m['BUI_26_27_720.pdf'] === 'BUI.26-27.720', JSON.stringify(m));
check('TI row matched (FY 17-18, not 76-17)', m['BUI_TI0476_17-18.pdf'] === 'BUI/TI0476/17-18', JSON.stringify(m));
const un = plan.body?.unmapped ?? [];
check('unknown serial unmapped with FY note', un.length === 1 && un[0].fileName === 'T-24-25-999.pdf' && un[0].note === 'FY 24-25 has no live invoice for #999', JSON.stringify(un));
check('already-attached file skipped, not re-matched', (plan.body?.skippedAlreadyAttached ?? 0) === 1, JSON.stringify({ s: plan.body?.skippedAlreadyAttached }));

// 2. survival drill: hard-delete B (reset simulation) → re-paste → re-link.
await db.prepare('DELETE FROM DebtorInvoice WHERE id = ?').bind('inv-B').run();
const tsv = 'Customer Name\tInvoice No.\nAcme Mill\tT/26-27/751\n';
const imp = await post('/api/debtors-tracker/import/debtors', { text: tsv });
check('import ok', imp.status === 200, imp.status + ' ' + JSON.stringify(imp.body?.report ?? imp.body));
check('report counts relink', imp.body?.report?.pdfsRelinked === 1, JSON.stringify(imp.body?.report));
// NOTE: fakeD1 has no column DEFAULTs; prod D1 declares deleted DEFAULT 0,
// so simulate it for the row the import just created (before first read,
// otherwise the payload cache serves the pre-fix snapshot).
await db.prepare('UPDATE DebtorInvoice SET deleted = ? WHERE invoiceNo = ?').bind(0, 'T/26-27/751').run();
const data2 = await call('/api/debtors-tracker/data', 'acc');
const invB = (data2.body?.invoices ?? []).find((i) => i.invoiceNo === 'T/26-27/751');
check('pdf re-linked on new row', !!invB?.invoicePdf?.id, JSON.stringify(invB?.invoicePdf ?? null));
if (invB?.invoicePdf?.id) {
  const f = await call(`/api/debtors-tracker/invoice-files/${invB.invoicePdf.id}`, 'acc');
  check('re-linked pdf serves bytes', f.status === 200 && f.body === 'PDF:4b', JSON.stringify(f));
}
// A untouched: still no pdf (its file was never attached).
const invA = (data.body?.invoices ?? []).find((i) => i.invoiceNo === 'T/24/25/751');
check('slash-FY row intact, no pdf yet', !!invA && !invA.invoicePdf, JSON.stringify(invA?.invoiceNo));

console.log(fail ? `\n${fail} FAILED` : '\nall matcher+relink checks passed');
process.exit(fail ? 1 : 0);
