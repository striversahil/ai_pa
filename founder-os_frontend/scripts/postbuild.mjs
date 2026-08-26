/**
 * postbuild.mjs — static-export cleanup for clean-path routing.
 *
 * Next.js emits a 404.html, which tells Cloudflare Pages "this is a classic
 * multi-page site" and DISABLES its automatic SPA fallback. Removing it makes
 * Pages serve index.html for any path without a real file, so deep links like
 * /enquiries or /briefing resolve to the app shell (the History-API router
 * picks the view from location.pathname).
 */
import { rm } from 'node:fs/promises';

await rm(new URL('../out/404.html', import.meta.url), { force: true });
console.log('postbuild: removed out/404.html → Cloudflare Pages SPA fallback enabled');
