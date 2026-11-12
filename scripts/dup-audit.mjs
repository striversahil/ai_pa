#!/usr/bin/env node
// dup-audit.mjs — measure duplication + boundary violations in the ai_pa repo.
//
// Zero dependencies (Node >= 18). Run from the repo root or pass the root path.
//
//   node dup-audit.mjs [repoRoot]                    human-readable report
//   node dup-audit.mjs [repoRoot] --json             machine-readable metrics
//   node dup-audit.mjs [repoRoot] --write-baseline F  save current counts to F
//   node dup-audit.mjs [repoRoot] --check F           exit 1 if ANY metric grew vs F
//   node dup-audit.mjs [repoRoot] --where METRIC      list every hit for one metric
//
// The --check mode is a RATCHET: counts may only stay flat or go down. Every
// cleanup commit should lower at least one number; re-run --write-baseline
// after a cleanup lands so the floor moves with it.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? true);
};
const root = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) ?? process.cwd();

const FE = join(root, 'founder-os_frontend', 'src');
const BE = join(root, 'founder-os_backend', 'src');
if (!existsSync(FE) || !existsSync(BE)) {
  console.error(`dup-audit: ${root} does not look like the ai_pa repo (missing founder-os_frontend/src or founder-os_backend/src)`);
  process.exit(2);
}

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const rel = (f) => relative(root, f).split(sep).join('/');
const feFiles = walk(FE, ['.ts', '.tsx']);
const beFiles = walk(BE, ['.ts']).filter((f) => !rel(f).includes('/durable/'));
const read = (f) => readFileSync(f, 'utf8');
const cache = new Map();
const src = (f) => { if (!cache.has(f)) cache.set(f, read(f)); return cache.get(f); };

