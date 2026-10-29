/**
 * Debtors Tracker — promised-to-pay date helpers.
 * Pure: no DB/framework imports. MIRROR: founder-os_frontend/src/debtors-tracker/promise.ts
 *
 * Dates are IST calendar days stored as YYYY-MM-DD. Arithmetic is done in UTC
 * on the date string so no browser/server timezone can shift a promise by a day.
 */
import { daysBetween, isIsoDate, todayIST } from './shared';

/** Chips shown in the CRM modal. 0 = today. */
export const PROMISE_PRESET_DAYS = [0, 1, 3, 7, 15, 30] as const;
export const MAX_PROMISE_DAYS = 365;

export type PromiseStatus = 'none' | 'upcoming' | 'today' | 'overdue';

export function addDaysIso(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(days)) return '';
  return new Date(t + Math.trunc(days) * 86_400_000).toISOString().slice(0, 10);
}

/** Resolve a picked day count against today (IST). */
export function promiseDateFromDays(today: string, days: number): string {
  return addDaysIso(today, days);
}

/** 0–365 integer, or null when invalid/blank. */
export function normalizePromiseDays(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > MAX_PROMISE_DAYS) return null;
  return n;
}

/** Convert a concrete promise date to a day count, or null if out of range. */
export function promiseDaysFromDate(today: string, date: string): number | null {
  if (!isIsoDate(date)) return null;
  const days = daysBetween(today, date);
  if (!Number.isFinite(days) || days < 0 || days > MAX_PROMISE_DAYS) return null;
  return days;
}

export function promiseDaysRemaining(date: string | null | undefined, today: string): number | null {
  if (!date || !isIsoDate(date)) return null;
  return daysBetween(today, date);
}

export function promiseStatus(date: string | null | undefined, today: string): PromiseStatus {
  const days = promiseDaysRemaining(date, today);
  if (days === null) return 'none';
  if (days > 0) return 'upcoming';
  if (days === 0) return 'today';
  return 'overdue';
}

/** "today" / "in 3d" / "5d overdue" — short badge suffix. */
export function promiseStatusLabel(date: string | null | undefined, today: string): string {
  const days = promiseDaysRemaining(date, today);
  if (days === null) return '';
  if (days === 0) return 'today';
  if (days > 0) return `in ${days}d`;
  return `${Math.abs(days)}d overdue`;
}
