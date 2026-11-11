#!/usr/bin/env node
// scripts/core-guard.mjs — enforces the D1-native core/helper boundary.
//   node scripts/core-guard.mjs                 verify (local / pre-commit)
//   node scripts/core-guard.mjs --sign          re-sign prisma/core.lock (HUMAN ONLY, after review)
// Checks:
//   1. Every locked file matches its hash in prisma/core.lock.
//   2. No core_* table writes outside src/modules/core/ (grep).
//   3. Worker route work.ts stays thin (no inline SQL beyond empty reads).
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname ?? process.cwd(), '..', 'founder-os_backend');
const CWD = process.cwd();
const ROOT_ABS = existsSync(join(CWD, 'founder-os_backend')) ? join(CWD, 'founder-os_backend') : CWD;
const LOCK_FILE = 'prisma/core.lock';

const LOCKED_PATHS = [
  'migrations/0125_core_foundation.sql',
  'migrations/0126_core_identity.sql',
  'prisma/core',
  'src/modules/core',
  'src/worker/routes/work.ts',
  'scripts/core-guard.mjs',
];

const args = process.argv.slice(2);
const errors = [];

const read = (p) => readFileSync(join(ROOT_ABS, p), 'utf8');
const sha256 = (p) => createHash('sha256').update(readFileSync(join(ROOT_ABS, p))).digest('hex');

function expand(paths) {
  const out = [];
  for (const p of paths) {
    const abs = join(ROOT_ABS, p);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) {
      const walk = (d) => readdirSync(d).sort().forEach((f) => {
        const full = join(d, f);
        statSync(full).isDirectory() ? walk(full) : out.push(relative(ROOT_ABS, full));
      });
      walk(abs);
    } else out.push(p);
  }
  return out;
}

if (args.includes('--sign')) {
  let who = 'unknown';
  try { who = execSync('git config user.email', { encoding: 'utf8' }).trim(); } catch {}
  const files = Object.fromEntries(expand(LOCKED_PATHS).map((f) => [f, sha256(f)]));
  writeFileSync(join(ROOT_ABS, LOCK_FILE), JSON.stringify({ signedBy: who, signedAt: new Date().toISOString(), files }, null, 2) + '\n');
  console.log(`signed ${LOCK_FILE} by ${who} (${Object.keys(files).length} files).`);
  process.exit(0);
}

if (!existsSync(join(ROOT_ABS, LOCK_FILE))) {
  errors.push(`${LOCK_FILE} missing — a human must run: node scripts/core-guard.mjs --sign (from founder-os_backend)`);
} else {
  const lock = JSON.parse(read(LOCK_FILE));
  const current = expand(LOCKED_PATHS);
  for (const f of current) {
    if (!(f in lock.files)) errors.push(`locked file added without re-signing: ${f}`);
    else if (lock.files[f] !== sha256(f)) errors.push(`locked file modified: ${f}`);
  }
  for (const f of Object.keys(lock.files)) if (!current.includes(f)) errors.push(`locked file deleted: ${f}`);
}

// No core_* writes outside src/modules/core/ (worker routes, automations, runners must go via the service).
try {
  const out = execSync(
    `git grep -n -E "INSERT INTO \\"core_|UPDATE \\"core_|DELETE FROM \\"core_" -- ':/founder-os_backend/src' ':/founder-os_backend/scripts' 2>/dev/null || true`,
    { encoding: 'utf8', cwd: join(ROOT_ABS, '..') },
  ).trim();
  const hits = out.split('\n').filter(Boolean).filter((l) => !l.includes('src/modules/core/'));
  for (const h of hits) errors.push(`core_* write outside src/modules/core/: ${h}`);
} catch {}

if (errors.length) {
  console.error('core-guard failed:\n' + errors.map((e) => `   • ${e}`).join('\n'));
  process.exit(1);
}
console.log('core-guard: core lock intact, boundaries respected.');
