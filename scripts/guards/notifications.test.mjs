// notifications.test.mjs — Guards for the notification engine.
//
// Locks the parts that must never drift:
//   1. the founder's 5-level palette (labels/colours/level-1 = resolved);
//   2. level math + mustache rendering, BE ↔ FE identical (mirror);
//   3. the authored-SQL firewall (read-only, single statement);
//   4. IST-aligned windows + next-due (so "hourly" means the shop-floor hour);
//   5. the guard's own sample: the founder's escalation message renders exactly.
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BACKEND_DIR, FRONTEND_SRC, bundleToFile } from './_bundle.mjs';

const beLevels = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src/modules/notifications/levels.ts'))).href);
const beTemplate = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src/modules/notifications/template.ts'))).href);
const beSql = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src/modules/notifications/metric-sql.ts'))).href);
const beWindow = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src/modules/notifications/window.ts'))).href);
const feLevels = await import(pathToFileURL(bundleToFile(join(FRONTEND_SRC, 'notifications/levels.ts'), { alias: { '@': FRONTEND_SRC } })).href);
const feTemplate = await import(pathToFileURL(bundleToFile(join(FRONTEND_SRC, 'notifications/template.ts'), { alias: { '@': FRONTEND_SRC } })).href);

const FOUNDER_LEVELS = [
  { level: 1, colorName: 'Green', hexColor: '#2E7D32', label: 'Normal / Resolved' },
  { level: 2, colorName: 'Light Green', hexColor: '#689F38', label: 'Info / Low' },
  { level: 3, colorName: 'Yellow', hexColor: '#FBC02D', label: 'Warning / Moderate' },
  { level: 4, colorName: 'Orange', hexColor: '#F57C00', label: 'High / Major' },
  { level: 5, colorName: 'Dark Red', hexColor: '#B71C1C', label: 'Critical / Severe' },
];

