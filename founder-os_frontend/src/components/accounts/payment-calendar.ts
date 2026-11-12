// Pure logic behind the Payment Dues calendar + bucket pills.
//
// No React, no fetching: every helper here is a pure function of the payload the
// accounts dashboard already returns (`payments` = unresolved cycles), so the
// calendar can never disagree with the bill list about what is due when.
//
// Mirror note: the backend derives `bucket` / `daysOverdue` in
// `automations/accounts/service.ts` (toPaymentRow). This module only *reads*
// those values and groups by `dueDate` — it never re-implements the boundary.
import type { PaymentDueRow } from "./PaymentDues";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

import { inr } from "@/lib/format";
export { inr };

/**
 * Compact rupee notation for tight surfaces (top tab bar badges): 46,099 → ₹46K,
 * 1,00,000 → ₹1L, 2,50,00,000 → ₹2.5Cr. Full figures stay in the tooltip.
 * Indian grouping: 1 lakh = 1e5, 1 crore = 1e7.
 */
export { inrShort } from "@/lib/format";

/** Today in IST as YYYY-MM-DD — the same clock the backend buckets with. */
export function istToday(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** "2026-11-05" → "5 Nov". */
export { fmtDay } from "@/lib/format";

/** "2026-11-05" → "5 Nov 2026". */
export function fmtDayLong(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** Whole days from `a` to `b` (negative when b is before a). UTC-safe. */
export function daysBetween(a: string, b: string): number {
  const pa = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const pb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(pa) || Number.isNaN(pb)) return 0;
  return Math.round((pb - pa) / 86_400_000);
}

/** "2026-11-05" → "2026-11". */
export const monthOf = (date: string) => date.slice(0, 7);

/** Shift a "YYYY-MM" key by whole months (`delta` may be negative). */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const idx = (y || 1970) * 12 + ((m || 1) - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

/** "2026-11" → "November 2026". */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return key;
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

export interface DayCell {
  date: string;
  day: number;
  inMonth: boolean;
}

/**
 * Monday-first month grid, padded to whole weeks — exactly what the calendar
 * renders. Weeks are fixed at 7 so the header and the cells can never drift.
 */
export function monthGrid(key: string): DayCell[][] {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return [];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const monthDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const cells: DayCell[] = [];
  const push = (d: Date, inMonth: boolean) =>
    cells.push({ date: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth });
  for (let i = lead; i > 0; i--) push(new Date(Date.UTC(y, m - 1, 1 - i)), false);
  for (let d = 1; d <= monthDays; d++) push(new Date(Date.UTC(y, m - 1, d)), true);
  while (cells.length % 7 !== 0) {
    const next = new Date(Date.UTC(y, m - 1, monthDays + (cells.length - lead - monthDays) + 1));
    push(next, false);
  }
  const weeks: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Dues grouped by due date (YYYY-MM-DD). */
export function duesByDay(dues: PaymentDueRow[]): Map<string, PaymentDueRow[]> {
  const out = new Map<string, PaymentDueRow[]>();
  for (const d of dues) {
    if (d.bucket === "paid") continue;
    const k = d.dueDate.slice(0, 10);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(d);
  }
  for (const rows of out.values()) rows.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

/**
 * Credit-card statement dates grouped by day. The statement is when the amount
 * becomes known, so it is tracked separately from the payment due date.
 */
export function statementsByDay(dues: PaymentDueRow[]): Map<string, PaymentDueRow[]> {
  const out = new Map<string, PaymentDueRow[]>();
  for (const d of dues) {
    if (d.bucket === "paid" || !d.statementDate) continue;
    const k = d.statementDate.slice(0, 10);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(d);
  }
  return out;
}

export type DaySeverity = "none" | "later" | "week" | "overdue";

/** Worst bucket on a day — drives the pill colour (red beats amber beats grey). */
export function daySeverity(rows: PaymentDueRow[] | undefined, today: string, date?: string): DaySeverity {
  if (!rows || !rows.length) return "none";
  if (rows.some((r) => r.bucket === "overdue")) return "overdue";
  if (rows.some((r) => r.bucket === "week")) return "week";
  if (date && date < today) return "overdue";
  return "later";
}

/** Total rupee value due on a day (unknown amounts count as 0). */
export const sumAmount = (rows: PaymentDueRow[]) => rows.reduce((t, r) => t + (r.amount ?? 0), 0);

/** One-line "what this day means" — the native title / aria-label text. */
export function dayLabel(date: string, rows: PaymentDueRow[], statements: PaymentDueRow[], today: string): string {
  const bits: string[] = [];
  if (rows.length) {
    const overdue = rows.filter((r) => r.bucket === "overdue").length;
    bits.push(
      `${rows.length} payment${rows.length === 1 ? "" : "s"} due (${inr(sumAmount(rows))})` +
        (overdue ? ` · ${overdue} overdue` : ""),
    );
  } else {
    bits.push("No payments due");
  }
  if (statements.length) {
    bits.push(`statement date for ${statements.map((s) => s.title).join(", ")}`);
  }
  const delta = daysBetween(today, date);
  if (delta === 0) bits.push("today");
  else if (delta === 1) bits.push("tomorrow");
  return `${fmtDayLong(date)} — ${bits.join(" · ")}`;
}

/** Human countdown used on the day panel and in list chips. */
export function countdownText(row: PaymentDueRow): string {
  if (row.bucket === "overdue") return `Overdue ${row.daysOverdue}d`;
  if (row.daysUntil <= 0) return "Due today";
  if (row.daysUntil === 1) return "Due tomorrow";
  // Not in the 7-day reminder window yet — plain countdown, no second "Due <date>".
  return `in ${row.daysUntil}d`;
}

/**
 * Backdate log: everything still unpaid whose due date falls BEFORE the month
 * on screen. Those bills keep their original date (they are never re-dated), so
 * without this strip they would silently fall out of view once the month turns.
 */
export function carriedOverdue(dues: PaymentDueRow[], monthStart: string): PaymentDueRow[] {
  return dues
    .filter((d) => d.bucket === "overdue" && d.dueDate.slice(0, 10) < monthStart)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
}

/** Amount is only known once the statement lands — true while it is still ahead. */
export const awaitingStatement = (row: PaymentDueRow, today: string): boolean =>
  !!row.statementDate && row.statementDate.slice(0, 10) > today;
