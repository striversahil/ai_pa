/**
 * Payment Tracker — domain types + identity helpers.
 * Automation: `payment-tracker` (see index.ts / rule.json).
 *
 * Design (locked with the founder):
 * - Debtor data arrives as Excel-clipboard pastes of the accounts ageing
 *   sheet; upsert/append by (invoiceNo, customerName).
 * - Collections arrive as pastes of the receipts sheet; matched to invoices
 *   by invoice no, else the customer's oldest open invoice; else unmatched.
 * - Receiving math: effectiveReceived = baseReceived (pasted column at last
 *   debtor import) + (Σledger collections − collectedAtImport). This is the
 *   drift-free rule chosen to survive both "paste refreshed sheet" and
 *   "ledger-only" workflows without double-counting money.
 */

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
] as const;

export interface DebtorRow {
  customerName: string;
  invoiceNo: string;
  invoiceDate: string | null;
  creditPeriodDays: number | null;
  dueDate: string | null;
  invoiceAmount: number;
  /**
   * Parsed "Amount Received" (blank/— cell → 0). `baseReceivedBlank` is true
   * when the cell carried no numeric money — the importer then treats the
   * collections ledger as NOT included in the pasted base (see service.ts).
   */
  baseReceived: number;
  baseReceivedBlank: boolean;
  balanceReceivable: number | null;
  contactName: string;
  contactPhone: string;
  contactMail: string;
  lastCallDate: string | null;
  callStatus: string;
  paymentStatus: string;
  remarks: string;
  accountStatus: string;
  mis: string;
  accountsRemarks: string;
  employee: string;
  state: string;
  region: string;
  ledgerLink: string;
}

export interface CollectionRow {
  collectionDate: string | null;
  customerName: string;
  invoiceNo: string;
  amount: number;
  mode: string;
  remarks: string;
  weekStart: string;
}

export interface DebtorImportReport {
  /** Parsed invoice rows. */
  parsed: number;
  created: number;
  updated: number;
  /** Unmatched collections re-booked onto invoices by matching invoice no. */
  rebooked: number;
  skippedLines: number;
  skipped: string[];
}

export interface CollectionImportReport extends DebtorImportReport {
  duplicated: number;
  matchedByInvoice: number;
  matchedByCustomer: number;
  unmatched: number;
}

/** Live-updated dashboard payload — GET /api/payment-tracker/data. */
export interface PaymentTrackerPayload {
  summary: {
    totalReceivable: number;
    notDue: number;
    grossDue: number;
    advanceReceived: number;
    netDue: number;
    bucket0to30: number;
    bucket31to60: number;
    bucket61to90: number;
    bucket91to180: number;
    bucketAbove180: number;
    above90Total: number;
    invoiceCount: number;
    collectionCount: number;
    customerCount: number;
  };
  customers: CustomerAgeingRow[];
  invoices: LiveInvoice[];
  collections: LiveCollection[];
  meta: {
    asOfIST: string;
    totalInvoices: number;
    totalCollections: number;
  };
}

export interface CustomerAgeingRow {
  customerName: string;
  totalReceivable: number;
  notDue: number;
  bucket0to30: number;
  bucket31to60: number;
  bucket61to90: number;
  bucket91to180: number;
  bucketAbove180: number;
  grossDue: number;
  advanceReceived: number;
  netDue: number;
  invoiceCount: number;
}

export interface LiveInvoice {
  id: string;
  customerName: string;
  invoiceNo: string;
  invoiceDate: string | null;
  creditPeriodDays: number | null;
  dueDate: string | null;
  invoiceAmount: number;
  baseReceived: number;
  ledgerReceived: number;
  effectiveReceived: number;
  balance: number;
  daysOverdue: number | null;
  bucket: Bucket | 'PAID';
  lastCallDate: string | null;
  callStatus: string;
  paymentStatus: string;
  remarks: string;
  accountStatus: string;
  mis: string;
  accountsRemarks: string;
  employee: string;
  state: string;
  region: string;
  ledgerLink: string;
  lastImportAt: string | null;
  importedBy: string;
}

export type Bucket = 'NOT_DUE' | 'D0' | 'D31' | 'D61' | 'D91' | 'D181';

/** Buckets for GROSS due amounts (due invoices only, per founder's sheet). */
export const BUCKETS: Bucket[] = ['D0', 'D31', 'D61', 'D91', 'D181'];

export interface LiveCollection {
  id: string;
  customerName: string;
  invoiceNo: string;
  collectionDate: string | null;
  amount: number;
  mode: string;
  remarks: string;
  matchStatus: string;
  resolvedInvoiceId: string | null;
  createdAt: string;
}

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

export function normalizeInvoiceNo(no: string): string {
  return String(no || '')
    .replace(/\s+/g, ' ')
    .trim();
}
