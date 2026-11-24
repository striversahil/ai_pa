// notifications-dashboard.test.mjs — Guards for the 2026-11-24 notification
// dashboard pass.
//
// Locks:
//   1. the bell crash class (no hook may run AFTER an early return);
//   2. Test = dry run (nothing sent) vs Run now = real dispatch;
//   3. collapsed-view filters + per-position live/paused summary;
//   4. real result headers → template tokens (BE ↔ FE mirror);
//   5. the AI prompt's contract + the live-schema table selection;
//   6. the dashboard being its OWN surface (nav view, not a Settings tab);
//   7. the seeded real rule (DeviceCall hourly) surviving in a migration.
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BACKEND_DIR, FRONTEND_SRC, bundleToFile } from './_bundle.mjs';

const read = (p) => readFileSync(p, 'utf8');
const be = (p) => read(join(BACKEND_DIR, p));
const fe = (p) => read(join(FRONTEND_SRC, p));
const withAlias = (rel) => bundleToFile(join(FRONTEND_SRC, rel), { alias: { '@': FRONTEND_SRC } });

const columns = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src/modules/notifications/columns.ts'))).href);
const prompt = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src/modules/notifications/prompt.ts'))).href);
const catalog = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src/modules/notifications/schema-catalog.ts'))).href);
const metricSql = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src/modules/notifications/metric-sql.ts'))).href);
const feHelpers = await import(pathToFileURL(withAlias('notifications/helpers.ts')).href);

describe('bell panel: hook order', () => {
  it('never calls a hook after the open/closed early return', () => {
    // The bug: `if (!panelOpen) return null` followed by useMemo → opening the
    // panel threw "Rendered more hooks than during the previous render", which
    // escaped to Next's "This page couldn't load" screen.
    const src = fe('components/notifications/NotificationDrawer.tsx');
    const early = src.indexOf('if (!panelOpen) return null');
    assert.ok(early > 0, 'the early return must exist');
    for (const hook of ['useMemo(', 'useState(', 'useEffect(', 'useCallback(']) {
      const first = src.indexOf(hook);
      if (first === -1) continue;
      assert.ok(first < early, `${hook} must run before the early return`);
    }
  });

  it('keeps the overlay inside an error boundary', () => {
    const page = fe('app/page.tsx');
    assert.match(page, /<ErrorBoundary>\s*<NotificationOverlay \/>\s*<\/ErrorBoundary>/);
  });
});

