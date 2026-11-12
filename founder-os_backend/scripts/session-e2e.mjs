// session-e2e.mjs — /api/session against the bundled worker with REAL signed-in
// viewers (auth enabled, sessions seeded into the fake D1). No network/LLM.
// Run after build-worker: node scripts/session-e2e.mjs   (exit 1 on failure)
import { fakeD1 } from './d1-mock.mjs';
const app = (await import('../dist-worker/worker.js')).default;

const db = fakeD1();
const env = {
  DB: db, SHARED_SECRET: 'test-secret',
  GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', AUTH_PUBLIC_ORIGIN: 'https://example.test',
};
const future = new Date(Date.now() + 3600_000).toISOString();
const now = new Date().toISOString();
async function seed(id, scopes, { isRoot = 0 } = {}) {
  await db.prepare('INSERT INTO auth_user (id, email, name, picture, isRoot, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, `${id}@example.test`, id, null, isRoot, now).run();
  await db.prepare('INSERT INTO auth_session (id, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)')
    .bind(`sess-${id}`, id, future, now).run();
  for (const s of scopes) {
    await db.prepare('INSERT INTO auth_user_scope (id, userId, scopeKey) VALUES (?, ?, ?)').bind(`${id}-${s}`, id, s).run();
  }
}
await seed('root', [], { isRoot: 1 });
await seed('stockkeeper', ['stock']);
await seed('accountant', ['accounts']);
await seed('nobody', []);

const call = async (path, who) => {
  const headers = who ? { cookie: `fos_session=sess-${who}` } : {};
  const res = await app.fetch(new Request(`http://local${path}`, { headers }), env, {});
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};

let fail = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) fail++; };
const slugs = (b) => (Array.isArray(b) ? b.map((w) => w.slug).sort() : null);

// Prime the registry so Automation rows exist (registry-boot path).
await call('/api/automations', 'root');

let r = await call('/api/session');
check('GET /api/session anonymous → 401', r.status === 401);
r = await call('/api/session', 'stockkeeper');
check('GET /api/session signed-in → 200 + user', r.status === 200 && r.body?.user?.id === 'stockkeeper' && r.body.isAdmin === false, JSON.stringify(slugs(r.body?.workspaces)));
check('stockkeeper sees only stock', JSON.stringify(slugs(r.body?.workspaces)) === '["stock"]');

r = await call('/api/session/workspaces', 'accountant');
check('accountant sees accounts + debtors-tracker (legacy accounts scope)', JSON.stringify(slugs(r.body)) === '["accounts","debtors-tracker"]', JSON.stringify(slugs(r.body)));
r = await call('/api/session/workspaces', 'nobody');
check('no-grant user sees nothing', r.status === 200 && Array.isArray(r.body) && r.body.length === 0);
r = await call('/api/session/workspaces', 'root');
const rootSlugs = slugs(r.body) ?? [];
check('root sees every dashboard workspace, no headless/aliases', rootSlugs.length > 5 && !rootSlugs.includes('telecalling') && !rootSlugs.includes('payment-tracker') && !rootSlugs.includes('master-data'), `${rootSlugs.length} workspaces`);

// Non-admin list must equal the dashboard subset of the legacy non-admin GET /api/automations.
for (const who of ['stockkeeper', 'accountant', 'nobody']) {
  const legacy = await call('/api/automations', who);
  const want = (legacy.body ?? []).filter((a) => a.hasDashboard && a.slug !== 'payment-tracker').map((a) => a.slug).sort();
  const got = slugs((await call('/api/session/workspaces', who)).body);
  check(`${who}: session list == legacy dashboard list`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
}

// Data endpoint: same result on both paths for signed-in viewers.
for (const [who, slug] of [['accountant', 'debtors-tracker'], ['stockkeeper', 'debtors-tracker'], ['accountant', 'accounts'], ['root', 'stock'], ['nobody', 'master-data']]) {
  const a = await call(`/api/automations/${slug}/data`, who);
  const b = await call(`/api/session/workspaces/${slug}/data`, who);
  const norm = (x) => JSON.stringify(x.body).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '').replace(/\d{1,2}:\d{2}:\d{2}\s?(am|pm)/gi, '');
  check(`${who} ${slug}: old == new (${a.status})`, a.status === b.status && norm(a) === norm(b), a.status !== b.status ? `${a.status} vs ${b.status}` : '');
}
r = await call('/api/session/workspaces/debtors-tracker/data', 'stockkeeper');
check('debtors-tracker refused without scope (403)', r.status === 403);
r = await call('/api/session/workspaces/master-data/data', 'nobody');
check('master-data refused without grant (403)', r.status === 403);
r = await call('/api/session/workspaces/stock/data');
check('non-public workspace data needs a session (401)', r.status === 401);
r = await call('/api/session/workspaces/telecalling/data');
check('telecalling data stays public (founder decision)', r.status === 200);
r = await call('/api/session/workspaces/neodove-telecaller-report/data');
check('NeoDove report data stays public (founder decision)', r.status === 200 || r.status === 404, String(r.status));

console.log(fail ? `\n${fail} FAILED` : '\nall session checks passed');
process.exit(fail ? 1 : 0);
