// route-parity.mjs — snapshot EVERY parameter-free GET route of the bundled
// worker (fake D1, auth enabled) as anonymous + seeded root, for refactor
// parity: run on the old and new build, then compare.
//   node scripts/route-parity.mjs snapshot <dir> [bundlePath]
//   node scripts/route-parity.mjs compare <dirA> <dirB>
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const [mode, a, b] = process.argv.slice(2);
const norm = (t) => t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ts>')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
  .replace(/\b\d{1,2}:\d{2}:\d{2}\s?(am|pm)\b/gi, '<clock>').replace(/\b1[789]\d{11}\b/g, '<ms>').replace(/"(ms|latencyMs|durationMs|elapsedMs|tookMs)":\d+/g, '"$1":<n>');
function routes() {
  const dir = join(HERE, '..', 'src', 'worker', 'routes');
  const out = new Set();
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (p.endsWith('.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/app\.get\(\s*'([^']+)'/g)) if (!m[1].includes(':') && !m[1].includes('*')) out.add(m[1]); } };
  walk(dir);
  return [...out].filter((r) => !/\/(events|sse|stream)\b/.test(r)).sort();
}
if (mode === 'snapshot') {
  mkdirSync(a, { recursive: true });
  const app = (await import(pathToFileURL(b ?? join(HERE, '..', 'dist-worker', 'worker.js')).href)).default;
  const { fakeD1 } = await import('./d1-mock.mjs');
  const db = fakeD1();
  const env = { DB: db, SHARED_SECRET: 's', GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', AUTH_PUBLIC_ORIGIN: 'https://example.test' };
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO auth_user (id, email, name, picture, isRoot, createdAt) VALUES (?, ?, ?, ?, ?, ?)').bind('root', 'root@example.test', 'root', null, 1, now).run();
  await db.prepare('INSERT INTO auth_session (id, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)').bind('sess-root', 'root', new Date(Date.now() + 36e5).toISOString(), now).run();
  const list = routes();
  for (const who of ['anon', 'root']) for (const r of list) {
    let line;
    try {
      const res = await Promise.race([
        app.fetch(new Request(`http://local${r}`, { headers: who === 'root' ? { cookie: 'fos_session=sess-root' } : {} }), env, { waitUntil() {} }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ]);
      line = `${res.status}\n${norm(await res.text()).slice(0, 4000)}`;
    } catch (e) { line = `ERR ${String(e?.message ?? e).slice(0, 200)}`; }
    writeFileSync(join(a, `${who}${r.replace(/[^a-z0-9]+/gi, '_')}.txt`), line);
  }
  console.log(`route snapshot: ${list.length} routes × 2 viewers → ${a}`);
} else if (mode === 'compare') {
  let d = 0; const fs = readdirSync(a);
  for (const f of fs) { let x = readFileSync(join(a, f), 'utf8'), y; try { y = readFileSync(join(b, f), 'utf8'); } catch { y = '<missing>'; } if (x !== y) { d++; console.log(`DIFF ${f}\n  A: ${x.slice(0, 150).replace(/\n/g, ' | ')}\n  B: ${y.slice(0, 150).replace(/\n/g, ' | ')}`); } }
  console.log(d ? `${d}/${fs.length} differ` : `route parity ok: ${fs.length}/${fs.length} identical`);
  process.exit(d ? 1 : 0);
}
