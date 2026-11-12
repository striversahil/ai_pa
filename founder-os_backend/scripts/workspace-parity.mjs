// workspace-parity.mjs — snapshot the workspace data endpoints of the bundled
// worker (fake D1, no LLM) so a refactor can prove byte-identical output.
//
//   node scripts/workspace-parity.mjs snapshot <dir> [pathPrefix]
//   node scripts/workspace-parity.mjs compare <dirA> <dirB>
//
// pathPrefix defaults to /api/automations (the legacy route); pass
// /api/session/workspaces to snapshot the new route with the same cases.
// Two auth modes per case: auth disabled (no Google config → open) and auth
// enabled (Google config present, no cookie → gate + AUTH_EXEMPT apply).
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [mode, a, b] = process.argv.slice(2);

const SLUGS = [
  'zoho-sent-analyzer', 'dpp-prices-dashboard', 'wa-engine-monitor', 'whatsapp-marketing',
  'neodove-telecaller-report', 'sales', 'accounts', 'digital-marketing', 'human-resources',
  'debtors-tracker', 'payment-tracker', 'whatsapp-autopilot', 'enquiry-procurement',
  'enquiry-management', 'reporting-sheet', 'crm', 'product-line', 'stock', 'samarth-overview',
  'sahil-overview', 'linkedin', 'ai-usage', 'telecalling-agent-analysis',
  // headless providers + unknown
  'telecalling', 'master-data', 'does-not-exist',
];
const EXTRA = [
  'telecalling/data?selfAgentId=evil',
  'telecalling/data?converters=1',
  'accounts/data?as=someone',
  'digital-marketing/data?as=someone',
];

function normalize(text) {
  // Strip volatile timestamps so two runs of the same code compare equal.
  return text
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ts>')
    .replace(/"(generatedAt|computedAt|asOf|now|fetchedAt|updatedAt|createdAt)":\s*\d{10,}/g, '"$1":<n>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/\b\d{1,2}:\d{2}:\d{2}\s?(am|pm)\b/gi, '<clock>');
}

async function snapshot(dir, prefix = '/api/automations') {
  mkdirSync(dir, { recursive: true });
  const app = (await import('../dist-worker/worker.js')).default;
  const { fakeD1 } = await import('./d1-mock.mjs');
  const cases = [...SLUGS.map((s) => `${s}/data`), ...EXTRA];
  for (const authOn of [false, true]) {
    const env = { DB: fakeD1(), SHARED_SECRET: 'test-secret' };
    if (authOn) Object.assign(env, { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', AUTH_PUBLIC_ORIGIN: 'https://example.test' });
    for (const cse of cases) {
      const res = await app.fetch(new Request(`http://local${prefix}/${cse}`), env, {});
      const body = normalize(await res.text());
      const name = `${authOn ? 'auth' : 'open'}__${cse.replace(/[^a-z0-9]+/gi, '_')}.txt`;
      writeFileSync(join(dir, name), `${res.status}\n${body}\n`);
    }
  }
  console.log(`snapshot: ${cases.length * 2} cases → ${dir}`);
}

function compare(da, db) {
  const files = readdirSync(da).sort();
  let diffs = 0;
  for (const f of files) {
    let x = '', y = '';
    try { x = readFileSync(join(da, f), 'utf8'); y = readFileSync(join(db, f), 'utf8'); } catch { y = '<missing>'; }
    if (x !== y) {
      diffs++;
      console.log(`DIFF ${f}\n  A: ${x.slice(0, 160).replace(/\n/g, ' | ')}\n  B: ${y.slice(0, 160).replace(/\n/g, ' | ')}`);
    }
  }
  console.log(diffs ? `${diffs}/${files.length} cases differ` : `parity ok: ${files.length}/${files.length} identical`);
  process.exit(diffs ? 1 : 0);
}

if (mode === 'snapshot') await snapshot(a, b);
else if (mode === 'compare') compare(a, b);
else { console.error('usage: snapshot <dir> [prefix] | compare <dirA> <dirB>'); process.exit(2); }