describe('notification levels', () => {
  it('ships the founder palette (one definition per level, valid hex)', () => {
    const levels = beLevels.normalizeLevels(JSON.stringify(FOUNDER_LEVELS));
    assert.equal(levels.length, 5);
    assert.deepEqual(levels.map((l) => l.level), [1, 2, 3, 4, 5]);
    for (const l of levels) assert.match(l.hexColor, /^#[0-9A-F]{6}$/);
    assert.equal(levels[0].label, 'Normal / Resolved');
    assert.equal(levels[4].hexColor, '#B71C1C');
  });

  it('falls back to the founder palette on garbage, and normalises bare hex', () => {
    const levels = beLevels.normalizeLevels('not json at all');
    assert.deepEqual(levels.map((l) => l.hexColor), beLevels.DEFAULT_LEVELS.map((l) => l.hexColor));
    const partial = beLevels.normalizeLevels([{ level: 3, hexColor: 'abc123' }]);
    assert.equal(partial[2].hexColor, '#ABC123');
    assert.equal(partial[2].label, 'Warning / Moderate');
  });

  it('never leaves the 1..5 range', () => {
    for (const input of [0, -3, 9, null, 'x', 2.6]) {
      const level = beLevels.clampLevel(input);
      assert.ok(level >= 1 && level <= 5, `clampLevel(${input}) = ${level}`);
    }
  });

  it('threshold lookup takes the HIGHEST matching level', () => {
    const thresholds = [
      { level: 3, op: 'lt', value: 5 },
      { level: 5, op: 'lt', value: 2 },
      { level: 4, op: 'lt', value: 3 },
    ];
    assert.equal(beLevels.levelForValue(thresholds, 1), 5);
    assert.equal(beLevels.levelForValue(thresholds, 2), 4);
    assert.equal(beLevels.levelForValue(thresholds, 4), 3);
    assert.equal(beLevels.levelForValue(thresholds, 9), null);
  });

  it('escalation memory bumps a level per N windows and caps at maxLevel', () => {
    assert.equal(beLevels.escalatedLevel(3, 0, 2), 3);
    assert.equal(beLevels.escalatedLevel(3, 2, 2), 4);
    assert.equal(beLevels.escalatedLevel(3, 6, 2), 5);
    assert.equal(beLevels.escalatedLevel(4, 100, 1, 5), 5);
  });
});

describe('levels + template mirrors (backend ↔ frontend)', () => {
  it('level maths agree for every level and threshold shape', () => {
    const thresholds = [{ level: 3, op: 'lt', value: 5 }, { level: 5, op: 'eq', value: 0 }];
    for (let level = 0; level <= 6; level++) {
      assert.equal(beLevels.clampLevel(level), feLevels.clampLevel(level));
      assert.equal(beLevels.levelForValue(thresholds, level), feLevels.levelForValue(thresholds, level));
      assert.equal(beLevels.escalatedLevel(level, 3, 2), feLevels.escalatedLevel(level, 3, 2));
    }
    assert.deepEqual(beLevels.DEFAULT_LEVELS, feLevels.DEFAULT_LEVELS);
  });

  it('renderTemplate agrees on the founder example + edge cases', () => {
    const ctx = { AGENT_NAME: 'Ravi', HOURLY_CONNECTED_CALL: 2, value: 2, level: 3, nested: null };
    const cases = [
      '{AGENT_NAME} heads up you only have {HOURLY_CONNECTED_CALL} in last hour please improve your calling activity in the next hours',
      '{agent_name} · {VALUE} · {LEVEL}',
      'unknown {NOPE} token',
      '   spacing   {VALUE}   ',
      '',
    ];
    for (const tpl of cases) assert.equal(beTemplate.renderTemplate(tpl, ctx), feTemplate.renderTemplate(tpl, ctx));
    assert.equal(
      beTemplate.renderTemplate(cases[0], ctx),
      'Ravi heads up you only have 2 in last hour please improve your calling activity in the next hours',
    );
    assert.equal(beTemplate.renderTemplate('unknown {NOPE} token', ctx), 'unknown token');
    assert.equal(beTemplate.renderTemplate('{nested}', ctx), '');
  });

  it('exposes the builtin token list to the console', () => {
    assert.ok(beTemplate.BUILTIN_TOKENS.includes('AGENT_NAME'));
    assert.ok(beTemplate.BUILTIN_TOKENS.includes('LEVEL_COLOR'));
    assert.equal(beTemplate.templateTokens('{A} {b} {A}').length, 2);
  });
});

describe('authored metric SQL firewall', () => {
  const sample = `SELECT d.telecallerId AS telecaller_id, COUNT(*) AS value, CASE WHEN COUNT(*) < 4 THEN 3 ELSE 1 END AS level
    FROM DeviceCall d WHERE d.attemptAt >= ?1 AND d.attemptAt < ?2 GROUP BY d.telecallerId`;

  it('accepts the documented SELECT shape', () => {
    assert.ok(beSql.assertReadOnlySql(sample).startsWith('SELECT'));
    assert.ok(beSql.assertReadOnlySql('WITH x AS (SELECT 1 AS v) SELECT v FROM x').startsWith('WITH'));
    assert.ok(beSql.assertReadOnlySql(`${sample};`).length > 0, 'a trailing semicolon is tolerated');
  });

  it('rejects anything that is not one read-only statement', () => {
    const bad = [
      '',
      'DELETE FROM DeviceCall',
      'UPDATE DeviceCall SET status = "CONNECTED"',
      'PRAGMA table_info(DeviceCall)',
      'ATTACH DATABASE "x" AS y',
      'DROP TABLE DeviceCall',
      `${sample}; DROP TABLE DeviceCall`,
      'SELECT 1; SELECT 2',
      '/* sneaky */ INSERT INTO x VALUES (1)',
      '-- only a comment',
    ];
    for (const sql of bad) {
      assert.throws(() => beSql.assertReadOnlySql(sql), /NotificationInputError|read-only|SELECT|statement|empty|comment/i, `should reject: ${sql.slice(0, 40)}`);
    }
  });
});

describe('cadence windows (IST-aligned)', () => {
  it('hourly evaluates the previous full IST hour', () => {
    // 2026-11-24T08:30:00Z = 14:00 IST → window 13:00–14:00 IST.
    const w = beWindow.windowFor({ kind: 'hourly' }, new Date('2026-11-24T08:30:00Z'));
    assert.equal(w.endIso, '2026-11-24T08:30:00.000Z');
    assert.equal(w.startIso, '2026-11-24T07:30:00.000Z');
  });

  it('everyNMin snaps to the N-minute block', () => {
    const w = beWindow.windowFor({ kind: 'everyNMin', n: 15 }, new Date('2026-11-24T08:37:00Z'));
    assert.equal(w.endIso, '2026-11-24T08:30:00.000Z');
    assert.equal(w.startIso, '2026-11-24T08:15:00.000Z');
  });

  it('next due is always strictly in the future', () => {
    for (const cadence of [{ kind: 'hourly' }, { kind: 'everyNMin', n: 5 }, { kind: 'daily', atMinute: 570 }]) {
      const slot = new Date('2026-11-24T08:30:00Z');
      const next = beWindow.nextDueAt(cadence, slot);
      assert.ok(next && next.getTime() > slot.getTime(), `nextDueAt(${cadence.kind}) must advance`);
    }
    assert.equal(beWindow.nextDueAt({ kind: 'manual' }, new Date()), null);
  });

  it('the IST day key is the shop-floor day', () => {
    // 18:45 UTC = 00:15 IST next day.
    assert.equal(beWindow.istDayKey(new Date('2026-11-24T18:45:00Z')), '2026-11-25');
  });
});
