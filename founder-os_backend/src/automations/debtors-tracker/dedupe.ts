/**
 * Debtors Tracker — receipt identity and advance-placeholder dedupe.
 *
 * A collection's dedupe key includes its invoice no, but the accounts sheet
 * first books some receipts as "Advance" and later re-pastes the same money
 * against the real invoice no. The exact key therefore changes even though the
 * underlying receipt did not. These helpers identify that case without
 * collapsing genuine part-payments or two real invoices paid the same day.
 */
import { isAdvanceCollection, round2 } from './shared';
import { normalizeCustomerName } from './types';

export interface CollectionIdentity {
  id?: string | number;
  customerName?: string | null;
  invoiceNo?: string | null;
  receiptNo?: string | null;
  collectionDate?: string | null;
  amount?: number | null;
  mode?: string | null;
  matchStatus?: string | null;
  resolvedInvoiceId?: string | null;
  deleted?: boolean | null;
  createdAt?: string | Date | null;
}

const custKeyOf = (name: string | null | undefined): string =>
  normalizeCustomerName(String(name || '')).toLowerCase();
const receiptKeyOf = (no: string | null | undefined): string =>
  String(no || '').trim().toLowerCase();

/** Same money identity: customer + collection date + amount + mode. */
export function collectionFingerprint(r: CollectionIdentity): string {
  return [
    custKeyOf(r.customerName),
    r.collectionDate ?? '',
    String(round2(Number(r.amount) || 0)),
    String(r.mode || '').trim().toLowerCase(),
  ].join('|');
}

/** Two different non-empty receipt refs mean two distinct receipts. */
export function hasConflictingReceipts(a: CollectionIdentity, b: CollectionIdentity): boolean {
  const ar = receiptKeyOf(a.receiptNo);
  const br = receiptKeyOf(b.receiptNo);
  return ar !== '' && br !== '' && ar !== br;
}

export function isRealInvoiceCollection(r: CollectionIdentity): boolean {
  return !isAdvanceCollection(r) && String(r.invoiceNo || '').trim() !== '';
}

/** Active, unresolved customer advance (invoice no literally "Advance"). */
export function isAdvancePlaceholder(r: CollectionIdentity): boolean {
  return !r.deleted && !r.resolvedInvoiceId && isAdvanceCollection(r);
}

const oldestFirst = (a: CollectionIdentity, b: CollectionIdentity): number => {
  const ac = String(a.createdAt ?? '');
  const bc = String(b.createdAt ?? '');
  if (ac !== bc) return ac < bc ? -1 : 1;
  return String(a.id ?? '').localeCompare(String(b.id ?? ''));
};

export function realInvoiceMatches(
  rows: CollectionIdentity[],
  incoming: CollectionIdentity,
): CollectionIdentity[] {
  const fingerprint = collectionFingerprint(incoming);
  return rows.filter((r) =>
    !r.deleted
    && isRealInvoiceCollection(r)
    && !hasConflictingReceipts(r, incoming)
    && collectionFingerprint(r) === fingerprint,
  );
}

/** The active advance row this real-invoice receipt should replace, if any. */
export function findAdvancePlaceholder(
  rows: CollectionIdentity[],
  incoming: CollectionIdentity,
): CollectionIdentity | null {
  const fingerprint = collectionFingerprint(incoming);
  const candidates = rows
    .filter((r) =>
      isAdvancePlaceholder(r)
      && !hasConflictingReceipts(r, incoming)
      && collectionFingerprint(r) === fingerprint,
    )
    .sort(oldestFirst);
  return candidates[0] ?? null;
}

/**
 * Advance rows safe to soft-delete: each has exactly one real-invoice row with
 * the same customer/date/amount/mode and no conflicting receipt numbers.
 */
export function advanceDuplicateIds(rows: CollectionIdentity[]): string[] {
  const active = rows.filter((r) => !r.deleted);
  const ids = new Set<string>();
  for (const row of active) {
    if (!isAdvancePlaceholder(row) || row.id == null) continue;
    const matches = realInvoiceMatches(active.filter((r) => r.id !== row.id), row);
    if (matches.length === 1) ids.add(String(row.id));
  }
  return [...ids];
}
