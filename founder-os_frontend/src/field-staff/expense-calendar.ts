// expense-calendar.ts — pure logic behind the Field Staff day-wise expense calendar.
// No React, no fetching: groups the global expense rows by day (YYYY-MM-DD).
// Mirror note: intentionally similar in shape to accounts/payment-calendar.ts
// (month grid / IST today / short rupees) so the two calendars feel identical,
// but this module is standalone — never import from Accounts.

import type { FieldExpense } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export { inr } from "@/lib/format";

export function inrShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const v = Number(n);
  if (v === 0) return "₹0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  const trim = (x: number) => (x >= 10 ? String(Math.round(x)) : String(Math.round(x * 10) / 10));
  let scaled = abs;
  let unit = "";
  if (abs >= 1e7) { scaled = abs / 1e7; unit = "Cr"; }
  else if (abs >= 1e5) { scaled = abs / 1e5; unit = "L"; }
  else if (abs >= 1e3) { scaled = abs / 1e3; unit = "K"; }
  else return `${sign}₹${Math.round(abs)}`;
  if (unit === "K" && Math.round(scaled) >= 100) { scaled /= 100; unit = "L"; }
  if (unit === "L" && Math.round(scaled) >= 100) { scaled /= 100; unit = "Cr"; }
  return `${sign}₹${trim(scaled)}${unit}`;
}

/** Today in IST as YYYY-MM-DD. */
export function istToday(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** "2026-11-05" → "5 Nov". */
export { fmtDay } from "@/lib/format";

export function fmtDayLong(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "2026-11-05" → "2026-11". */
export const monthOf = (date: string) => date.slice(0, 7);

/** Shift a "YYYY-MM" key by whole months. */
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

/** Monday-first month grid, padded to whole weeks. */
export function monthGrid(key: string): DayCell[][] {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return [];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const monthDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
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

/** Expenses grouped by day (YYYY-MM-DD). */
export function expensesByDay(rows: FieldExpense[]): Map<string, FieldExpense[]> {
  const out = new Map<string, FieldExpense[]>();
  for (const r of rows) {
    const k = String((r as any).day ?? String((r as any).createdAt ?? "").slice(0, 10)).slice(0, 10);
    if (!k) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(r);
  }
  for (const list of out.values()) list.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  return out;
}

export const sumDay = (rows: FieldExpense[]) => rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);
