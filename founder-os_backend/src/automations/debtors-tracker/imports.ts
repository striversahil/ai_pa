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
import { prisma } from '../../shared/prisma';
import { invalidateDebtorsCache } from './cache';
import { ensureCustomers, isValidRegionInput, normalizeRegion } from './customers';
import { advanceDuplicateIds, findAdvancePlaceholder, realInvoiceMatches } from './dedupe';
import { DebtorsTrackerError } from './errors';
import { parseCollectionsTsv, parseDebtorsTsv, parseIndianDate } from './parse';
import { isAdvanceCollection, pickText, round2, todayIST } from './shared';
import type {
  CollectionImportReport, CollectionRow, DebtorImportReport, DebtorRow, ImportConflict,
} from './types';
import { normalizeCustomerName, normalizeInvoiceNo } from './types';

const invKeyOf = (no: string): string => normalizeInvoiceNo(no).toLowerCase();
const custKeyOf = (name: string): string => normalizeCustomerName(name).toLowerCase();
const compositeKey = (invoiceNo: string, customerName: string): string =>
  `${invKeyOf(invoiceNo)}|${custKeyOf(customerName)}`;

/**
 * Pasted received money for an invoice, in priority order:
 *  1. numeric "Amount Received" > 0 → that value (the sheet is authoritative)
 *  2. "Balance Receivable" present → invoiceAmount − balance (clamped ≥ 0)
 *  3. existing stored base (updates) or 0 (new invoice)
 */
function resolveBaseReceived(row: DebtorRow, existing: any | null): number {
  if (!row.baseReceivedBlank && row.baseReceived > 0.004) return round2(row.baseReceived);
  if (row.balanceReceivable != null && row.invoiceAmount > 0) {
    return round2(Math.max(0, row.invoiceAmount - row.balanceReceivable));
  }
  return round2(Number(existing?.baseReceived) || 0);
}

type UnmatchedIndex = Map<string, any[]>;

function pickUnmatched(index: UnmatchedIndex, invoiceNo: string, customerName: string): any[] {
  const list = index.get(invKeyOf(invoiceNo));
  if (!list || list.length === 0) return [];
  const sameCustomer = list.filter((c) => custKeyOf(c.customerName) === custKeyOf(customerName));
  return sameCustomer.length ? sameCustomer : list;
}

