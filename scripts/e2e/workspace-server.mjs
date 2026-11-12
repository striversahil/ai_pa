// UI e2e for /session + /automations: serves founder-os_frontend/out (SPA fallback)
// and proxies /api to the bundled worker (fake D1, auth on, seeded users).
// Usage (after build-worker + frontend build):
//   node scripts/e2e/workspace-server.mjs & python3 scripts/e2e/workspace-ui.py
// Serves founder-os_frontend/out (SPA fallback) + proxies /api,/health to the
// bundled worker with a fake D1 (auth enabled, seeded users).
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const BE = join(ROOT, 'founder-os_backend');
const OUT = join(ROOT, 'founder-os_frontend', 'out');
const app = (await import(`${BE}/dist-worker/worker.js`)).default;
const { fakeD1 } = await import(`${BE}/scripts/d1-mock.mjs`);
const db = fakeD1();
const env = { DB: db, SHARED_SECRET: 's', GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', AUTH_PUBLIC_ORIGIN: 'http://127.0.0.1:8899' };
const future = new Date(Date.now() + 36e5).toISOString(), now = new Date().toISOString();
async function seed(id, scopes, isRoot = 0) {
  await db.prepare('INSERT INTO auth_user (id, email, name, picture, isRoot, createdAt) VALUES (?, ?, ?, ?, ?, ?)').bind(id, `${id}@example.test`, id, null, isRoot, now).run();
  await db.prepare('INSERT INTO auth_session (id, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)').bind(`sess-${id}`, id, future, now).run();
  for (const s of scopes) await db.prepare('INSERT INTO auth_user_scope (id, userId, scopeKey) VALUES (?, ?, ?)').bind(`${id}-${s}`, id, s).run();
}
await seed('root', [], 1); await seed('stockkeeper', ['stock']); await seed('accountant', ['accounts']); await seed('nobody', []);
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8899');
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/health')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await app.fetch(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env, { waitUntil() {} });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let f = join(OUT, url.pathname);
  if (!existsSync(f) || statSync(f).isDirectory()) f = existsSync(f + '.html') ? f + '.html' : join(OUT, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f));
}).listen(8899, () => console.log('e2e server on 8899'));