// A metric = files to scan + regex + files that are ALLOWED to contain the
// pattern (the canonical home). Hits in allowed files are not counted.
const METRICS = [
  {
    key: 'fe.raw_fetch_api',
    why: 'Components call fetch("/api/...") directly instead of a domain api.ts module',
    files: feFiles,
    re: /fetch\(\s*[`"']\/api\//g,
    allow: (p) => /\/api\.ts$/.test(p) || p.includes('/src/api/') || p.includes('/src/workspaces/'),
  },
  {
    key: 'fe.hardcoded_automation_data_url',
    why: 'Dashboards hardcode /api/automations/<slug>/data, so they cannot be reused by /session',
    files: feFiles,
    re: /\/api\/automations\/[^"'`\s]*\/data/g,
    allow: (p) => p.includes('/src/workspaces/'),
  },
  {
    key: 'fe.hardcoded_automations_nav',
    why: 'Components navigate to "/automations/..." themselves instead of using the workspace host',
    files: feFiles,
    re: /["'`]#?\/automations(\/|["'`])/g,
    allow: (p) => p.includes('/src/workspaces/') || p.includes('/src/views/') || p.endsWith('/layout/nav.tsx') || p.endsWith('/hooks/useHashRoute.ts'),
  },
  {
    key: 'fe.local_inr_formatter',
    why: 'Rupee formatter re-implemented locally instead of imported from src/lib/format.ts',
    files: feFiles,
    re: /(?:function|const)\s+(?:inr|fmtInr|fmtINR|formatInr|formatINR|formatCurrency|fmtMoney)\b/g,
    allow: (p) => p.endsWith('/src/lib/format.ts'),
  },
  {
    key: 'fe.local_date_formatter',
    why: 'Date/time formatter re-implemented locally instead of imported from src/lib/format.ts',
    files: feFiles,
    re: /(?:function|const)\s+(?:fmtDate|formatDate|fmtDay|fmtTime|formatTime|timeAgo|relTime)\b/g,
    allow: (p) => p.endsWith('/src/lib/format.ts'),
  },
  {
    key: 'fe.adhoc_modal_overlay',
    why: 'Hand-rolled "fixed inset-0" overlays instead of components/ui Modal/Drawer',
    files: feFiles,
    re: /fixed inset-0/g,
    allow: (p) => p.includes('/components/ui/') || p.endsWith('/components/Modal.tsx'),
  },
  {
    key: 'fe.slug_alias_literal',
    why: 'Legacy slug aliases (payment-tracker, enquiry-tracker → sales …) spelled out outside the catalog',
    files: feFiles,
    re: /["'](?:payment-tracker)["']|selected === "(?:telecalling|enquiry-tracker|master-data)"|slug === "(?:telecalling|enquiry-tracker|master-data)"/g,
    allow: (p) => p.includes('/src/workspaces/'),
  },
  {
    key: 'be.getme_boilerplate',
    why: 'getMe(authStore(c), readSessionCookie(...)) repeated per handler instead of the viewer middleware',
    files: beFiles,
    re: /getMe\(\s*authStore\(c\)\s*,\s*readSessionCookie\(/g,
    allow: (p) => p.endsWith('/src/worker/viewer.ts'),
  },
  {
    key: 'be.autherror_catch_boilerplate',
    why: 'try/catch AuthError → c.json blocks repeated instead of one onError handler',
    files: beFiles,
    re: /instanceof AuthError\)\s*return c\.json/g,
    allow: (p) => p.endsWith('/src/worker/http.ts'),
  },
  {
    key: 'be.json_body_catch',
    why: 'c.req.json().catch(() => ({})) repeated instead of readBody(c)',
    files: beFiles,
    re: /c\.req\.json\(\)\.catch\(/g,
    allow: (p) => p.endsWith('/src/worker/http.ts'),
  },
  {
    key: 'be.local_parse_json',
    why: 'Private parseJson() helpers instead of one shared safe parser',
    files: beFiles,
    re: /function parseJson\(/g,
    allow: (p) => p.endsWith('/src/shared/json.ts'),
  },
  {
    key: 'be.local_ist_helper',
    why: 'IST date helpers re-implemented instead of src/shared/ist-time.ts',
    files: beFiles,
    re: /(?:function|const)\s+(?:istDate|istToday|kolkataDate\w*|todayIst|istDateStr|istNow|kolkataDateStr)\b/g,
    allow: (p) => p.endsWith('/src/shared/ist-time.ts'),
  },
  {
    key: 'be.slug_branch_in_route',
    why: "Per-slug if (slug === '...') branches inside a route handler (belongs in workspaces/scoping.ts)",
    files: beFiles.filter((f) => rel(f).includes('/src/worker/routes/')),
    re: /(?:slug|param\('slug'\))\s*===\s*'[a-z0-9-]+'/g,
    allow: () => false,
  },
  {
    key: 'be.slug_alias_literal',
    why: 'Legacy slug aliases spelled out outside the workspace catalog',
    files: beFiles,
    re: /'payment-tracker'/g,
    allow: (p) => p.includes('/src/modules/workspaces/'),
  },
];

function countMetric(m) {
  const hits = [];
  for (const f of m.files) {
    const p = rel(f);
    if (m.allow(p)) continue;
    const text = src(f);
    m.re.lastIndex = 0;
    let match;
    while ((match = m.re.exec(text))) {
      const line = text.slice(0, match.index).split('\n').length;
      hits.push(`${p}:${line}`);
    }
  }
  return hits;
}

// Structural metrics (not regex based).
function oversized(files, limit) {
  return files
    .map((f) => ({ p: rel(f), n: src(f).split('\n').length }))
    .filter((x) => x.n > limit)
    .sort((a, b) => b.n - a.n);
}

function automationsRouteForeignEndpoints() {
  const f = join(BE, 'worker', 'routes', 'automations.ts');
  if (!existsSync(f)) return [];
  const text = src(f);
  const out = [];
  const re = /app\.(?:get|post|put|patch|delete)\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(text))) if (!m[1].startsWith('/api/automations')) out.push(`${rel(f)} → ${m[1]}`);
  return out;
}

function sessionRouteLeaks() {
  // /api/session handlers must not touch the automation registry admin surface.
  const f = join(BE, 'worker', 'routes', 'session.ts');
  if (!existsSync(f)) return [];
  const text = src(f);
  const out = [];
  for (const bad of ['AutomationEngine.setEnabled', 'prisma.automation.update', "'/api/automations"]) {
    if (text.includes(bad)) out.push(`${rel(f)} uses ${bad}`);
  }
  return out;
}

const results = {};
const details = {};
for (const m of METRICS) {
  const hits = countMetric(m);
  results[m.key] = hits.length;
  details[m.key] = hits;
}
const feBig = oversized(feFiles, 400);
const beBig = oversized(beFiles.filter((f) => !rel(f).endsWith('/shared/d1-prisma.ts')), 400);
results['fe.files_over_400_lines'] = feBig.length;
details['fe.files_over_400_lines'] = feBig.map((x) => `${x.p} (${x.n})`);
results['be.files_over_400_lines'] = beBig.length;
details['be.files_over_400_lines'] = beBig.map((x) => `${x.p} (${x.n})`);
const foreign = automationsRouteForeignEndpoints();
results['be.non_registry_routes_in_automations_ts'] = foreign.length;
details['be.non_registry_routes_in_automations_ts'] = foreign;
const leaks = sessionRouteLeaks();
results['be.session_route_registry_leaks'] = leaks.length;
details['be.session_route_registry_leaks'] = leaks;

const why = Object.fromEntries(METRICS.map((m) => [m.key, m.why]));
why['fe.files_over_400_lines'] = 'Frontend files above the 400-line split threshold (AGENTS.md)';
why['be.files_over_400_lines'] = 'Backend files above the 400-line split threshold (AGENTS.md)';
why['be.non_registry_routes_in_automations_ts'] = 'Endpoints in worker/routes/automations.ts that are not /api/automations/*';
why['be.session_route_registry_leaks'] = '/api/session code reaching into the automation registry admin surface';

const where = flag('--where');
if (where) {
  if (!(where in details)) { console.error(`unknown metric ${where}. Known: ${Object.keys(details).join(', ')}`); process.exit(2); }
  for (const h of details[where]) console.log(h);
  process.exit(0);
}

const baselineOut = flag('--write-baseline');
if (baselineOut) {
  writeFileSync(baselineOut, JSON.stringify({ generatedAt: new Date().toISOString(), metrics: results }, null, 2) + '\n');
  console.log(`baseline written → ${baselineOut}`);
  process.exit(0);
}

const checkFile = flag('--check');
if (checkFile) {
  const base = JSON.parse(readFileSync(checkFile, 'utf8')).metrics ?? {};
  const regressions = Object.entries(results).filter(([k, v]) => k in base && v > base[k]);
  const improved = Object.entries(results).filter(([k, v]) => k in base && v < base[k]);
  for (const [k, v] of improved) console.log(`✓ ${k}: ${base[k]} → ${v}`);
  if (regressions.length) {
    for (const [k, v] of regressions) {
      console.error(`✗ ${k}: ${base[k]} → ${v}  (${why[k]})`);
      console.error(`  run: node dup-audit.mjs --where ${k}`);
    }
    process.exit(1);
  }
  console.log(`ratchet ok (${Object.keys(base).length} metrics, none grew)`);
  process.exit(0);
}

if (args.includes('--json')) {
  console.log(JSON.stringify({ metrics: results, details }, null, 2));
  process.exit(0);
}

const pad = Math.max(...Object.keys(results).map((k) => k.length));
console.log(`dup-audit — ${root}\n`);
for (const [k, v] of Object.entries(results)) {
  console.log(`${k.padEnd(pad)}  ${String(v).padStart(4)}   ${why[k]}`);
}
console.log('\nTop offenders (use --where <metric> for the full list):');
for (const k of ['fe.files_over_400_lines', 'be.files_over_400_lines']) {
  console.log(`  ${k}: ${details[k].slice(0, 5).join(', ')}`);
}