async function bookUnmatched(
  invoiceId: string,
  invoiceNo: string,
  customerName: string,
  index: UnmatchedIndex,
): Promise<number> {
  const rows = pickUnmatched(index, invoiceNo, customerName);
  if (!rows.length) return 0;
  index.delete(invKeyOf(invoiceNo));
  for (const c of rows) {
    await prisma.paymentCollection.update({
      where: { id: String(c.id) },
      data: { matchStatus: 'invoice', resolvedInvoiceId: invoiceId },
    });
  }
  return rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Debtor import
// ─────────────────────────────────────────────────────────────────────────────

export async function importDebtors(text: string, importedBy: string): Promise<DebtorImportReport> {
  const { rows, headerRowFound, skipped } = parseDebtorsTsv(text);
  if (rows.length === 0) {
    throw new DebtorsTrackerError(
      headerRowFound
        ? 'No valid invoice rows in the pasted data (each row needs an invoice no + customer)'
        : 'Could not find the header row (needs "Customer Name" + "Invoice No." columns) — copy the sheet in Excel from the header row down',
    );
  }

  const now = todayIST();

  // Include soft-deleted rows so a re-paste restores instead of colliding.
  const allInvoices: any[] = await prisma.debtorInvoice.findMany({}) as any[];
  const byComposite = new Map<string, any>();
  const byInvoiceNo = new Map<string, any[]>();
  for (const inv of allInvoices) {
    byComposite.set(compositeKey(inv.invoiceNo, inv.customerName), inv);
    const k = invKeyOf(inv.invoiceNo);
    if (!byInvoiceNo.has(k)) byInvoiceNo.set(k, []);
    byInvoiceNo.get(k)!.push(inv);
  }

  const allCollections: any[] = await prisma.paymentCollection.findMany({ where: { deleted: false } }) as any[];
  const ledgerTotals = new Map<string, number>();
  const unmatchedByInvoiceNo: UnmatchedIndex = new Map();
  for (const c of allCollections) {
    if (c.resolvedInvoiceId) {
      const k = String(c.resolvedInvoiceId);
      ledgerTotals.set(k, (ledgerTotals.get(k) || 0) + (Number(c.amount) || 0));
      continue;
    }
    const key = invKeyOf(c.invoiceNo || '');
    if (!key) continue;
    if (!unmatchedByInvoiceNo.has(key)) unmatchedByInvoiceNo.set(key, []);
    unmatchedByInvoiceNo.get(key)!.push(c);
  }

  let created = 0;
  let updated = 0;
  let rebooked = 0;
  let restored = 0;
  const conflicts: ImportConflict[] = [];
  const ledgerTotalsWork = new Map(ledgerTotals);

  for (const row of rows) {
    const customerName = normalizeCustomerName(row.customerName);
    const invoiceNo = normalizeInvoiceNo(row.invoiceNo);
    const key = compositeKey(invoiceNo, customerName);
    const existing: any = byComposite.get(key);

    if (!existing) {
      // Same invoice no already exists under a different customer: source
      // collision. Preserve both receivables but never create a silent third.
      const sameNo = byInvoiceNo.get(invKeyOf(invoiceNo)) || [];
      const other = sameNo.find((inv) => !inv.deleted && custKeyOf(inv.customerName) !== custKeyOf(customerName));
      if (other) {
        // Flag but keep both receivables: the composite key is authoritative
        // (founder decision). Never merge money across customers.
        conflicts.push({
          invoiceNo,
          customerName,
          existingCustomerName: other.customerName,
          reason: 'Same invoice no. already exists under another customer (kept separate)',
        });
      }

      const newId = crypto.randomUUID();
      let ledgerAtImport = 0;
      const matches = pickUnmatched(unmatchedByInvoiceNo, invoiceNo, customerName);
      for (const c of matches) {
        ledgerAtImport += Number(c.amount) || 0;
        await prisma.paymentCollection.update({
          where: { id: String(c.id) },
          data: { matchStatus: 'invoice', resolvedInvoiceId: newId },
        });
        rebooked++;
      }
      if (matches.length) unmatchedByInvoiceNo.delete(invKeyOf(invoiceNo));
      const snapshot = ledgerAtImport > 0 ? Math.min(resolveBaseReceived(row, null), ledgerAtImport) : 0;
      const baseReceived = resolveBaseReceived(row, null);

      await prisma.debtorInvoice.create({
        data: {
          id: newId,
          customerName,
          invoiceNo,
          invoiceDate: row.invoiceDate ?? null,
          creditPeriodDays: row.creditPeriodDays ?? null,
          dueDate: row.dueDate ?? null,
          invoiceAmount: row.invoiceAmount,
          baseReceived,
          collectedAtImport: round2(snapshot),
          contactName: row.contactName || '',
          contactPhone: row.contactPhone || '',
          contactMail: row.contactMail || '',
          lastCallDate: row.lastCallDate ?? null,
          callStatus: pickText('', row.callStatus),
          paymentStatus: pickText('', row.paymentStatus),
          remarks: pickText('', row.remarks),
          accountStatus: pickText('', row.accountStatus),
          mis: pickText('', row.mis),
          accountsRemarks: pickText('', row.accountsRemarks),
          employee: pickText('', row.employee),
          state: pickText('', row.state),
          region: pickText('', row.region),
          ledgerLink: pickText('', row.ledgerLink),
          importedBy: importedBy || '',
          lastImportAt: now,
        },
      });
      const createdRow = { id: newId, invoiceNo, customerName, deleted: false };
      byComposite.set(key, createdRow);
      if (!byInvoiceNo.has(invKeyOf(invoiceNo))) byInvoiceNo.set(invKeyOf(invoiceNo), []);
      byInvoiceNo.get(invKeyOf(invoiceNo))!.push(createdRow);
      ledgerTotalsWork.set(newId, snapshot);
      created++;
      continue;
    }

    // Existing row (active or soft-deleted) — update or restore.
    const invoiceId = String(existing.id);
    let ledgerAtImport = ledgerTotalsWork.get(invoiceId) || 0;
    const matches = pickUnmatched(unmatchedByInvoiceNo, invoiceNo, customerName);
    for (const c of matches) {
      ledgerAtImport += Number(c.amount) || 0;
      await prisma.paymentCollection.update({
        where: { id: String(c.id) },
        data: { matchStatus: 'invoice', resolvedInvoiceId: invoiceId },
      });
      rebooked++;
    }
    if (matches.length) unmatchedByInvoiceNo.delete(invKeyOf(invoiceNo));
    ledgerTotalsWork.set(invoiceId, ledgerAtImport);
    const baseReceived = resolveBaseReceived(row, existing);
    const snapshot = ledgerAtImport > 0 ? Math.min(baseReceived, ledgerAtImport) : 0;
    const wasDeleted = !!existing.deleted;

    await prisma.debtorInvoice.update({
      where: { id: invoiceId },
      data: {
        customerName,
        invoiceNo,
        invoiceDate: row.invoiceDate ?? existing.invoiceDate ?? null,
        creditPeriodDays: row.creditPeriodDays ?? existing.creditPeriodDays ?? null,
        dueDate: row.dueDate ?? existing.dueDate ?? null,
        invoiceAmount: row.invoiceAmount || Number(existing.invoiceAmount) || 0,
        baseReceived,
        collectedAtImport: round2(snapshot),
        contactName: pickText(existing.contactName, row.contactName),
        contactPhone: pickText(existing.contactPhone, row.contactPhone),
        contactMail: pickText(existing.contactMail, row.contactMail),
        lastCallDate: row.lastCallDate ?? existing.lastCallDate ?? null,
        callStatus: pickText(existing.callStatus, row.callStatus),
        paymentStatus: pickText(existing.paymentStatus, row.paymentStatus),
        remarks: pickText(existing.remarks, row.remarks),
        accountStatus: pickText(existing.accountStatus, row.accountStatus),
        mis: pickText(existing.mis, row.mis),
        accountsRemarks: pickText(existing.accountsRemarks, row.accountsRemarks),
        employee: pickText(existing.employee, row.employee),
        state: pickText(existing.state, row.state),
        region: pickText(existing.region, row.region),
        ledgerLink: pickText(existing.ledgerLink, row.ledgerLink),
        importedBy: pickText(existing.importedBy, importedBy || ''),
        lastImportAt: now,
        deleted: false,
        updatedAt: new Date(),
      },
    });
    if (wasDeleted) {
      existing.deleted = false;
      restored++;
    } else {
      updated++;
    }
  }

  await ensureCustomers(rows.map((r) => ({
    customerName: r.customerName,
    phone: r.contactPhone,
    email: r.contactMail,
    region: r.region,
  })), importedBy);
  await invalidateDebtorsCache();

  return {
    parsed: rows.length,
    created, updated, rebooked, restored, conflicts,
    skippedLines: skipped.length,
    skipped,
  };
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

function pickInvoiceForCollection(
  candidates: any[] | undefined,
  customerName: string,
): any | null {
  if (!candidates?.length) return null;
  if (candidates.length === 1) return candidates[0];
  const same = candidates.filter((inv) => !inv.deleted && custKeyOf(inv.customerName) === custKeyOf(customerName));
  return same.length === 1 ? same[0] : null;
}

export async function importCollections(text: string, importedBy: string): Promise<CollectionImportReport> {
  const { rows, headerRowFound, skipped } = parseCollectionsTsv(text);
  if (rows.length === 0) {
    throw new DebtorsTrackerError(
      headerRowFound
        ? 'No valid collection rows in the pasted data (each row needs a customer + amount)'
        : 'Could not find the header row (needs "Customer Name" + "Amount Received" columns) — copy the collections sheet in Excel from the header row down',
    );
  }

  const invoices: any[] = await prisma.debtorInvoice.findMany({ where: { deleted: false } }) as any[];
  const byInvoiceNo = new Map<string, any[]>();
  const byCustomer = new Map<string, any[]>();
  for (const inv of invoices) {
    const noKey = invKeyOf(inv.invoiceNo);
    if (!byInvoiceNo.has(noKey)) byInvoiceNo.set(noKey, []);
    byInvoiceNo.get(noKey)!.push(inv);
    const custKey = custKeyOf(inv.customerName);
    if (!byCustomer.has(custKey)) byCustomer.set(custKey, []);
    byCustomer.get(custKey)!.push(inv);
  }
  for (const list of byCustomer.values()) {
    list.sort((a, b) => {
      const da = a.dueDate || a.invoiceDate || '9999-12-31';
      const db = b.dueDate || b.invoiceDate || '9999-12-31';
      if (da !== db) return da < db ? -1 : 1;
      return String(a.id).localeCompare(String(b.id));
    });
  }

  // Existing receipts (including soft-deleted) for idempotent re-pastes.
  const existingRows: any[] = await prisma.paymentCollection.findMany({}) as any[];
  const existingByKey = new Map<string, any>();
  for (const c of existingRows) {
    if (c.dedupKey) existingByKey.set(String(c.dedupKey), c);
    // Rows imported before v2 used a different key layout (included remarks /
    // no receipt). Register the computed v2 key too so a re-paste upgrades the
    // row instead of duplicating it.
    const computed = collectionDedupKey({
      collectionDate: c.collectionDate ?? null,
      customerName: String(c.customerName || ''),
      invoiceNo: String(c.invoiceNo || ''),
      receiptNo: String(c.receiptNo || ''),
      amount: Number(c.amount) || 0,
      mode: String(c.mode || ''),
    });
    if (!existingByKey.has(computed)) existingByKey.set(computed, c);
  }
  // Effective received per invoice (sheet vs ledger) for the customer fallback.
  const ledgerTotals = new Map<string, number>();
  for (const c of existingRows) {
    if (c.deleted || !c.resolvedInvoiceId) continue;
    const k = String(c.resolvedInvoiceId);
    ledgerTotals.set(k, (ledgerTotals.get(k) || 0) + (Number(c.amount) || 0));
  }

  let created = 0;
  let duplicated = 0;
  let restored = 0;
  let merged = 0;
  let matchedByInvoice = 0;
  let matchedByCustomer = 0;
  let advances = 0;
  let unmatched = 0;
  const seen = new Set<string>();
  const conflicts: ImportConflict[] = [];

  for (const row of rows) {
    const key = collectionDedupKey(row);
    if (seen.has(key)) { duplicated++; continue; }
    seen.add(key);

    const customerName = normalizeCustomerName(row.customerName);
    const invoiceNo = normalizeInvoiceNo(row.invoiceNo);
    const amount = round2(row.amount);
    const mode = row.mode || '';
    const collectionDate = row.collectionDate ?? null;
    const receiptNo = row.receiptNo || '';
    const incoming = { customerName, invoiceNo, receiptNo, collectionDate, amount, mode };
    let matchStatus = 'none';
    let resolvedInvoiceId: string | null = null;

    if (isAdvanceCollection({ invoiceNo })) {
      matchStatus = 'advance';
    } else {
      const candidates = byInvoiceNo.get(invKeyOf(invoiceNo));
      const picked = pickInvoiceForCollection(candidates, customerName);
      if (picked) {
        matchStatus = 'invoice';
        resolvedInvoiceId = String(picked.id);
      } else {
        if (invoiceNo && (candidates?.length || 0) > 1) {
          conflicts.push({
            invoiceNo,
            customerName,
            existingCustomerName: candidates!.map((c) => c.customerName).join(' / '),
            reason: 'Invoice no. is shared by multiple customers — receipt needs a customer match',
          });
        }
        const open = (byCustomer.get(custKeyOf(customerName)) || [])
          .find((inv) => {
            const received = Math.max(Number(inv.baseReceived) || 0, ledgerTotals.get(String(inv.id)) || 0);
            return (Number(inv.invoiceAmount) || 0) - received > 0.005;
          });
        if (open) {
          matchStatus = 'customer';
          resolvedInvoiceId = String(open.id);
        }
      }
    }

    // A placeholder is stale once the same money is already on a real invoice.
    // Never create or restore a second Advance row for that receipt.
    if (matchStatus === 'advance' && realInvoiceMatches(existingRows, incoming).length === 1) {
      duplicated++;
      continue;
    }

    let existing: any = existingByKey.get(key);
    let adopted = false;
    if (!existing && matchStatus !== 'advance') {
      const placeholder = findAdvancePlaceholder(existingRows, incoming) as any;
      if (placeholder) {
        existing = placeholder;
        adopted = true;
      }
    }

    if (existing) {
      // Same receipt key (or adopted advance placeholder): update in place.
      const wasDeleted = !!existing.deleted;
      const oldKey = String(existing.dedupKey || '');
      await prisma.paymentCollection.update({
        where: { id: String(existing.id) },
        data: {
          customerName,
          invoiceNo,
          receiptNo,
          collectionDate,
          amount,
          mode,
          remarks: row.remarks || '',
          weekStart: row.weekStart || '',
          matchStatus,
          resolvedInvoiceId,
          importedBy: importedBy || existing.importedBy || '',
          dedupKey: key,
          deleted: false,
        },
      });
      Object.assign(existing, {
        customerName, invoiceNo, receiptNo, collectionDate, amount, mode,
        remarks: row.remarks || '', weekStart: row.weekStart || '',
        matchStatus, resolvedInvoiceId, dedupKey: key, deleted: false,
      });
      if (oldKey && oldKey !== key) existingByKey.delete(oldKey);
      existingByKey.set(key, existing);
      if (adopted) merged++;
      else if (wasDeleted) restored++;
      else duplicated++;
    } else {
      const id = crypto.randomUUID();
      await prisma.paymentCollection.create({
        data: {
          id,
          customerName,
          invoiceNo,
          receiptNo,
          collectionDate,
          amount,
          mode,
          remarks: row.remarks || '',
          weekStart: row.weekStart || '',
          matchStatus,
          resolvedInvoiceId,
          dedupKey: key,
          importedBy: importedBy || '',
        },
      });
      const createdRow = {
        id, customerName, invoiceNo, receiptNo, collectionDate, amount, mode,
        remarks: row.remarks || '', weekStart: row.weekStart || '',
        matchStatus, resolvedInvoiceId, dedupKey: key,
        importedBy: importedBy || '', deleted: false,
        createdAt: new Date().toISOString(),
      };
      existingRows.push(createdRow);
      existingByKey.set(key, createdRow);
      created++;
    }

    if (matchStatus === 'invoice') matchedByInvoice++;
    else if (matchStatus === 'customer') matchedByCustomer++;
    else if (matchStatus === 'advance') advances++;
    else unmatched++;
  }

  // One pass over the final ledger: remove any leftover advance placeholders
  // that now duplicate exactly one real-invoice receipt.
  const activeAfter: any[] = await prisma.paymentCollection.findMany({ where: { deleted: false } }) as any[];
  const duplicateIds = advanceDuplicateIds(activeAfter);
  for (const id of duplicateIds) {
    await prisma.paymentCollection.update({ where: { id }, data: { deleted: true } });
  }
  merged += duplicateIds.length;

  await ensureCustomers(rows.map((r) => ({ customerName: r.customerName })), importedBy);
  await invalidateDebtorsCache();

  return {
    parsed: rows.length,
    created, updated: 0, rebooked: 0, restored, conflicts,
    skippedLines: skipped.length + duplicated,
    skipped,
    duplicated,
    matchedByInvoice, matchedByCustomer, advances, unmatched, merged,
  };
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

export type InvoiceEditableField = typeof INVOICE_EDITABLE_FIELDS[number];

export async function updateInvoiceFields(
  id: string,
  patch: Record<string, unknown>,
  allowed: readonly string[] = INVOICE_EDITABLE_FIELDS,
): Promise<void> {
  const existing: any = await prisma.debtorInvoice.findFirst({ where: { id, deleted: false } });
  if (!existing) throw new DebtorsTrackerError('Invoice not found', 404);

  const data: Record<string, unknown> = { updatedAt: new Date() };
  let region: string | undefined;
  for (const field of INVOICE_EDITABLE_FIELDS) {
    if (!allowed.includes(field)) continue;
    if (!(field in patch)) continue;
    if (field === 'lastCallDate') {
      const v = String(patch[field] ?? '').trim();
      data[field] = v === '' ? null : (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : parseIndianDate(v));
      continue;
    }
    if (field === 'region') {
      if (!isValidRegionInput(patch[field])) throw new DebtorsTrackerError('Region must be R1–R4 (or blank)', 400);
      region = normalizeRegion(patch[field]);
      data[field] = region;
      continue;
    }
    data[field] = String(patch[field] ?? '').slice(0, 2000);
  }
  if (Object.keys(data).length <= 1) {
    throw new DebtorsTrackerError('No editable fields supplied', 400);
  }
  await prisma.debtorInvoice.update({ where: { id }, data });
  if (region !== undefined) {
    // Region is customer-level: keep every invoice + the contact master aligned.
    await prisma.debtorInvoice.updateMany({
      where: { customerName: existing.customerName },
      data: { region, updatedAt: new Date() },
    });
    await prisma.paymentCustomer.updateMany({
      where: { customerKey: custKeyOf(existing.customerName) },
      data: { region, updatedAt: new Date() },
    });
  }
  await invalidateDebtorsCache();
}



/** Soft-delete a mis-imported invoice; its ledger collections go unmatched. */
export async function deleteInvoice(id: string): Promise<void> {
  const existing: any = await prisma.debtorInvoice.findFirst({ where: { id, deleted: false } });
  if (!existing) throw new DebtorsTrackerError('Invoice not found', 404);

  const booked: any[] = await prisma.paymentCollection.findMany({
    where: { resolvedInvoiceId: id, deleted: false },
  }) as any[];
  for (const c of booked) {
    await prisma.paymentCollection.update({
      where: { id: String(c.id) },
      data: { resolvedInvoiceId: null, matchStatus: 'none' },
    });
  }
  await prisma.debtorInvoice.update({
    where: { id },
    data: { deleted: true, updatedAt: new Date() },
  });
  await invalidateDebtorsCache();
}

export async function deleteCollection(id: string): Promise<void> {
  const existing: any = await prisma.paymentCollection.findFirst({ where: { id, deleted: false } });
  if (!existing) throw new DebtorsTrackerError('Collection not found', 404);
  await prisma.paymentCollection.update({
    where: { id },
    data: { deleted: true },
  });
  await invalidateDebtorsCache();
}

/** Wipe the tracker ledgers (contacts survive; reminders are derived). */
export async function resetDebtorsTracker(): Promise<{ invoices: number; collections: number; reminders: number }> {
  const reminders = await prisma.paymentReminder.deleteMany({});
  const collections = await prisma.paymentCollection.deleteMany({});
  const invoices = await prisma.debtorInvoice.deleteMany({});
  await invalidateDebtorsCache();
  return {
    invoices: Number((invoices as any)?.count) || 0,
    collections: Number((collections as any)?.count) || 0,
    reminders: Number((reminders as any)?.count) || 0,
  };
}

export type { CollectionRow };
