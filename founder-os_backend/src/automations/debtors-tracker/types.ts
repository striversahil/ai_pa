/**
 * Debtors Tracker — domain types + identity helpers.
 * Automation: `debtors-tracker` (see index.ts / rule.json).
 *
 * Design (locked with the founder):
 * - Debtor data arrives as Excel-clipboard pastes of the accounts ageing
 *   sheet; upsert/append by (invoiceNo, customerName). Invoice no is the
 *   matching key; the same invoice no under a DIFFERENT customer is reported
 *   as a conflict (source data collision) and never silently merged.
 * - Collections arrive as pastes of the receipts sheet (a cumulative
 *   history); matched to invoices by invoice no, else the customer's oldest
 *   open invoice; invoice no "Advance" is a customer advance, not a match.
 *   Re-pastes are idempotent: an optional receipt no. is the strongest key,
 *   else invoice no + date + amount + mode.
 * - Receiving math: effectiveReceived = max(baseReceived, Σledger
 *   collections), where baseReceived is the pasted amount (else
 *   invoiceAmount − balance). Taking the larger of sheet vs cumulative
 *   receipts is paste-order independent and never double-counts the history;
 *   new receipts register once the cumulative ledger exceeds the sheet.
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
  'Receipt No. / Transaction ID (optional, strongest dedupe key)',
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
  /** Receipt/transaction reference from the source export (optional). */
  receiptNo: string;
  amount: number;
  mode: string;
  remarks: string;
  weekStart: string;
}

/** A same-invoice-no / different-customer collision found during import. */
/** Resulting ledger collision: one invoice no. across multiple customers. */
export interface InvoiceNoConflict {
  invoiceNo: string;
  customers: string[];
}

export interface ImportConflict {
  invoiceNo: string;
  customerName: string;
  existingCustomerName: string;
  reason: string;
}

export interface DebtorImportReport {
  /** Parsed invoice rows. */
  parsed: number;
  created: number;
  updated: number;
  /** Unmatched collections re-booked onto invoices by matching invoice no. */
  rebooked: number;
  /** Soft-deleted rows brought back by this paste. */
  restored: number;
  /** Same invoice no under another customer — kept as separate receivables. */
  conflicts: ImportConflict[];
  skippedLines: number;
  skipped: string[];
}

export interface CollectionImportReport extends DebtorImportReport {
  /** Exact re-paste rows skipped because the receipt already exists. */
  duplicated: number;
  /** Advance placeholders adopted or soft-deleted as the same real receipt. */
  merged: number;
  matchedByInvoice: number;
  matchedByCustomer: number;
  advances: number;
  unmatched: number;
}

/** Live-updated dashboard payload — GET /api/debtors-tracker/data. */
export interface DebtorsTrackerPayload {
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
  /** Week/month receipts split by the invoice ageing bucket on receipt date. */
  receiptAgeing: ReceiptAgeingSplit;
  /** Latest reminder attempts (dry-run now, live later). */
  reminders: LiveReminder[];
  meta: {
    asOfIST: string;
    totalInvoices: number;
    totalCollections: number;
    /** True when WABA Cloud API credentials are present in the runtime. */
    reminderConfigured: boolean;
    /** 'live' only when credentials + the live flag are both set. */
    reminderMode: 'dry_run' | 'live';
    reminderRunDay: string;
    /** Same invoice no. under multiple customers — review, never auto-merge. */
    invoiceConflicts: InvoiceNoConflict[];
  };
}

