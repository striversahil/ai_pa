// Debtors Tracker — frontend payload types + display helpers.
// MIRROR: founder-os_backend/src/automations/debtors-tracker/types.ts — keep
// shapes + bucket semantics identical (backend is authoritative).

export type Bucket = "NOT_DUE" | "D0" | "D31" | "D61" | "D91" | "D181";

export type ReceiptBucketKey = Bucket | "ADVANCE";

export interface ReceiptBucketCell {
  amount: number;
  count: number;
}

export interface ReceiptBucketWindow {
  total: number;
  count: number;
  buckets: Record<ReceiptBucketKey, ReceiptBucketCell>;
}

export interface ReceiptAgeingSplit {
  week: ReceiptBucketWindow;
  month: ReceiptBucketWindow;
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
  bucket: Bucket | "PAID";
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

export interface CustomerAgeingRow {
  customerName: string;
  /** Normalized identity key for contacts + reminders. */
  customerKey: string;
  phone: string;
  email: string;
  region: string;
  whatsappOptIn: boolean;
  notes: string;
  /** CRM follow-up state ('' = unset) + free-text remarks. Sales-editable. */
  situation: string;
  situationRemarks: string;
  situationUpdatedAt: string | null;
  situationUpdatedBy: string;
  lastReminderAt: string | null;
  lastReminderStatus: string;
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

export interface LiveCollection {
  id: string;
  customerName: string;
  invoiceNo: string;
  /** Optional receipt / transaction reference from the source export. */
  receiptNo: string;
  collectionDate: string | null;
  amount: number;
  mode: string;
  remarks: string;
  matchStatus: string;
  resolvedInvoiceId: string | null;
  createdAt: string;
}

export type CustomerLedgerEntryType = "invoice" | "sheet_received" | "receipt";

export interface CustomerLedgerEntry {
  id: string;
  date: string | null;
  type: CustomerLedgerEntryType;
  reference: string;
  invoiceNo: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  status: string;
}

export interface CustomerLedgerTotals {
  invoiceCount: number;
  receiptCount: number;
  totalInvoiced: number;
  itemizedReceived: number;
  sheetReceived: number;
  totalReceived: number;
  invoiceBalance: number;
  unappliedReceived: number;
  netReceivable: number;
}

export interface CustomerLedger {
  customerKey: string;
  customerName: string;
  phone: string;
  email: string;
  region: string;
  asOfIST: string;
  entries: CustomerLedgerEntry[];
  totals: CustomerLedgerTotals;
  unappliedReceiptIds: string[];
}

export interface SummaryRow {
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

export interface InvoiceNoConflict {
  invoiceNo: string;
  customers: string[];
}

export interface DebtorsTrackerPayload {
  summary: SummaryRow;
  customers: CustomerAgeingRow[];
  invoices: LiveInvoice[];
  collections: LiveCollection[];
  receiptAgeing: ReceiptAgeingSplit;
  reminders: LiveReminder[];
  meta: {
    asOfIST: string;
    totalInvoices: number;
    totalCollections: number;
    reminderConfigured: boolean;
    reminderMode: "dry_run" | "live";
    reminderRunDay: string;
    invoiceConflicts: InvoiceNoConflict[];
  };
}

export const BUCKET_LABELS: Record<Bucket | "PAID", string> = {
  NOT_DUE: "Not Due",
  D0: "0–30 Days",
  D31: "31–60 Days",
  D61: "61–90 Days",
  D91: "91–180 Days",
  D181: "Above 180",
  PAID: "Paid",
};

/** CRM situation dropdown for the Customer Ageing tab (mirror of backend situation.ts). */
export const CUSTOMER_SITUATIONS = [
  "NOT_ANSWERING",
  "BUSY",
  "CALLBACK",
  "PROMISED_TO_PAY",
  "DISPUTED",
  "PAID_CLOSED",
] as const;

export type CustomerSituation = (typeof CUSTOMER_SITUATIONS)[number];

export const CUSTOMER_SITUATION_LABELS: Record<CustomerSituation, string> = {
  NOT_ANSWERING: "Not answering",
  BUSY: "Busy",
  CALLBACK: "Callback",
  PROMISED_TO_PAY: "Promised to pay",
  DISPUTED: "Disputed",
  PAID_CLOSED: "Paid / Closed",
};

export function situationLabel(situation: string): string {
  const key = String(situation || "").trim().toUpperCase();
  return (CUSTOMER_SITUATION_LABELS as Record<string, string>)[key] ?? "";
}

const inrFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** ₹ 12,69,045 — Indian grouping, zero decimals (per the founder's sheet). */
export function formatINR(n: number | null | undefined, dashZero = true): string {
  if (n == null || (!isFinite(n))) return "—";
  if (n === 0 && dashZero) return "—";
  const s = inrFmt.format(Math.round(Math.abs(n)));
  // A non-breaking space keeps the rupee symbol on the same line as its amount.
  return n < 0 ? `(₹\u00A0${s})` : `₹\u00A0${s}`;
}

/** Compact ₹1.2L / ₹45k label for miniature charts. */
export function formatCompactINR(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n <= 0) return "";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${Math.round(n / 1e3)}k`;
  return `₹${Math.round(n)}`;
}

/** Dashboard classification only: remarks contain the word "advance". */
export function isAdvanceReceipt(c: Pick<LiveCollection, "remarks">): boolean {
  return /\badvance\b/i.test(String(c.remarks || ""));
}

export function formatDays(days: number | null): string {
  if (days == null) return "—";
  if (days < 0) return "In " + Math.abs(days) + "d";
  return String(days);
}

export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${m[3]}/${months[Number(m[2]) - 1]}/${m[1].slice(2)}`;
}

/** MIRROR: backend src/automations/debtors-tracker/types.ts */
export function normalizeCustomerName(name: string): string {
  return String(name || "").replace(/\s+/g, " ").trim();
}

export function normalizeInvoiceNo(no: string): string {
  return String(no || "").replace(/\s+/g, " ").trim();
}

/** MIRROR: backend types.ts normalizeCustomerKey */
export function normalizeCustomerKey(name: string): string {
  return normalizeCustomerName(name).toLowerCase();
}
