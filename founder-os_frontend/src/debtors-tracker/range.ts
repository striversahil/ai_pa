/**
 * Debtors Tracker — "as of" range presets (pure, no React).
 *
 * A range is two point-in-time dates: `to` is the snapshot shown everywhere,
 * `from` is the comparison point (then-vs-now). `{ from: null, to: null }` is
 * the live view, so nothing changes for staff who never touch the picker.
 *
 * Day maths runs on ISO strings in UTC so no browser timezone can shift a
 * date by a day (same rule as `promise.ts`).
 */
import { todayIST } from "./promise";

export interface DebtorsRange {
  /** Comparison date ("then"); null = live (no comparison). */
  from: string | null;
  /** Snapshot date ("now"); null = today. */
  to: string | null;
}

export const LIVE_RANGE: DebtorsRange = { from: null, to: null };

export function addDaysIso(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + Math.trunc(days) * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetweenIso(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Indian financial year starts 1 April. */
export function fyStart(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return month >= 4 ? `${year}-04-01` : `${year - 1}-04-01`;
}

export function isLiveRange(range: DebtorsRange): boolean {
  return !range.from && !range.to;
}

/** Snapshot date actually requested (today when unset). */
export function rangeTo(range: DebtorsRange, today = todayIST()): string {
  return range.to && range.to < today ? range.to : today;
}

/** Comparison date actually requested (null when it cannot be a comparison). */
export function rangeFrom(range: DebtorsRange, today = todayIST()): string | null {
  const to = rangeTo(range, today);
  return range.from && range.from < to ? range.from : null;
}

export interface RangePreset {
  key: string;
  label: string;
  from: string | null;
  to: string | null;
}

/**
 * Presets relative to today. `firstInvoiceDate` powers "All time" (the ledger
 * cannot speak before it); when absent, All time falls back to the FY start.
 */
export function presetsFor(today: string, firstInvoiceDate?: string | null): RangePreset[] {
  const allTimeFrom =
    firstInvoiceDate && firstInvoiceDate < today ? firstInvoiceDate : fyStart(today);
  return [
    { key: "live", label: "Live", from: null, to: null },
    { key: "today", label: "Today", from: addDaysIso(today, -1), to: today },
    { key: "last30", label: "Last 30d", from: addDaysIso(today, -30), to: today },
    { key: "month", label: "This month", from: monthStart(today), to: today },
    { key: "fy", label: "This FY", from: fyStart(today), to: today },
    { key: "all", label: "All time", from: allTimeFrom, to: today },
  ];
}

/** Which preset (if any) the current range matches. */
export function activePresetKey(range: DebtorsRange, today: string, firstInvoiceDate?: string | null): string | null {
  if (isLiveRange(range)) return "live";
  const to = rangeTo(range, today);
  const from = rangeFrom(range, today);
  if (!from) return null;
  const hit = presetsFor(today, firstInvoiceDate).find((p) => p.from === from && p.to === to);
  return hit?.key ?? null;
}

/** Clamp a user-picked pair so the backend never has to reject it. */
export function normalizeRange(next: DebtorsRange, today = todayIST()): DebtorsRange {
  const to = next.to && next.to < today ? next.to : null;
  const effectiveTo = to ?? today;
  const from = next.from && next.from < effectiveTo ? next.from : null;
  return { from, to: to === today ? null : to };
}

/** Persist across reloads (the dashboard is the only reader). */
const STORAGE_KEY = "debtors:range:v1";

export function loadStoredRange(): DebtorsRange {
  try {
    const raw = globalThis?.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return LIVE_RANGE;
    const parsed = JSON.parse(raw) as DebtorsRange;
    return normalizeRange({ from: parsed?.from ?? null, to: parsed?.to ?? null });
  } catch {
    return LIVE_RANGE;
  }
}

export function storeRange(range: DebtorsRange): void {
  try {
    if (isLiveRange(range)) globalThis?.localStorage?.removeItem(STORAGE_KEY);
    else globalThis?.localStorage?.setItem(STORAGE_KEY, JSON.stringify(range));
  } catch {
    /* private mode / quota — the view still works for this session */
  }
}
