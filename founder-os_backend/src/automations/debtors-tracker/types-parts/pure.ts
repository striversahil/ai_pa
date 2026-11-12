// Extracted verbatim from types.ts by scripts/refactor/split-module.mjs.
// types.ts re-exports everything public here, so existing imports keep working.
import type { Bucket } from "./types";

export const DEBTOR_COLUMNS_LEGEND = [
  'S.No', 'Customer Name', 'Invoice No.', 'Invoice Date', 'Credit Period (Days)',
  'Due Date', 'Invoice Amount', 'Amount Received', 'Balance Receivable',
  'Days Overdue/Not Due', 'Ageing Bucket', 'Due Month (helper)', 'Invoice Week Start',
  'Due Week Start', 'Name', 'Number', 'Mail ID', 'Last Call date', 'Call Status',
  'Payment Status', 'Remarks', 'Status', 'MIS', 'Accounts Remarks', 'Employee',
  'State', 'Region', 'Ledger Link',
] as const;

export const COLLECTION_COLUMNS_LEGEND = [
  'S.No', 'Collection Date', 'Customer Name', 'Invoice No.', 'Amount Received',
  'Mode of Receipt', 'Remarks', 'Collection Week Start',
  'Receipt No. / Transaction ID (optional, strongest dedupe key)',
] as const;

/** Buckets for GROSS due amounts (due invoices only, per founder's sheet). */
export const BUCKETS: Bucket[] = ['D0', 'D31', 'D61', 'D91', 'D181'];

export const BUCKET_LABELS: Record<Bucket, string> = {
  NOT_DUE: 'Not Due',
  D0: '0–30 Days',
  D31: '31–60 Days',
  D61: '61–90 Days',
  D91: '91–180 Days',
  D181: 'Above 180',
};

/** Ageing bucket from the pasted sheet's own labels → canonical bucket. */
export function bucketFromPastedLabel(label: string): Bucket | null {
  const t = String(label || '').trim().toLowerCase();
  if (!t || t === '—' || t === '-') return null;
  if (t.includes('not due')) return 'NOT_DUE';
  if (t.includes('above 180') || t.includes('>180')) return 'D181';
  // "31-60", "31–60 Days", "61 to 90"…
  const m = t.match(/(\d+)\D+(\d+)/);
  if (m) {
    const lo = Number(m[1]);
    if (lo <= 0) return 'D0';
    if (lo <= 30) return 'D0';
    if (lo <= 60) return 'D31';
    if (lo <= 90) return 'D61';
    return 'D91';
  }
  return null;
}

/** Normalize a customer's pasted name for identity rules. */
export function normalizeCustomerName(name: string): string {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stable customer identity for the contact master + reminder log. */
export function normalizeCustomerKey(name: string): string {
  return normalizeCustomerName(name).toLowerCase();
}

export function normalizeInvoiceNo(no: string): string {
  return String(no || '')
    .replace(/\s+/g, ' ')
    .trim();
}
