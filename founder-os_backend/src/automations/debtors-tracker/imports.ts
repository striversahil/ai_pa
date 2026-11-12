/**
 * Debtors Tracker — paste imports, matching, manual corrections.
 *
 * Idempotency rules (founder decision):
 * - Receivables are keyed by invoice no WITHIN a customer. The same invoice no
 *   under another customer is a source-data conflict: report it, never merge
 *   or silently create a second receivable from the same paste row.
 * - Collections keep multiple part-payments; an optional receipt no. is the
 *   strongest dedupe key, else invoice no + date + amount + mode.
 * - A receipt first pasted as "Advance" and later re-pasted against a real
 *   invoice is adopted in place (same customer/date/amount/mode). Leftover
 *   advance placeholders with exactly one real receipt are soft-deleted.
 * - Soft-deleted rows are restored on re-import instead of failing the unique
 *   index.
 */
import type { CollectionRow } from './types';

// Pieces split into ./imports-parts/ (importable on their own); re-exported for compat.
export { importDebtors, importCollections, updateInvoiceFields, deleteInvoice, deleteCollection, resetDebtorsTracker } from "./imports-parts/io";
export { collectionDedupKey, INVOICE_EDITABLE_FIELDS, FOLLOW_UP_FIELDS } from "./imports-parts/pure";
export type { InvoiceEditableField } from "./imports-parts/types";

export type { CollectionRow };
