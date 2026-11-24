// accounts-thread.test.mjs — Guard: one task is a thread, not a card per day.
//
// Locks the founder decisions of 2026-11-25 that the accounts redesign encodes:
//   • the performance window is the Indian financial year (1 Apr → 31 Mar);
//   • a monthly task repeating on the 15th AND 30th is TWO ENTRIES of ONE task;
//   • a window rule's span is the deadline — only its last day can be missed;
//   • an unlogged day is recorded by the engine ("Task not done on <date>") and
//     stays not done; a remark = conceded, a late-work note = explained, and
//     neither ever flips the day to done.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/accounts-thread.test.mjs`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const m = await import(bundleToFile(join(BACKEND_DIR, 'src', 'automations', 'accounts', 'service-parts', 'thread.ts')));

const tpl = (rule, frequency = 'monthly') => ({
  id: 't1',
  frequency,
  ruleType: rule?.type ?? null,
  ruleJson: rule ? JSON.stringify(rule) : null,
});

describe('thread window (financial year)', () => {
  it('a November date sits in Apr→Mar of the same start year', () => {
    assert.deepEqual(m.threadWindow('2026-11-25'), { from: '2026-04-01', to: '2027-03-31' });
  });
  it('a February date still belongs to the previous start year', () => {
    assert.deepEqual(m.threadWindow('2026-02-10'), { from: '2025-04-01', to: '2026-03-31' });
  });
  it('the window is inclusive at both ends', () => {
    const w = m.threadWindow('2026-04-01');
    assert.equal(w.from, '2026-04-01');
    assert.equal(w.to, '2027-03-31');
  });
});

describe('one task, several repeats per month', () => {
  const multi = tpl({ type: 'multiple_days', days: [15, 30], month: null });

  it('15 and 30 of the same month are two entries of ONE thread', () => {
    assert.deepEqual(m.dueDatesBetween(multi, '2026-11-01', '2026-11-30'), ['2026-11-15', '2026-11-30']);
  });
  it('a whole-year thread keeps every occurrence in order', () => {
    const dates = m.dueDatesBetween(multi, '2026-04-01', '2027-03-31');
    // 12 months × 2 = 24, minus February 2027 (28 days → there is no 30th).
    assert.equal(dates.length, 23);
    assert.equal(dates[0], '2026-04-15');
    assert.equal(dates[dates.length - 1], '2027-03-30');
    assert.equal(dates.includes('2027-02-30'), false);
    assert.deepEqual([...dates].sort(), dates);
  });
  it('daily runs every working day (Mon–Sat)', () => {
    const daily = tpl({ type: 'not_applicable' }, 'daily');
    // Nov 2026: 30 days, 5 Sundays (1, 8, 15, 22, 29) → 25 working days.
    assert.equal(m.dueDatesBetween(daily, '2026-11-01', '2026-11-30').length, 25);
  });
  it('a malformed rule cannot explode the page (cap)', () => {
    const daily = tpl({ type: 'not_applicable' }, 'daily');
    assert.equal(m.dueDatesBetween(daily, '2020-01-01', '2030-12-31', 50).length, 50);
  });
});

describe('misses: only a CLOSED deadline can be missed', () => {
  it('a monthly range is missed on its last day only', () => {
    const range = tpl({ type: 'day_range', start_day: 15, end_day: 18, month: null });
    assert.equal(m.isMissable(range, '2026-11-15'), false);
    assert.equal(m.isMissable(range, '2026-11-16'), false);
    assert.equal(m.isMissable(range, '2026-11-17'), false);
    assert.equal(m.isMissable(range, '2026-11-18'), true);
  });
  it('a year-wrap seasonal range is missed on its closing day only', () => {
    const seasonal = tpl({
      type: 'month_day_range',
      start: { day: 30, month: 'September' },
      end: { day: 31, month: 'October' },
    }, 'yearly');
    assert.equal(m.isMissable(seasonal, '2026-09-30'), false);
    assert.equal(m.isMissable(seasonal, '2026-10-30'), false);
    assert.equal(m.isMissable(seasonal, '2026-10-31'), true);
  });
  it('single-occasion rules have no grace window', () => {
    assert.equal(m.isMissable(tpl({ type: 'fixed_day', day: 15, month: null }), '2026-11-15'), true);
    assert.equal(m.isMissable(tpl({ type: 'multiple_days', days: [15, 30], month: null }), '2026-11-15'), true);
    const daily = tpl({ type: 'not_applicable' }, 'daily');
    assert.equal(m.isMissable(daily, '2026-11-14'), true); // Saturday
  });
  it('a day that is not due at all is never a miss', () => {
    const daily = tpl({ type: 'not_applicable' }, 'daily');
    // Sunday: no deadline existed, so nothing can be missed that day.
    assert.equal(m.isMissable(daily, '2026-11-15'), false);
  });
});

describe('entry buckets (one derivation for thread + summary)', () => {
  const TODAY = '2026-11-25';
  it('a completed day is done', () => {
    assert.equal(m.bucketOf('done', 'instance', false, '2026-11-01', TODAY), 'done');
    assert.equal(m.bucketOf('done', 'auto_miss', false, '2026-11-01', TODAY), 'done');
  });
  it('an engine-written day with nothing said is missed', () => {
    assert.equal(m.bucketOf('not_done', 'auto_miss', false, '2026-11-20', TODAY, false), 'missed');
  });
  it('a remark makes an engine-written day a valid conceded record', () => {
    assert.equal(m.bucketOf('not_done', 'auto_miss', false, '2026-11-20', TODAY, true), 'not_done');
  });
  it('a late-work note explains the day but keeps it not done', () => {
    const b = m.bucketOf('not_done', 'auto_miss', true, '2026-11-20', TODAY, false);
    assert.equal(b, 'late');
    assert.notEqual(b, 'done'); // founder rule: resolving never flips the day
  });
  it('today and future occurrences are pending, past unlogged rows read missed', () => {
    assert.equal(m.bucketOf('pending', 'instance', false, TODAY, TODAY), 'pending');
    assert.equal(m.bucketOf('pending', 'instance', false, '2026-12-01', TODAY), 'pending');
    assert.equal(m.bucketOf('pending', 'instance', false, '2026-11-01', TODAY), 'missed');
  });
});

describe('counts and labels', () => {
  it('unresolved counts engine-written misses only', () => {
    const c = m.emptyCounts();
    for (const b of ['done', 'done', 'not_done', 'late', 'missed', 'missed', 'pending']) m.addToCounts(c, b);
    assert.deepEqual(c, { due: 7, done: 2, notDone: 1, missed: 2, late: 1, pending: 1, unresolved: 2 });
    assert.equal(m.completionPct(c), 29);
  });
  it('no due days yet reads 100%', () => {
    assert.equal(m.completionPct(m.emptyCounts()), 100);
  });
  it('the missed-day sentence is generated from the date', () => {
    assert.equal(m.missLabel('2026-11-15'), 'Task not done on 15 Nov 2026');
    assert.equal(m.longDate('2026-04-01'), '1 Apr 2026');
    assert.equal(m.missLabel('not-a-date'), 'Task not done on not-a-date');
  });
});
