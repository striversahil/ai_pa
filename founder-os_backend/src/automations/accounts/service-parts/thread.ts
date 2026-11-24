// ─────────────────────────────────────────────────────────────────────────────
// accounts/service-parts/thread.ts — a task is a THREAD, not a card per day.
//
// One task (template × lane) owns every occurrence in the performance window.
// "15th and 30th of the month" is two entries in the same thread, not two
// tasks; a day nobody logged is an entry the engine writes itself and it stays
// Not done until somebody describes the late work.
//
// Pure + framework-free: no I/O, no dates from the clock (callers pass
// `today`), so the guard can run it with fixtures on both runtimes.
//
// Founder decisions this encodes (2026-11-25):
//  • the window is the Indian financial year (1 Apr → 31 Mar);
//  • a missed day stays `not_done` — a late-work note explains lateness, it
//    never flips the day to done;
//  • a window rule's SPAN is the deadline, so only its last day can be missed.
// ─────────────────────────────────────────────────────────────────────────────
import { addDays, isDueOn, parseDay } from './pure';

/** Indian financial year starts 1 April. */
export const FY_START_MONTH = 4;

export interface ThreadWindow {
  from: string;
  to: string;
}

/** Performance window holding `today`: the FY it falls in. */
export function threadWindow(today: string): ThreadWindow {
  const { y, m } = parseDay(today);
  const startY = m >= FY_START_MONTH ? y : y - 1;
  return { from: `${startY}-04-01`, to: `${startY + 1}-03-31` };
}

/**
 * Every date in [from, to] the template is due on, oldest first.
 * Reuses `isDueOn`, so `multiple_days` (15 & 30), ranges, weekday,
 * yearly dates and multi-occurrence all produce entries with no special case.
 * `cap` bounds a malformed rule (a daily task across 5 years is 1,825 rows).
 */
export function dueDatesBetween(t: any, from: string, to: string, cap = 400): string[] {
  const out: string[] = [];
  if (!from || !to || from > to) return out;
  for (let d = from; d <= to && out.length < cap; d = addDays(d, 1)) {
    if (isDueOn(t, d)) out.push(d);
  }
  return out;
}

/**
 * Did `date`'s deadline actually pass?
 *
 * A window rule (`day_range` / `month_day_range` / `week_of_month`) makes the
 * SPAN the deadline: unresolved inner days are grace, not misses. "is the next
 * day also due?" covers both shapes at once — a single-occasion date's next day
 * is never due (missable), a window's inner day's next day always is.
 */
export function isMissable(t: any, date: string): boolean {
  return !isDueOn(t, addDays(date, 1));
}

export type ThreadEntryStatus = 'done' | 'not_done' | 'late' | 'missed' | 'pending';

/**
 * ONE derivation for a thread entry. The row mapper and the aggregate folder
 * both call this, so a summary can never disagree with the thread it summarises.
 *
 *  done     — completed (on time or late, explicitly)
 *  not_done — explicitly conceded with a remark for that date (valid record)
 *  missed   — written by the engine for an unlogged day, still unexplained
 *  late     — engine-written day that now carries a late-work description
 *             (the DAY stays not done; only the explanation is added)
 *  pending  — today, or a future occurrence
 *
 * An engine-written day stops being `missed` the moment a human says something
 * about it: a remark = conceded (not_done), a late-work note = explained (late).
 */
export function bucketOf(
  status: string,
  entryKind: string,
  hasLateNote: boolean,
  dueDate: string,
  today: string,
  hasRemark = false,
): ThreadEntryStatus {
  if (status === 'done') return 'done';
  if (entryKind === 'auto_miss') {
    if (hasLateNote) return 'late';
    if (hasRemark) return 'not_done';
    return 'missed';
  }
  if (status === 'not_done') return 'not_done';
  if (!dueDate || dueDate >= today) return 'pending';
  return 'missed';
}

export interface ThreadCounts {
  due: number;
  done: number;
  notDone: number;
  missed: number;
  late: number;
  pending: number;
  /** Days still unexplained — the number the accountant must clear. */
  unresolved: number;
}

export function emptyCounts(): ThreadCounts {
  return { due: 0, done: 0, notDone: 0, missed: 0, late: 0, pending: 0, unresolved: 0 };
}

export function addToCounts(c: ThreadCounts, b: ThreadEntryStatus): ThreadCounts {
  c.due += 1;
  if (b === 'done') c.done += 1;
  else if (b === 'not_done') c.notDone += 1;
  else if (b === 'missed') { c.missed += 1; c.unresolved += 1; }
  else if (b === 'late') c.late += 1;
  else c.pending += 1;
  return c;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-15" → "15 Nov 2026" (the export/thread label date). */
export function longDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
  if (!m) return String(date || '');
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/**
 * The sentence the engine stands behind for an unlogged day. Rendered from the
 * DATE at serve time — never stored, so it cannot go stale and there is no
 * per-language copy in the data.
 */
export function missLabel(date: string): string {
  return `Task not done on ${longDate(date)}`;
}

/** Thread completion % (done ÷ due), rounded. No due days yet → 100. */
export function completionPct(c: ThreadCounts): number {
  return c.due > 0 ? Math.round((c.done / c.due) * 100) : 100;
}