describe('test vs run', () => {
  const engine = be('src/modules/notifications/engine.ts');

  it('Test (dry run) returns before any dispatch', () => {
    const dry = engine.indexOf('if (dryRun) {');
    const notify = engine.indexOf('notifyUsers(');
    assert.ok(dry > 0 && notify > 0, 'both branches must exist');
    assert.ok(dry < notify, 'the dry-run branch must short-circuit before notifyUsers');
  });

  it('the test route is dry, the run route is not', () => {
    const routes = be('src/worker/routes/notifications.ts');
    assert.match(routes, /\/test'[\s\S]{0,2000}dryRun: true/);
    assert.match(routes, /\/run'[\s\S]{0,900}evaluateRule\(db, rule, \{[\s\S]{0,200}align: false/);
    assert.doesNotMatch(routes, /\/run'[\s\S]{0,600}dryRun: true/);
  });

  it('returns the real headers so the UI can offer tokens', () => {
    assert.match(engine, /result\.columns = resultColumns\(rows\)/);
    assert.match(engine, /dryRun,/);
  });
});

describe('result columns → tokens', () => {
  it('reads headers in SQL order, across rows', () => {
    const rows = [{ telecaller_id: 'a', hourly_connected_call: 1 }, { telecaller_id: 'b', attempted_calls: 3 }];
    assert.deepEqual(columns.resultColumns(rows), ['telecaller_id', 'hourly_connected_call', 'attempted_calls']);
    assert.deepEqual(columns.resultColumns([]), []);
  });

  it('hides engine plumbing from the token list', () => {
    const cols = ['telecaller_id', 'employee_key', 'level', 'attempted_calls', 'value'];
    assert.deepEqual(columns.messageColumns(cols), ['attempted_calls', 'value']);
  });

  it('mirrors columnToken on the frontend', () => {
    for (const raw of ['hourly_connected_call', 'Attempted Calls', 'a-b.c', '  x  ']) {
      assert.equal(feHelpers.columnToken(raw), columns.columnToken(raw), raw);
    }
    assert.equal(columns.columnToken('hourly_connected_call'), 'HOURLY_CONNECTED_CALL');
  });
});

describe('collapsed-view filters', () => {
  const rule = (over) => ({
    key: 'k', name: 'n', description: '', enabled: true,
    audience: { positions: ['Telecaller'] }, sqlText: '', titleTpl: '', bodyTpl: '',
    cadence: { kind: 'hourly' }, thresholds: [], escalation: {},
    nextDueAt: null, lastRunAt: null, lastStatus: null, ...over,
  });
  const rules = [
    rule({ key: 'a', name: 'Alpha', enabled: true }),
    rule({ key: 'b', name: 'Beta', enabled: false }),
    rule({ key: 'c', name: 'Gamma', enabled: true, audience: { positions: ['Team Lead'] } }),
    rule({ key: 'd', name: 'Delta', enabled: false, audience: {} }),
  ];

  it('summarises live/paused per position', () => {
    const rows = feHelpers.rulePositions(rules);
    const tele = rows.find((r) => r.position === 'Telecaller');
    assert.deepEqual({ live: tele.live, paused: tele.paused, total: tele.total }, { live: 1, paused: 1, total: 2 });
    assert.ok(rows.some((r) => r.position === '(all positions)'), 'rules with no position still get a bucket');
  });

  it('filters by position, status and text', () => {
    assert.deepEqual(feHelpers.filterRules(rules, { position: 'Telecaller' }).map((r) => r.key), ['a', 'b']);
    assert.deepEqual(feHelpers.filterRules(rules, { status: 'live' }).map((r) => r.key), ['a', 'c']);
    assert.deepEqual(feHelpers.filterRules(rules, { status: 'paused' }).map((r) => r.key), ['b', 'd']);
    assert.deepEqual(feHelpers.filterRules(rules, { q: 'gamm' }).map((r) => r.key), ['c']);
    assert.deepEqual(feHelpers.filterRules(rules, {}).length, 4);
    assert.deepEqual(feHelpers.filterRules(rules, { position: 'Telecaller', status: 'paused' }).map((r) => r.key), ['b']);
  });
});

describe('AI assist', () => {
  it('the prompt states the engine contract', () => {
    const p = prompt.DEFAULT_NOTIFICATION_PROMPT;
    for (const needle of ['telecaller_id', 'employee_key', 'level', '?1', '?2', 'level 1', 'read-only']) {
      assert.ok(p.includes(needle), `prompt must mention ${needle}`);
    }
    assert.match(p, /--- SQL ---/);
    assert.match(p, /--- TEMPLATE ---/);
  });

  it('normalises a saved prompt and clears on blank', () => {
    assert.equal(prompt.normalizePrompt('   '), '');
    assert.equal(prompt.normalizePrompt(' x\r\ny '), 'x\ny');
    assert.ok(prompt.normalizePrompt('a'.repeat(20000)).length <= 12000);
  });

  it('selects business tables only, live names first', () => {
    const names = ['sqlite_sequence', '_cf_KV', 'd1_migrations', 'DeviceCall', 'Telecaller', 'HumanResourcesMember', 'RandomJunk', 'core_notification'];
    const picked = catalog.pickTables(names);
    assert.equal(picked[0], 'DeviceCall');
    assert.ok(picked.includes('Telecaller'));
    assert.ok(picked.includes('core_notification'));
    assert.ok(!picked.includes('sqlite_sequence'));
    assert.ok(!picked.includes('_cf_KV'));
    assert.ok(!picked.includes('RandomJunk'));
  });

  it('writes a copyable block, one column per line', () => {
    const text = catalog.schemaText([
      { table: 'DeviceCall', note: 'call log', columns: [{ name: 'telecallerId', type: 'TEXT' }, { name: 'attemptAt', type: 'TEXT' }] },
    ]);
    assert.match(text, /DeviceCall\s+-- call log/);
    assert.match(text, /telecallerId TEXT/);
    assert.match(text, /attemptAt TEXT/);
  });

  it('exposes prompt + schema endpoints to root/admin only', () => {
    const routes = be('src/worker/routes/notifications.ts');
    assert.match(routes, /app\.get\('\/api\/notification-prompt'/);
    assert.match(routes, /app\.put\('\/api\/notification-prompt'/);
    assert.match(routes, /app\.get\('\/api\/notification-schema'/);
    for (const path of ['notification-prompt', 'notification-schema']) {
      const idx = routes.indexOf(`/api/${path}`, routes.indexOf(`app.get('/api/${path}'`));
      const block = routes.slice(idx, idx + 500);
      assert.match(block, /author\(c\)/, `${path} must be author-gated`);
    }
  });
});

describe('its own dashboard', () => {
  it('is a top-level nav view, root/admin only', () => {
    const nav = fe('components/layout/nav.tsx');
    assert.match(nav, /view: "notifications"/);
    assert.match(nav, /notifications: "\/notifications"/);
    const perms = fe('auth/permissions.ts');
    assert.match(perms, /viewOrSlug === "notifications"\) return me\.isRoot \|\| me\.isAdmin/);
  });

  it('is rendered by the app and absent from Settings', () => {
    const page = fe('app/page.tsx');
    assert.match(page, /activeView === "notifications" && <NotificationsDashboard \/>/);
    const settings = fe('components/SettingsDashboard.tsx');
    assert.doesNotMatch(settings, /NotificationConsole/);
  });
});

describe('the seeded real rule', () => {
  const files = readdirSync(join(BACKEND_DIR, 'migrations')).filter((f) => f.startsWith('0164'));
  const sql = files.length ? be(`migrations/${files[0]}`) : '';

  it('exists and targets the DeviceCall call log', () => {
    assert.ok(files.length > 0, 'migration 0164 must exist');
    assert.match(sql, /telecaller-hourly-connected-call/);
    assert.match(sql, /FROM DeviceCall/);
    assert.match(sql, /attemptAt >= \?1/);
    assert.match(sql, /ATTEMPTED_CALLS|attempted_calls/);
    assert.match(sql, /AS level/);
  });

  it('seeds paused, so nothing fires before the founder runs it', () => {
    assert.match(sql, /INSERT OR IGNORE/);
    assert.match(sql, /'telecaller-hourly-connected-call',\s*\n\s*'Telecaller Hourly Connected Call',\s*\n\s*'[^']*',\s*\n\s*0,/);
  });
});

describe('zero-row runs stay explainable', () => {
  it('the engine accepts an explicit window (Test sample mode)', () => {
    const engine = be('src/modules/notifications/engine.ts');
    assert.match(engine, /window\?: \{ startIso: string; endIso: string \}/);
    assert.match(engine, /const win: RunWindow = opts\.window/);
  });

  it('the test route widens the window without dispatching', () => {
    const routes = be('src/worker/routes/notifications.ts');
    assert.match(routes, /lookbackHours/);
    assert.match(routes, /dryRun: true, align: false, window/);
    assert.doesNotMatch(routes, /lookbackHours[\s\S]{0,400}notifyUsers/);
  });

  it('the run route honours the same window and still dispatches', () => {
    const routes = be('src/worker/routes/notifications.ts');
    assert.match(routes, /\/run'[\s\S]{0,900}lookbackHours/);
    assert.match(routes, /\/run'[\s\S]{0,1400}notifyLive/);
  });

  it('labels the evaluated window in IST', () => {
    const label = feHelpers.windowLabel('2026-11-24T00:48:00.000Z', '2026-11-24T01:48:00.000Z');
    assert.match(label, /06:18[–-]07:18 IST/);
    assert.equal(feHelpers.windowLabel(null, null), '—');
    assert.equal(feHelpers.windowLabel('nope', 'nope'), '—');
  });

  it('the drawer explains 0 rows and offers a 7-day sample', () => {
    const drawer = fe('components/notifications-console/RuleDrawer.tsx');
    assert.match(drawer, /returned no rows for/);
    assert.match(drawer, /Sample last 7 days/);
    assert.match(drawer, /Test \(no send\)/);
  });
});

describe('parameter binding', () => {
  it('counts only the placeholders the SQL actually uses', () => {
    assert.equal(metricSql.paramCount('SELECT 1'), 0);
    assert.equal(metricSql.paramCount('WHERE a >= ?1 AND a < ?2'), 2);
    assert.equal(metricSql.paramCount('WHERE a >= ?1 AND a < ?2 AND d = ?3'), 3);
    assert.equal(metricSql.paramCount('WHERE a = ?3'), 3);
    assert.equal(metricSql.paramCount('WHERE a = ? AND b = ?'), 2);
  });

  it('never hands D1 a surplus binding (the live failure)', () => {
    // The founder's rule used ?1/?2 only while the runner offered three values →
    // "Wrong number of parameter bindings" on every sweep.
    assert.match(be('src/modules/notifications/metric-sql.ts'), /params\.slice\(0, Math\.min\(paramCount\(sql\)/);
    const rule = be('migrations/0165_notification_rule_telecaller_real_sql.sql');
    assert.equal(metricSql.paramCount(rule), 2, 'the seeded rule uses ?1 and ?2 only');
  });
});
