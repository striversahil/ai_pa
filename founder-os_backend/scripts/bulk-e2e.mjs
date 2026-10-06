// bulk-e2e.mjs — end-to-end test of the bulk price-list pipeline against the
// REAL bundled worker + fake D1 (no LLM, no network).
// Flow: seed catalogue → paste batch → deterministic match → enrich-apply
// (PATCH, same finalize path the runner uses) → commit → block disable /
// enable / delete. Run: node scripts/bulk-e2e.mjs (after build-worker.mjs).
const app = (await import('../dist-worker/worker.js')).default;
import { fakeD1 } from './d1-mock.mjs';

const db = fakeD1();
const env = { DB: db, SHARED_SECRET: 'test-secret', WA_ENGINE_API_KEY: 'x' };

let pass = 0;
let fail = 0;
function assert(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`.slice(0, 400)); }
}

async function hit(path, opts = {}) {
  const req = new Request('http://local' + path, opts);
  const res = await app.fetch(req, env, {});
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, json, text: text.slice(0, 300) };
}

async function seed() {
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 3600_000).toISOString();
  const ins = (sql, vals) => db.prepare(sql).bind(...vals).run();
  await ins('INSERT INTO auth_user (id, email, name, picture, isRoot, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
    ['u-root', 'striversahil@gmail.com', 'Root', null, 1, now]);
  await ins('INSERT INTO auth_user (id, email, name, picture, isRoot, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
    ['u-pleb', 'pleb@example.com', 'Pleb', null, 0, now]);
  await ins('INSERT INTO auth_session (id, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)',
    ['sess-root', 'u-root', future, now]);
  await ins('INSERT INTO auth_session (id, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)',
    ['sess-pleb', 'u-pleb', future, now]);
  await ins('INSERT INTO Vendor (id, name, vendorType, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    ['v-test', 'Test Belting Co', 'Trader', 1, now, now]);
  await ins('INSERT INTO ProductItem (id, category, name, aliases, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['p-belt', 'Belts', 'V belt', '["v-belt"]', 1, now, now]);
  await ins('INSERT INTO KypGuide (id, productId, attrKey, question, sortOrder, isRequired, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ['g-type', 'p-belt', 'belt_type', 'Belt type?', 0, 1, 1, now, now]);
  await ins('INSERT INTO KypGuide (id, productId, attrKey, question, sortOrder, isRequired, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ['g-width', 'p-belt', 'width_inch', 'Width (inch)?', 1, 1, 1, now, now]);
}

const ROOT = { headers: { cookie: 'fos_session=sess-root', 'content-type': 'application/json' } };
const PLEB = { headers: { cookie: 'fos_session=sess-pleb', 'content-type': 'application/json' } };
const RUNNER = { headers: { Authorization: 'Bearer test-secret' } };

await seed();

// ── auth gates ──
{
  const r = await hit('/api/bulk-import/batches');
  assert('list without session → 401', r.status === 401, r.text);
  const r2 = await hit('/api/bulk-import/batches', PLEB);
  assert('list non-root → 403', r2.status === 403, r2.text);
  const r3 = await hit('/api/runner/bulk-import/pending');
  assert('runner pending without secret → 403', r3.status === 403, r3.text);
}

// ── paste → Step 0 + Step 1 (row 4 carries a date that must NOT parse as price) ──
const TEXT = 'V belt B-type 4inch Rs 450 per pcs\nV belt C-type 6inch Rs 620 per pcs\nDamru ball 4inch Rs 120 nos\n208 9/24/2026 PVC Belt with Cleat Length 56 feet Rs 8900 per mtr';
let batchId = '';
{
  const r = await hit('/api/bulk-import/batches', {
    ...ROOT, method: 'POST',
    body: JSON.stringify({ text: TEXT, vendorId: 'v-test', sourceName: 'e2e list' }),
  });
  assert('create batch → 201', r.status === 201, r.text);
  assert('inserted 4 rows', r.json?.inserted === 4, JSON.stringify(r.json));
  assert('deterministic resolved 2', r.json?.resolved === 2, JSON.stringify(r.json));
  batchId = r.json?.batchId ?? '';
  assert('batchId returned', !!batchId);
}

// ── staged rows ──
let rows = [];
{
  const r = await hit(`/api/bulk-import/batches/${batchId}`, ROOT);
  assert('batch detail → 200', r.status === 200, r.text);
  rows = r.json?.rows ?? [];
  assert('4 rows staged', rows.length === 4, `got ${rows.length}`);
  const belts = rows.filter((x) => x.productId === 'p-belt');
  assert('2 belt rows linked p-belt', belts.length === 2, JSON.stringify(rows.map((x) => x.status)));
  assert('belt row price regex 450', belts.some((x) => x.price === 450), JSON.stringify(belts.map((x) => x.price)));
  assert('belt row unit pcs', belts.every((x) => x.unit === 'pcs'), JSON.stringify(belts.map((x) => x.unit)));
  assert('belt rows vendor inherited', belts.every((x) => x.vendorId === 'v-test'), JSON.stringify(belts.map((x) => x.vendorId)));
  assert('belt rows needs-specs (checklist gaps)', belts.every((x) => x.status === 'needs-specs'), JSON.stringify(belts.map((x) => x.status)));
  assert('missing flags spec questions', belts.every((x) => (x.missing ?? []).some((m) => m.startsWith('spec:'))), JSON.stringify(belts[0]?.missing));
  const damru = rows.find((x) => x.rawText.startsWith('Damru'));
  assert('damru row needs-product', damru?.status === 'needs-product', JSON.stringify(damru));
  assert('unmatched row flags product gap', (damru?.missing ?? []).includes('product'), JSON.stringify(damru?.missing));
  const dated = rows.find((x) => x.rawText.startsWith('208 9/24'));
  assert('date fragment is not a price (8900, not 24)', dated?.price === 8900, JSON.stringify({ price: dated?.price }));
}

// ── runner surfaces (secret-authed) ──
{
  const r = await hit('/api/runner/bulk-import/index', RUNNER);
  assert('runner index → 200', r.status === 200, r.text);
  assert('index has p-belt + Belts', (r.json?.products ?? []).some((p) => p.id === 'p-belt') && (r.json?.categories ?? []).includes('Belts'));
  const w = await hit(`/api/runner/bulk-import/work?batch_id=${batchId}`, RUNNER);
  assert('runner work → 200', w.status === 200, w.text);
  assert('work returns unfinished rows', (w.json?.rows ?? []).length === 4, `got ${(w.json?.rows ?? []).length}`);
  const beltWork = (w.json?.rows ?? []).find((x) => x.productId === 'p-belt');
  assert('work row carries p-belt candidate', (beltWork?.candidates ?? []).some((c) => c.id === 'p-belt'), JSON.stringify(beltWork?.candidates));
}

// ── enrich-apply (same finalize path the runner POSTs through) ──
{
  const belts = rows.filter((x) => x.productId === 'p-belt');
  for (const [i, b] of belts.entries()) {
    const spec = i === 0 ? { belt_type: 'B', width_inch: '4' } : { belt_type: 'C', width_inch: '6' };
    const r = await hit(`/api/bulk-import/rows/${b.id}`, {
      ...ROOT, method: 'PATCH', body: JSON.stringify({ specs: spec }),
    });
    assert(`belt row ${i + 1} specs → ready`, r.json?.row?.status === 'ready', JSON.stringify(r.json?.row));
  }
  const damru = rows.find((x) => x.rawText.startsWith('Damru'));
  const r = await hit(`/api/bulk-import/rows/${damru.id}`, {
    ...ROOT, method: 'PATCH',
    body: JSON.stringify({ isNewProduct: true, newCategory: 'Belts', productName: 'Damru ball' }),
  });
  assert('damru new-product draft → ready (commercials regex-filled)', r.json?.row?.status === 'ready', JSON.stringify(r.json?.row));
  const dated = rows.find((x) => x.rawText.startsWith('208 9/24'));
  const r2 = await hit(`/api/bulk-import/rows/${dated.id}`, {
    ...ROOT, method: 'PATCH',
    body: JSON.stringify({ isNewProduct: true, newCategory: 'Belts', productName: 'PVC Belt with Cleat' }),
  });
  assert('dated row new-product draft → ready', r2.json?.row?.status === 'ready', JSON.stringify(r2.json?.row));
}

// ── bulk-patch primitive ("all belts are V-type" style) ──
{
  const r = await hit(`/api/bulk-import/batches/${batchId}/bulk-patch`, {
    ...ROOT, method: 'POST',
    body: JSON.stringify({ filter: { productId: 'p-belt' }, patch: { discount: 5 } }),
  });
  assert('bulk-patch 2 belt rows', r.json?.updated === 2, JSON.stringify(r.json));
}

// ── commit ──
{
  const r = await hit(`/api/bulk-import/batches/${batchId}/commit`, { ...ROOT, method: 'POST', body: '{}' });
  assert('commit → 200', r.status === 200, r.text);
  assert('committed 4', r.json?.committed === 4, JSON.stringify(r.json));
  assert('skipped none', (r.json?.skippedIncomplete ?? []).length === 0, JSON.stringify(r.json?.skippedIncomplete));
  const d = await hit(`/api/product-line/products/p-belt`);
  const rates = d.json?.rates ?? [];
  assert('p-belt has 2 live rates', rates.length === 2, `got ${rates.length}`);
  assert('rates stamped batchId', rates.every((x) => x.batchId === batchId), JSON.stringify(rates.map((x) => x.batchId)));
  assert('rates stamped sourceRef', rates.every((x) => String(x.sourceRef ?? '').startsWith(`bulk:${batchId}:row-`)), JSON.stringify(rates.map((x) => x.sourceRef)));
}

// ── block disable / enable ──
{
  const off = await hit(`/api/bulk-import/batches/${batchId}/block`, { ...ROOT, method: 'POST', body: JSON.stringify({ disabled: true }) });
  assert('block disable → 4 rates', off.json?.rates === 4, JSON.stringify(off.json));
  const d = await hit(`/api/product-line/products/p-belt`);
  assert('rates hidden (active=false)', (d.json?.rates ?? []).every((x) => x.active === false));
  const on = await hit(`/api/bulk-import/batches/${batchId}/block`, { ...ROOT, method: 'POST', body: JSON.stringify({ disabled: false }) });
  assert('block enable → 4 rates', on.json?.rates === 4, JSON.stringify(on.json));
  const d2 = await hit(`/api/product-line/products/p-belt`);
  assert('rates restored (active=true)', (d2.json?.rates ?? []).every((x) => x.active === true));
}

// ── block delete ──
{
  const del = await hit(`/api/bulk-import/batches/${batchId}`, { ...ROOT, method: 'DELETE' });
  assert('block delete → 4 rates wiped', del.json?.rates === 4, JSON.stringify(del.json));
  const d = await hit(`/api/product-line/products/p-belt`);
  assert('p-belt rates gone', (d.json?.rates ?? []).length === 0, `got ${(d.json?.rates ?? []).length}`);
  const l = await hit('/api/bulk-import/batches', ROOT);
  assert('batch record kept as audit trail', (l.json?.batches ?? []).some((b) => b.id === batchId), JSON.stringify((l.json?.batches ?? []).map((b) => b.id)));
}

console.log(`\nbulk-e2e: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
