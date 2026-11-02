/**
 * Debtors Tracker — received money split by the invoice ageing bucket it
 * cleared on the collection date.
 *
 * The bucket is derived from the invoice due date at the moment of receipt
 * (before that receipt is applied), not from today's balance. This makes the
 * dashboard show whether money came from not-due, current or older dues.
 */
import {
  bucketForDays, daysBetween, isAdvanceCollection, isAdvanceRemark, isIsoDate, round2, weekStart,
} from './shared';
import type {
  ReceiptAgeingSplit, ReceiptBucketKey, ReceiptBucketWindow,
} from './types';

const BUCKET_KEYS: ReceiptBucketKey[] = [
  'NOT_DUE', 'D0', 'D31', 'D61', 'D91', 'D181', 'ADVANCE',
];

function emptyWindow(from: string, to: string): ReceiptBucketWindow {
  const buckets = {} as ReceiptBucketWindow['buckets'];
  for (const key of BUCKET_KEYS) buckets[key] = { amount: 0, count: 0 };
  return { total: 0, count: 0, from, to, buckets };
}

/** Shift an ISO day by N days (UTC math, no timezone drift). */
function shiftIso(iso: string, days: number): string {
  const t = Date.parse(iso + 'T00:00:00Z');
  if (!Number.isFinite(t)) return iso;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

function addReceipt(window: ReceiptBucketWindow, bucket: ReceiptBucketKey, amount: number): void {
  window.total = round2(window.total + amount);
  window.count += 1;
  const cell = window.buckets[bucket];
  cell.amount = round2(cell.amount + amount);
  cell.count += 1;
}

function bucketAtReceipt(invoice: any | undefined, collectionDate: string): ReceiptBucketKey {
  if (!invoice) return 'ADVANCE';
  const anchor = isIsoDate(invoice.dueDate)
    ? invoice.dueDate
    : isIsoDate(invoice.invoiceDate) ? invoice.invoiceDate : '';
  if (!anchor) return 'NOT_DUE';
  const days = daysBetween(anchor, collectionDate);
  if (days <= 0) return 'NOT_DUE';
  return bucketForDays(days);
}

/**
 * The bucket a single receipt cleared at its own collection date — the exact
 * rule the window totals use, exported so the payload can label each
 * collection row for the dashboard drill-down. `null` when undated/unmatched
 * beyond an advance.
 */
export function receiptBucketAt(
  invoice: any | undefined,
  collection: any,
): ReceiptBucketKey | null {
  const day = String(collection?.collectionDate || '');
  if (!isIsoDate(day)) return null;
  const advance =
    isAdvanceRemark(collection) || isAdvanceCollection(collection) || !collection?.resolvedInvoiceId;
  return advance ? 'ADVANCE' : bucketAtReceipt(invoice, day);
}

export function buildReceiptAgeing(
  invoiceRows: any[],
  collectionRows: any[],
  asOf: string,
): ReceiptAgeingSplit {
  const invoices = new Map<string, any>();
  for (const inv of invoiceRows) invoices.set(String(inv.id), inv);

  const weekStartIso = weekStart(asOf) ?? asOf;
  const lastWeekStartIso = shiftIso(weekStartIso, -7);
  const lastWeekEndIso = shiftIso(weekStartIso, -1);
  const monthPrefix = asOf.slice(0, 7);
  const split: ReceiptAgeingSplit = {
    week: emptyWindow(weekStartIso, asOf),
    lastWeek: emptyWindow(lastWeekStartIso, lastWeekEndIso),
    month: emptyWindow(`${monthPrefix}-01`, asOf),
  };

  for (const c of collectionRows) {
    const day = String(c.collectionDate || '');
    if (!isIsoDate(day)) continue;
    const inWeek = day >= weekStartIso && day <= asOf;
    const inLastWeek = day >= lastWeekStartIso && day <= lastWeekEndIso;
    const inMonth = day.startsWith(monthPrefix);
    if (!inWeek && !inLastWeek && !inMonth) continue;

    const amount = round2(Number(c.amount) || 0);
    const bucket = receiptBucketAt(invoices.get(String(c.resolvedInvoiceId)), c) ?? 'ADVANCE';

    if (inWeek) addReceipt(split.week, bucket, amount);
    if (inLastWeek) addReceipt(split.lastWeek, bucket, amount);
    if (inMonth) addReceipt(split.month, bucket, amount);
  }

  return split;
}
