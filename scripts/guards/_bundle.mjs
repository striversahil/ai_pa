// _bundle.mjs — shared esbuild helper for the Phase-0 guard suite.
//
// Bundles a TS entry to a runnable ESM file so guards can import backend /
// frontend modules without a build step (same convention as scripts/*-runner.js).
// esbuild resolution order: backend node_modules/.bin (local dev) →
// `npx -y esbuild@0.28.2` (pinned; CI runners with no install).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..');
export const BACKEND_DIR = join(REPO_ROOT, 'founder-os_backend');
export const FRONTEND_SRC = join(REPO_ROOT, 'founder-os_frontend', 'src');
const ESBUILD_PIN = 'esbuild@0.28.2';

function esbuildBin() {
  const local = join(BACKEND_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.exe' : 'esbuild');
  if (existsSync(local)) return [local];
  return ['npx', '-y', ESBUILD_PIN];
}

/** Bundle `entry` (abs path) → runnable .mjs file. Returns the bundle path.
 *  `alias` maps bare prefixes (e.g. {'@': FRONTEND_SRC}). `external` keeps
 *  bare imports bare at runtime (use with `outDir` inside the owning package
 *  so node resolves them — e.g. backend node_modules for pino, which esbuild
 *  cannot bundle: its CJS dynamic require() breaks under ESM).
 *  `define` maps identifiers to replacement expressions (values must already
 *  be stringified, e.g. { __dirname: '"/tmp"' }). */
export function bundleToFile(entry, { alias = {}, extraArgs = [], external = [], define = {}, outDir = '' } = {}) {
  const dir = outDir || mkdtempSync(join(tmpdir(), 'guard-'));
  const out = join(dir, 'bundle.mjs');
  const bin = esbuildBin();
  const args = [entry, '--bundle', '--platform=node', '--format=esm', `--outfile=${out}`, '--log-level=error'];
  for (const [find, replacement] of Object.entries(alias)) args.push(`--alias:${find}=${replacement}`);
  for (const ext of external) args.push(`--external:${ext}`);
  for (const [k, v] of Object.entries(define)) args.push(`--define:${k}=${v}`);
  args.push(...extraArgs);
  execFileSync(bin[0], [...bin.slice(1), ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  return out;
}
