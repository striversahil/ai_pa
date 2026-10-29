/**
 * Debtors Tracker — promised-to-pay date helpers (frontend mirror).
 * MIRROR: founder-os_backend/src/automations/debtors-tracker/promise.ts
 *
 * Same names + semantics; keep both copies in sync. Dates are IST calendar
 * days (YYYY-MM-DD) and arithmetic is UTC-based so no timezone shifts a day.
 */

/** Chips shown in the CRM modal. 0 = today. */
export const PROMISE_PRESET_DAYS = [0, 1, 3, 7, 15, 30] as const;
export const MAX_PROMISE_DAYS = 365;

export type PromiseStatus = "none" | "upcoming" | "today" | "overdue";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Today's date in IST as YYYY-MM-DD (same formula as the backend). */
export function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function daysBetween(from: string, to: string): number {
  const t1 = Date.parse(from + "T00:00:00Z");
  const t2 = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return 0;
  return Math.round((t2 - t1) / 86_400_000);
}

export function addDaysIso(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(days)) return "";
  return new Date(t + Math.trunc(days) * 86_400_000).toISOString().slice(0, 10);
}

export function promiseDateFromDays(today: string, days: number): string {
  return addDaysIso(today, days);
}

/** 0–365 integer, or null when invalid/blank. */
export function normalizePromiseDays(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > MAX_PROMISE_DAYS) return null;
  return n;
}

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
  if (days === null) return "none";
  if (days > 0) return "upcoming";
  if (days === 0) return "today";
  return "overdue";
}

/** "today" / "in 3d" / "5d overdue". */
export function promiseStatusLabel(date: string | null | undefined, today: string): string {
  const days = promiseDaysRemaining(date, today);
  if (days === null) return "";
  if (days === 0) return "today";
  if (days > 0) return `in ${days}d`;
  return `${Math.abs(days)}d overdue`;
}

/** "31 Oct 2026" (UTC on the stored date string). */
export function formatPromiseDate(iso: string | null | undefined, withWeekday = false): string {
  if (!iso || !isIsoDate(iso)) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return "";
  const day = `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return withWeekday ? `${WEEKDAYS[d.getUTCDay()]}, ${day}` : day;
}
