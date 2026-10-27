/**
 * Debtors Tracker — pure shared helpers (dates, buckets, money rounding).
 * No DB/framework imports so Worker, Express and tests can all use them.
 */
import type { Bucket } from './types';

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Today's date in IST as YYYY-MM-DD (ageing is computed against this). */
export function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const t1 = Date.parse(from + 'T00:00:00Z');
  const t2 = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return 0;
  return Math.round((t2 - t1) / 86_400_000);
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-22" → "Oct 2026" (Due Month helper column). */
export function monthLabel(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return '';
  return `${MONTH_NAMES[Number(m[2]) - 1] ?? ''} ${m[1]}`.trim();
}

/** Monday of the week containing the date (Invoice / Due Week Start helpers). */
export function weekStart(iso: string): string | null {
  const t = Date.parse(iso + 'T00:00:00Z');
  if (!Number.isFinite(t)) return null;
  const day = new Date(t).getUTCDay(); // 0=Sun
  const back = (day + 6) % 7; // days since Monday
  return new Date(t - back * 86_400_000).toISOString().slice(0, 10);
}

export function bucketForDays(days: number): Bucket {
  if (days <= 30) return 'D0';
  if (days <= 60) return 'D31';
  if (days <= 90) return 'D61';
  if (days <= 180) return 'D91';
  return 'D181';
}

/**
 * Customer advances are receipt rows the accounts sheet books against the
 * customer (not an invoice) — invoice no is literally "Advance". They must
 * never be matched to an open invoice; they reduce Net Due instead.
 */
export function isAdvanceCollection(c: { invoiceNo?: string | null; matchStatus?: string | null }): boolean {
  return String(c.matchStatus || '') === 'advance' || /^advance$/i.test(String(c.invoiceNo || '').trim());
}

/** Dashboard binary split: remarks contain the word "advance". Mirror: frontend isAdvanceReceipt. */
export function isAdvanceRemark(c: { remarks?: string | null }): boolean {
  return /\badvance\b/i.test(String(c.remarks || ''));
}

/** Debtor text fields: newest paste wins when the cell is non-blank. */
export function pickText(existing: string | null | undefined, next: string): string {
  const v = String(next ?? '').trim();
  return v !== '' && v !== '—' ? v : String(existing ?? '');
}
