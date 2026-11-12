// Extracted verbatim from imports.ts by scripts/refactor/split-module.mjs.
// imports.ts re-exports everything public here, so existing imports keep working.
import { normalizeInvoiceNo, normalizeCustomerName } from "../types";
import type { DebtorRow } from "../types";
import { round2 } from "../shared";
import type { UnmatchedIndex } from "./types";

export const invKeyOf = (no: string): string => normalizeInvoiceNo(no).toLowerCase();

export const custKeyOf = (name: string): string => normalizeCustomerName(name).toLowerCase();

export const compositeKey = (invoiceNo: string, customerName: string): string =>
  `${invKeyOf(invoiceNo)}|${custKeyOf(customerName)}`;

/**
 * Pasted received money for an invoice, in priority order:
 *  1. numeric "Amount Received" > 0 → that value (the sheet is authoritative)
 *  2. "Balance Receivable" present → invoiceAmount − balance (clamped ≥ 0)
 *  3. existing stored base (updates) or 0 (new invoice)
 */
export function resolveBaseReceived(row: DebtorRow, existing: any | null): number {
  if (!row.baseReceivedBlank && row.baseReceived > 0.004) return round2(row.baseReceived);
  if (row.balanceReceivable != null && row.invoiceAmount > 0) {
    return round2(Math.max(0, row.invoiceAmount - row.balanceReceivable));
  }
  return round2(Number(existing?.baseReceived) || 0);
}

export function pickUnmatched(index: UnmatchedIndex, invoiceNo: string, customerName: string): any[] {
  const list = index.get(invKeyOf(invoiceNo));
  if (!list || list.length === 0) return [];
  const sameCustomer = list.filter((c) => custKeyOf(c.customerName) === custKeyOf(customerName));
  return sameCustomer.length ? sameCustomer : list;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collections import
// ─────────────────────────────────────────────────────────────────────────────

export function collectionDedupKey(r: {
  collectionDate: string | null; customerName: string; invoiceNo: string;
  receiptNo?: string; amount: number; mode: string;
}): string {
  const receipt = normalizeInvoiceNo(r.receiptNo || '').toLowerCase();
  if (receipt) return `receipt:${receipt}`;
  return [
    'row', custKeyOf(r.customerName), invKeyOf(r.invoiceNo),
    r.collectionDate ?? '', String(round2(r.amount)), (r.mode || '').toLowerCase(),
  ].join('|');
}

export function pickInvoiceForCollection(
  candidates: any[] | undefined,
  customerName: string,
): any | null {
  if (!candidates?.length) return null;
  if (candidates.length === 1) return candidates[0];
  const same = candidates.filter((inv) => !inv.deleted && custKeyOf(inv.customerName) === custKeyOf(customerName));
  return same.length === 1 ? same[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual corrections (row editor / delete mis-imports)
// ─────────────────────────────────────────────────────────────────────────────

/** Fields the dashboard row editor may set (everything the paste can't). */
export const INVOICE_EDITABLE_FIELDS = [
  'contactName', 'contactPhone', 'contactMail', 'lastCallDate', 'callStatus',
  'paymentStatus', 'remarks', 'accountStatus', 'mis', 'accountsRemarks',
  'employee', 'state', 'region', 'ledgerLink',
] as const;

/** Sales/follow-up users may only touch the follow-up subset. */
export const FOLLOW_UP_FIELDS = [
  'lastCallDate', 'callStatus', 'paymentStatus', 'remarks',
] as const;
