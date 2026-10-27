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

function emptyWindow(): ReceiptBucketWindow {
  const buckets = {} as ReceiptBucketWindow['buckets'];
  for (const key of BUCKET_KEYS) buckets[key] = { amount: 0, count: 0 };
  return { total: 0, count: 0, buckets };
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

export function buildReceiptAgeing(
  invoiceRows: any[],
  collectionRows: any[],
  asOf: string,
): ReceiptAgeingSplit {
  const invoices = new Map<string, any>();
  for (const inv of invoiceRows) invoices.set(String(inv.id), inv);

  const weekStartIso = weekStart(asOf) ?? asOf;
  const monthPrefix = asOf.slice(0, 7);
  const split: ReceiptAgeingSplit = { week: emptyWindow(), month: emptyWindow() };

  for (const c of collectionRows) {
    const day = String(c.collectionDate || '');
    if (!isIsoDate(day)) continue;
    const inWeek = day >= weekStartIso && day <= asOf;
    const inMonth = day.startsWith(monthPrefix);
    if (!inWeek && !inMonth) continue;

    const amount = round2(Number(c.amount) || 0);
    const advance = isAdvanceRemark(c) || isAdvanceCollection(c) || !c.resolvedInvoiceId;
    const bucket = advance
      ? 'ADVANCE'
      : bucketAtReceipt(invoices.get(String(c.resolvedInvoiceId)), day);

    if (inWeek) addReceipt(split.week, bucket, amount);
    if (inMonth) addReceipt(split.month, bucket, amount);
  }

  return split;
}
