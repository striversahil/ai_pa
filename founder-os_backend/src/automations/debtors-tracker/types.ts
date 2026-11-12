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


// Pieces split into ./types-parts/ (importable on their own); re-exported for compat.
export { DEBTOR_COLUMNS_LEGEND, COLLECTION_COLUMNS_LEGEND, BUCKETS, BUCKET_LABELS, bucketFromPastedLabel, normalizeCustomerName, normalizeCustomerKey, normalizeInvoiceNo } from "./types-parts/pure";
export type { DebtorRow, CollectionRow, InvoiceNoConflict, ImportConflict, DebtorImportReport, CollectionImportReport, DebtorsTrackerPayload, CustomerAgeingRow, LiveInvoice, Bucket, ReceiptBucketKey, ReceiptBucketCell, ReceiptBucketWindow, ReceiptAgeingSplit, LiveCollection, CustomerLedgerEntryType, CustomerLedgerEntry, CustomerLedgerTotals, CustomerLedger, LiveReminder } from "./types-parts/types";


