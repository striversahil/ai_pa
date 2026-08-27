/**
 * postbuild.mjs — static-export cleanup + PWA service-worker generation.
 *
 * 1. Remove out/404.html so Cloudflare Pages enables SPA fallback (deep links
 *    like /enquiries resolve to the app shell).
 * 2. Scan out/ for built assets and emit out/sw.js with a precache manifest of
 *    the app shell, so the PWA works offline after first load.
 */
import { rm, readdir, writeFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = new URL('../out/', import.meta.url);
const OUT_PATH = fileURLToPath(OUT);

await rm(new URL('../out/404.html', import.meta.url), { force: true });
console.log('postbuild: removed out/404.html → Cloudflare Pages SPA fallback enabled');

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

const precache = [...new Set(['/', ...assets])];

const sw = `/* PWA service worker — generated at build time by scripts/postbuild.mjs */
const VERSION = 'fos-v${Date.now()}';
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