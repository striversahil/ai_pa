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
import { execFileSync } from 'node:child_process';
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

// The rule must grade PEOPLE, not call rows: a seat with no dialer rows in the
// hour is exactly who needs the escalation (founder bug 2026-11-24 — only the
// agents whose phones had synced calls ever appeared).
describe('the target-20 rule grades every on-duty telecaller', () => {
  const files = readdirSync(join(BACKEND_DIR, 'migrations')).filter((f) => f.startsWith('0167'));
  const raw = files.length ? be(`migrations/${files[0]}`) : '';
  // Keep only the executable SQL — the header explains the old bug and names it.
  const sql = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('is driven by the HR register, not by DeviceCall', () => {
    assert.ok(files.length > 0, 'migration 0167 must exist');
    assert.match(sql, /FROM HumanResourcesMember m/);
    assert.match(sql, /LEFT JOIN calls c ON c\.tid = t\.id/);
    assert.doesNotMatch(sql, /HAVING/i, 'a HAVING clause hides the people who did not dial');
  });

  it('returns the engine row contract (employee_key + value + level)', () => {
    assert.match(sql, /m\.id AS employee_key/);
    assert.match(sql, /COALESCE\(c\.connected, 0\) AS value/);
    assert.match(sql, /END AS level/);
  });

  it('grades against the 20/hour target with the founder ladder', () => {
    for (const [band, level] of [['20', 1], ['15', 2], ['10', 3], ['5', 4]]) {
      assert.match(sql, new RegExp(`>= ${band} THEN ${level}`), `band >= ${band} must map to level ${level}`);
    }
    assert.match(sql, /ELSE 5/);
  });

  it('skips the absent and the closed day', () => {
    assert.match(sql, /FROM HumanResourcesLeave l[\s\S]{0,300}l\.status = ''approved''/);
    assert.match(sql, /l\.durationType = ''full_day''/);
    assert.match(sql, /FROM HumanResourcesAttendance a[\s\S]{0,200}a\.status = ''absent''/);
    assert.match(sql, /FROM HumanResourcesHoliday h WHERE h\.date = \?3/);
    assert.match(sql, /FROM SalesHoliday s WHERE s\.day = \?3/);
    assert.match(sql, /strftime\(''%w'', \?3\) <> ''0''/);
  });

  it('only grades an hour inside the working band', () => {
    assert.match(sql, /% 1440\) BETWEEN 600 AND 1260/);
  });

  it('is idempotent and never flips the founder\'s Live/Paused choice', () => {
    assert.match(sql, /instr\(upper\("sqlText"\), 'HUMANRESOURCESMEMBER'\) = 0/);
    assert.doesNotMatch(sql, /"enabled"\s*=/);
  });
});

