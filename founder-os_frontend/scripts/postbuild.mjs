/**
 * postbuild.mjs — static-export cleanup + PWA service-worker generation.
 *
 * 1. Remove out/404.html so Cloudflare Pages enables SPA fallback (deep links
 *    like /enquiries resolve to the app shell).
 * 2. Scan out/ for built assets and emit out/sw.js with a precache manifest of
 *    the app shell, so the PWA works offline after first load.
 */
import { rm, readdir, writeFile, stat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = new URL('../out/', import.meta.url);
const OUT_PATH = fileURLToPath(OUT);

const NOT_FOUND = new URL('../out/404.html', import.meta.url);
const exists = async (p) => {
  try { await stat(p); return true; } catch (e) { if (e && e.code === 'ENOENT') return false; throw e; }
};

await rm(NOT_FOUND, { force: true });
if (await exists(NOT_FOUND)) {
  throw new Error('postbuild: out/404.html survived removal — Cloudflare Pages would disable the SPA fallback and every deep link would 404');
}
console.log('postbuild: removed out/404.html → Cloudflare Pages SPA fallback enabled');

// This build must really have produced a static export: a `next build` that
// skipped the export leaves the previous out/ in place, which is what a stale
// deploy ships.
const indexHtml = await readFile(new URL('../out/index.html', import.meta.url), 'utf8').catch(() => '');
if (!indexHtml) {
  throw new Error('postbuild: out/index.html is missing — the build did not produce a static export (check output: "export" in next.config.ts)');
}
const referenced = [...indexHtml.matchAll(/(?:src|href)="(\/_next\/[^"]+)"/g)]
  .map((m) => m[1].split('?')[0])
  .filter((v, i, a) => a.indexOf(v) === i);

// ── collect built assets (relative paths, no leading slash) ─────────────────
const ASSET_EXT = new Set(['.js', '.css', '.png', '.svg', '.ico', '.webp', '.avif', '.woff', '.woff2', '.ttf', '.webmanifest', '.txt']);
const SKIP = new Set(['sw.js', 'icons']);
const assets = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full);
    else if (ASSET_EXT.has(e.name.slice(e.name.lastIndexOf('.')))) {
      assets.push('/' + relative(OUT_PATH, full).split('\\').join('/'));
    }
  }
}
await walk(OUT_PATH);

// Everything index.html references must exist in THIS out/.
const assetSet = new Set(assets);
const missing = referenced.filter((r) => !assetSet.has(r));
if (missing.length) {
  throw new Error('postbuild: out/index.html references ' + missing.length + ' asset(s) this build did not produce — stale out/, run the prebuild clean:\n  ' + missing.join('\n  '));
}
// Exactly one webpack runtime may exist (production served two: index.html and
// sw.js came from different builds).
const runtimes = assets.filter((a) => /\/webpack-[^/]+\.js$/.test(a));
const usedRuntime = referenced.filter((r) => /\/webpack-[^/]+\.js$/.test(r));
if (runtimes.length !== 1 || usedRuntime.length !== 1 || runtimes[0] !== usedRuntime[0]) {
  throw new Error('postbuild: out/ carries ' + runtimes.length + ' webpack runtime(s) but index.html uses ' + (usedRuntime.join(', ') || 'none') + ' — mixed builds in out/');
}

const precache = [...new Set(['/', ...assets])];

// Build fingerprint: hash the PRECACHE LIST, not the clock. Every Next.js chunk
// name already embeds its content hash, so an unchanged build produces an
// identical VERSION and the browser never sees a "new" worker — no forced
// reload, no cache churn. Previously this was `Date.now()`, which meant EVERY
// build (even a no-op rebuild) handed all open tabs a new worker; combined with
// skipWaiting() + clients.claim() + the reload-on-controllerchange listener
// that was the "dashboard reloads itself" bug.
const BUILD_ID = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);

const sw = `/* PWA service worker — generated at build time by scripts/postbuild.mjs */
const VERSION = 'fos-v${BUILD_ID}';
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never intercept same-origin API / auth / live events (cookies + realtime).
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network-first, fall back to cached shell when offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || caches.match(event.request)))
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(event.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
`;

await writeFile(new URL('../out/sw.js', import.meta.url), sw, 'utf8');
console.log(`postbuild: wrote out/sw.js (precaching ${precache.length} assets)`);