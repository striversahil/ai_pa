import { eachDate } from './calendar';
import { HrError } from './errors';
import { isValidDate, text } from './parse';
import { HOLIDAY_KINDS, type HolidayInput } from './types';

/** Sorted Sunday-first, matching JS getUTCDay(). */
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** An empty weekday window means "every week, forever". Real dated values keep
 *  the stored columns NOT NULL and let one rule cover the current year only. */
export const HOLIDAY_OPEN_START = '1970-01-01';
export const HOLIDAY_OPEN_END = '2999-12-31';

function date10(value: unknown): string {
  return String(value ?? '').slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export function cleanHoliday(raw: Record<string, any>): HolidayInput {
  const requested = String(raw.kind ?? '');
  const kind = (HOLIDAY_KINDS as readonly string[]).includes(requested) ? requested as HolidayInput['kind'] : 'single';
  const name = text(raw.name, 120);
  if (!name) throw new HrError('name is required');

  if (kind === 'single') {
    const date = date10(raw.date ?? raw.startDate);
    if (!isValidDate(date)) throw new HrError('date must be YYYY-MM-DD');
    return { kind, date, startDate: date, endDate: date, weekday: null, name };
  }

  if (kind === 'range') {
    const startDate = date10(raw.startDate ?? raw.date);
    const endDate = date10(raw.endDate ?? raw.startDate ?? raw.date);
    if (!isValidDate(startDate)) throw new HrError('startDate must be YYYY-MM-DD');
    if (!isValidDate(endDate)) throw new HrError('endDate must be YYYY-MM-DD');
    if (endDate < startDate) throw new HrError('endDate cannot be before startDate');
    return { kind, date: null, startDate, endDate, weekday: null, name };
  }

  const weekday = Number(raw.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new HrError('weekday must be 0 (Sunday) to 6 (Saturday)');
  }
  const startDate = date10(raw.startDate) || HOLIDAY_OPEN_START;
  const endDate = date10(raw.endDate) || HOLIDAY_OPEN_END;
  if (!isValidDate(startDate)) throw new HrError('startDate must be YYYY-MM-DD');
  if (!isValidDate(endDate)) throw new HrError('endDate must be YYYY-MM-DD');
  if (endDate < startDate) throw new HrError('endDate cannot be before startDate');
  return { kind, date: null, startDate, endDate, weekday, name };
}

function clampToWindow(row: any, start: string, end: string): { from: string; to: string } | null {
  const from = String(row.startDate ?? '') > start ? String(row.startDate) : start;
  const to = String(row.endDate ?? '') < end ? String(row.endDate) : end;
  return from && to && to >= from ? { from, to } : null;
}

/** Every holiday date in [start, end] from the stored rules. */
export function holidayDatesIn(rows: any[], start: string, end: string): Set<string> {
  const out = new Set<string>();
  for (const row of rows ?? []) {
    const kind = String(row.kind ?? 'single');
    if (kind === 'single') {
      const day = date10(row.date ?? row.startDate);
      if (day && day >= start && day <= end) out.add(day);
      continue;
    }
    const window = clampToWindow(row, start, end);
    if (!window) continue;
    if (kind === 'range') {
      for (const day of eachDate(window.from, window.to)) out.add(day);
      continue;
    }
    if (kind === 'weekday') {
      const weekday = Number(row.weekday);
      if (!Number.isInteger(weekday)) continue;
      for (const day of eachDate(window.from, window.to)) {
        if (weekdayOf(day) === weekday) out.add(day);
      }
    }
  }
  return out;
}

/** One-line description used by the API and mirrored by the UI. */
export function holidayLabel(row: any): string {
  const kind = String(row.kind ?? 'single');
  if (kind === 'range') return date10(row.startDate) + ' → ' + date10(row.endDate);
  if (kind === 'weekday') {
    const weekday = Number(row.weekday);
    const name = WEEKDAY_NAMES[weekday] ?? 'Weekday';
    const from = date10(row.startDate);
    const to = date10(row.endDate);
    const window = !from || from <= HOLIDAY_OPEN_START || to >= HOLIDAY_OPEN_END ? '' : ' (' + from + ' → ' + to + ')';
    return 'Every ' + name + window;
  }
  return date10(row.date ?? row.startDate);
}
