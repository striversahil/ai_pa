/**
 * prebuild.mjs — every build starts from a pristine out/.
 *
 * Next writes the static export into out/ and leaves files it did not write,
 * so a second build in the same tree mixes two builds. Production ended up
 * with two webpack runtimes, a stale sw.js and a 404.html — which turned off
 * the Cloudflare Pages SPA fallback and 404ed every deep link on refresh.
 */
import { rm } from 'node:fs/promises';

await rm(new URL('../out/', import.meta.url), { recursive: true, force: true });
console.log('prebuild: cleared out/');