describe('zero-row runs stay explainable', () => {
  it('the dry run hands the console its real rows, the cron never does', () => {
    const engine = be('src/modules/notifications/engine.ts');
    assert.match(engine, /if \(dryRun\) result\.sampleRows = sampleRows\(rows\)/);
    assert.match(engine, /if \(dryRun\) result\.sampleNames = nameByKey/);
    const types = be('src/modules/notifications/types.ts');
    assert.match(types, /sampleRows\?: Array<Record<string, unknown>>/);
  });

  it('caps what a dry run can carry', () => {
    assert.equal(columns.sampleRows([{ a: 1 }], 1, 1).length, 1);
    const wide = columns.sampleRows([{ a: 1, b: 2, c: 3 }], 50, 2);
    assert.deepEqual(Object.keys(wide[0]), ['a', 'b']);
    assert.equal(columns.sampleRows([{ a: 'x'.repeat(500) }])[0].a.length, 200);
    assert.equal(columns.sampleRows(null).length, 0);
  });

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

describe('preview = the SQL output, or null', () => {
  it('renders the row it was given', () => {
    const row = { telecaller_id: 'TC001', value: 0, hourly_connected_call: 0, level: 5 };
    assert.equal(feHelpers.renderPreview('{hourly_connected_call} calls', row, null), '0 calls');
    assert.equal(feHelpers.renderPreview('{TELEcaller_id}', row, null), 'TC001');
  });

  it('never invents a value — unknown tokens read null', () => {
    const row = { value: 1 };
    assert.equal(feHelpers.renderPreview('{AGENT_NAME} has {nothing_here}', row, null), 'null has null');
    // No rows at all (query failed / empty window) → every token is null.
    assert.equal(feHelpers.renderPreview('{value} in {WINDOW}', null, null), 'null in null');
  });

  it('fills engine values only from the REAL run (window, rule, recipient)', () => {
    const win = { windowStart: '2026-11-24T00:30:00.000Z', windowEnd: '2026-11-24T01:30:00.000Z', ruleName: 'Hourly', agentName: 'Ravi' };
    const out = feHelpers.renderPreview('{AGENT_NAME} :: {WINDOW} :: {RULE_NAME}', {}, win);
    assert.match(out, /Ravi :: 06:00[–-]07:00 IST :: Hourly/);
    // Row columns win over engine values with the same name.
    assert.equal(feHelpers.renderPreview('{agent_name}', { agent_name: 'Row' }, win), 'Row');
  });

  it('the drawer previews row 1 by default and offers the rest', () => {
    const drawer = fe('components/notifications-console/RuleDrawer.tsx');
    assert.match(drawer, /renderPreview\(/);
    assert.match(drawer, /previewRows\[Math\.min\(previewIdx/);
    assert.doesNotMatch(drawer, /BUILTIN_TOKENS/);
    assert.doesNotMatch(drawer, /Ravi/, 'no invented sample person');
  });

  it('keeps EMPLOYEE_NAME as a default field, resolved from the real person', () => {
    const drawer = fe('components/notifications-console/RuleDrawer.tsx');
    assert.match(drawer, /const DEFAULT_FIELDS = \["EMPLOYEE_NAME"\]/);
    // Previewed row → its own recipient, not the first notified one.
    const row = { telecaller_id: 'TC002', hourly_connected_call: 1 };
    const win = { agentName: 'First', names: { TC002: 'Second' } };
    assert.equal(feHelpers.renderPreview('{EMPLOYEE_NAME}', row, win), 'Second');
    assert.equal(feHelpers.renderPreview('{AGENT_NAME}', row, win), 'Second');
    // Unknown person → still a value from the run, never a fabricated name.
    assert.equal(feHelpers.renderPreview('{EMPLOYEE_NAME}', { telecaller_id: 'ZZ9' }, { names: {} }), 'null');
    // A row column with the same name wins over the engine value.
    assert.equal(feHelpers.renderPreview('{employee_name}', { employee_name: 'From SQL' }, win), 'From SQL');
  });

  it('Test/Run sit next to the query, not in the drawer header', () => {
    const drawer = fe('components/notifications-console/RuleDrawer.tsx');
    const header = drawer.slice(drawer.indexOf('headerRight={'), drawer.indexOf('>', drawer.indexOf('headerRight={')) + 1);
    assert.ok(!header.includes('Test (no send)'), 'header keeps only Save');
    const sql = drawer.indexOf('Metric query');
    const test = drawer.indexOf('Test (no send)');
    assert.ok(sql > 0 && test > sql, 'Test must render after the SQL section starts');
    assert.ok(drawer.indexOf('<ResultTable') > test, 'the result table follows the run buttons');
  });

  it('the output can be cleared', () => {
    assert.match(fe('components/notifications-console/RuleDrawer.tsx'), /Clear output/);
    const table = fe('components/notifications-console/ResultTable.tsx');
    assert.match(table, /columns: string\[\]/);
    assert.match(table, /rows: Array<Record<string, unknown>>/);
  });
});

describe('schema relationships (the AI needs the graph)', () => {
  it('relations.ts is in sync with Prisma + the runtime ORM map', () => {
    const out = execFileSync(process.execPath, [join(BACKEND_DIR, '..', 'scripts/gen-schema-relations.mjs'), '--check'], { encoding: 'utf8' });
    assert.match(out, /up to date/);
  });

  it('carries the runtime edges that matter', () => {
    const rel = be('src/modules/notifications/relations.ts');
    assert.match(rel, /from: "EstimateAssignment", field: "telecallerId", model: "Telecaller"/);
    assert.match(rel, /kind: "orm"/);
    assert.match(rel, /RELATIONS_BY_TABLE/);
  });

  it('states the no-FK identity bridge explicitly', () => {
    const app = catalog.APPLICATION_JOINS;
    assert.ok(app.some((j) => j.from === 'Telecaller' && j.field === 'email' && j.model === 'HumanResourcesMember'));
    assert.ok(app.some((j) => j.from === 'core_notification' && j.field === 'employeeId'));
  });

  it('merges strongest-edge-first and infers name-only keys', () => {
    const merged = catalog.mergeJoins(
      [{ field: 'telecallerId', model: 'Telecaller', ref: 'id', kind: 'inferred' }],
      [{ field: 'telecallerId', model: 'Telecaller', ref: 'id', kind: 'orm' }],
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].kind, 'orm');
    const inferred = catalog.inferJoins('DeviceCall', ['telecallerId', 'id', 'status'], ['DeviceCall', 'Telecaller']);
    assert.deepEqual(inferred, [{ field: 'telecallerId', model: 'Telecaller', ref: 'id', kind: 'inferred' }]);
  });

  it('prints the edges in the copyable block', () => {
    const text = catalog.schemaText([
      { table: 'DeviceCall', note: 'calls', columns: [{ name: 'telecallerId', type: 'TEXT' }], joins: [{ field: 'telecallerId', model: 'Telecaller', ref: 'id', kind: 'orm' }] },
    ]);
    assert.match(text, /-> telecallerId = Telecaller\.id\s+\(orm\)/);
    assert.match(text, /no foreign key/i);
  });

  it('the schema loader merges fk + code edges and counts them', () => {
    const schema = be('src/modules/notifications/schema.ts');
    assert.match(schema, /foreign_key_list/);
    assert.match(schema, /mergeJoins\(/);
    assert.match(schema, /relationships/);
  });

  it('the promise states the join rules', () => {
    assert.match(prompt.DEFAULT_NOTIFICATION_PROMPT, /JOIN only along a listed edge/);
    assert.match(prompt.DEFAULT_NOTIFICATION_PROMPT, /never guess a name/);
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