export interface CustomerAgeingRow {
  customerName: string;
  /** Normalized identity key used by the contact master + reminder log. */
  customerKey: string;
  phone: string;
  email: string;
  region: string;
  whatsappOptIn: boolean;
  notes: string;
  /** CRM follow-up state ('' = unset) + latest remark mirror. Sales-editable. */
  situation: string;
  situationRemarks: string;
  situationUpdatedAt: string | null;
  situationUpdatedBy: string;
  /** Current promised-to-pay date (IST) + picked day count. */
  promisedDate: string | null;
  promisedDays: number | null;
  promisedAt: string | null;
  promisedBy: string;
  /** Dated CRM remark log (count + newest timestamp). */
  remarkCount: number;
  lastRemarkAt: string | null;
  lastReminderAt: string | null;
  lastReminderStatus: string;
  /** Latest follow-up across the customer's invoices (sales workflow). */
  lastFollowUpDate: string | null;
  lastFollowUpStatus: string;
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
  /** Latest invoice date across all of the customer's invoices (null = none dated). */
  lastInvoiceDate: string | null;
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
  /** Derived helpers (never pasted) — ageing inferred from the invoice date. */
  daysSinceInvoice: number | null;
  dueMonth: string;
  invoiceWeekStart: string | null;
  dueWeekStart: string | null;
  bucket: Bucket | 'PAID';
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
  lastImportAt: string | null;
  importedBy: string;
}

export type Bucket = 'NOT_DUE' | 'D0' | 'D31' | 'D61' | 'D91' | 'D181';

/** Buckets for GROSS due amounts (due invoices only, per founder's sheet). */
export const BUCKETS: Bucket[] = ['D0', 'D31', 'D61', 'D91', 'D181'];

export type ReceiptBucketKey = Bucket | 'ADVANCE';

export interface ReceiptBucketCell {
  amount: number;
  count: number;
}

export interface ReceiptBucketWindow {
  total: number;
  count: number;
  buckets: Record<ReceiptBucketKey, ReceiptBucketCell>;
}

/** Collections split by the invoice bucket they cleared on the receipt date. */
export interface ReceiptAgeingSplit {
  week: ReceiptBucketWindow;
  month: ReceiptBucketWindow;
}

export interface LiveCollection {
  id: string;
  customerName: string;
  invoiceNo: string;
  receiptNo: string;
  collectionDate: string | null;
  amount: number;
  mode: string;
  remarks: string;
  matchStatus: string;
  resolvedInvoiceId: string | null;
  createdAt: string;
}

export type CustomerLedgerEntryType = 'invoice' | 'sheet_received' | 'receipt';

/** One debit/credit line in a customer's complete statement. */
export interface CustomerLedgerEntry {
  id: string;
  /** ISO date where known; null entries sort last. */
  date: string | null;
  type: CustomerLedgerEntryType;
  reference: string;
  invoiceNo: string;
  description: string;
  debit: number;
  credit: number;
  /** Running balance after this line. */
  balance: number;
  /** Bucket for invoices; match status (invoice/customer/advance/none) for receipts. */
  status: string;
}

export interface CustomerLedgerTotals {
  invoiceCount: number;
  receiptCount: number;
  totalInvoiced: number;
  itemizedReceived: number;
  sheetReceived: number;
  totalReceived: number;
  /** Sum of invoice balances (after itemized receipts + sheet adjustments). */
  invoiceBalance: number;
  /** Advance + unmatched receipts, shown as credits but not applied to an invoice. */
  unappliedReceived: number;
  /** invoiceBalance − unappliedReceived. */
  netReceivable: number;
}

/** GET /api/debtors-tracker/customers/:customerKey/ledger */
export interface CustomerLedger {
  customerKey: string;
  customerName: string;
  phone: string;
  email: string;
  region: string;
  asOfIST: string;
  entries: CustomerLedgerEntry[];
  totals: CustomerLedgerTotals;
  /** Rows that are advances or unmatched receipts (still present in entries). */
  unappliedReceiptIds: string[];
}

export interface LiveReminder {
  id: string;
  customerKey: string;
  customerName: string;
  phone: string;
  channel: string;
  status: string;
  amount: number;
  invoiceCount: number;
  invoiceNos: string;
  oldestDueDate: string | null;
  message: string;
  error: string;
  runDay: string;
  trigger: string;
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

/** Stable customer identity for the contact master + reminder log. */
export function normalizeCustomerKey(name: string): string {
  return normalizeCustomerName(name).toLowerCase();
}

export function normalizeInvoiceNo(no: string): string {
  return String(no || '')
    .replace(/\s+/g, ' ')
    .trim();
}
