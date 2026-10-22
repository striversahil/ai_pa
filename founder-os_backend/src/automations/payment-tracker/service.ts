/**
 * Payment Tracker — service: paste imports, ledger matching, ageing math.
 * Persistence via the shared prisma shim (D1 on the Worker, Postgres/Prisma on
 * the Express alt runtime). Dashboard payload is KV-cached; every write path
 * invalidates `PAYMENT_CACHE_PREFIX` (see accounts/service.ts for the pattern).
 */
import { prisma } from '../../shared/prisma';
import { cached, cacheDelPrefix } from '../../shared/cache';
import type {
  CustomerAgeingRow, DebtorImportReport, CollectionImportReport,
  LiveCollection, LiveInvoice, PaymentTrackerPayload,
} from './types';
import { parseCollectionsTsv, parseDebtorsTsv } from './parse';
import { normalizeCustomerName, normalizeInvoiceNo } from './types';

export const PAYMENT_CACHE_PREFIX = 'payment-tracker:data:v1:';
const PAYMENT_TTL_MS = 5 * 60 * 1000;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Today's date in IST as YYYY-MM-DD (ageing is computed against this). */
export function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const t1 = Date.parse(a + 'T00:00:00Z');
  const t2 = Date.parse(b + 'T00:00:00Z');
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return 0;
  return Math.round((t2 - t1) / 86_400_000);
}

function bucketForDays(days: number): LiveInvoice['bucket'] {
  if (days <= 30) return 'D0';
  if (days <= 60) return 'D31';
  if (days <= 90) return 'D61';
  if (days <= 180) return 'D91';
  return 'D181';
}

export class PaymentTrackerError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Debtor text fields: newest paste wins when the cell is non-blank. */
function pickText(existing: string | null | undefined, next: string): string {
  const v = String(next ?? '').trim();
  return v !== '' && v !== '—' ? v : String(existing ?? '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Debtor import (upsert/append by invoiceNo + customerName)
// ─────────────────────────────────────────────────────────────────────────────

export async function importDebtors(text: string, importedBy: string): Promise<DebtorImportReport> {
  const { rows, headerRowFound, totalLines, skipped } = parseDebtorsTsv(text);
  if (rows.length === 0) {
    throw new PaymentTrackerError(
      headerRowFound
        ? 'No valid invoice rows in the pasted data (each row needs an invoice no + customer)'
        : 'Could not find the header row (needs "Customer Name" + "Invoice No." columns) — copy the sheet in Excel from the header row down',
    );
  }

  const now = todayIST();

  // Single-load everything the import needs: existing invoices + collections.
  const existingInvoices: any[] = await prisma.debtorInvoice.findMany({ where: { deleted: false } }) as any[];
  const invoiceByKey = new Map<string, any>();
  for (const inv of existingInvoices) {
    invoiceByKey.set(normalizeInvoiceNo(inv.invoiceNo).toLowerCase() + '|' + normalizeCustomerName(inv.customerName).toLowerCase(), inv);
  }
  const allCollections: any[] = await prisma.paymentCollection.findMany({ where: { deleted: false } }) as any[];
  // Ledger currently resolved to each existing invoice.
  const ledgerTotals = new Map<string, number>();
  // Unmatched collections keyed by their pasted invoice no (candidate bookings).
  const unmatchedByInvoiceNo = new Map<string, any[]>();
  for (const c of allCollections) {
    if (c.resolvedInvoiceId) {
      const k = String(c.resolvedInvoiceId);
      ledgerTotals.set(k, (ledgerTotals.get(k) || 0) + (Number(c.amount) || 0));
      continue;
    }
    const key = normalizeInvoiceNo(c.invoiceNo || '').toLowerCase();
    if (key && !unmatchedByInvoiceNo.has(key)) unmatchedByInvoiceNo.set(key, []);
    if (key) unmatchedByInvoiceNo.get(key)!.push(c);
  }

  let created = 0;
  let updated = 0;
  let rebooked = 0;
  // In-place ledger bookkeeping so multi-row pastes of the same invoice stack.
  const ledgerTotalsWork = new Map(ledgerTotals);

  for (const row of rows) {
    const customerName = normalizeCustomerName(row.customerName);
    const invoiceNo = normalizeInvoiceNo(row.invoiceNo);
    const key = invoiceNo.toLowerCase() + '|' + customerName.toLowerCase();
    const existing: any = invoiceByKey.get(key);
    const nowBooking = unmatchedByInvoiceNo.get(invoiceNo.toLowerCase()) || [];
    unmatchedByInvoiceNo.delete(invoiceNo.toLowerCase());
    const authoritativeBase = !row.baseReceivedBlank;

    if (!existing) {
      const newId = crypto.randomUUID();
      // Collections whose pasted invoice no matches this NEW invoice get
      // booked onto it. Snapshot rule: only a paste with a numeric
      // "Amount Received" (> 0) is authoritative (already includes ledgered
      // money) — blank/—/0 keeps collectedAtImport at 0 so ledger money
      // flows through the delta instead of being swallowed.
      let snapshot = 0;
      for (const c of nowBooking) {
        if (authoritativeBase) snapshot += Number(c.amount) || 0;
        await prisma.paymentCollection.update({
          where: { id: String(c.id) },
          data: { matchStatus: 'invoice', resolvedInvoiceId: newId },
        });
        rebooked++;
      }
      await prisma.debtorInvoice.create({
        data: {
          id: newId,
          customerName, invoiceNo,
          invoiceDate: row.invoiceDate ?? null,
          creditPeriodDays: row.creditPeriodDays ?? null,
          dueDate: row.dueDate ?? null,
          invoiceAmount: row.invoiceAmount,
          baseReceived: round2(row.baseReceived),
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
      invoiceByKey.set(key, { id: newId });
      ledgerTotalsWork.set(newId, snapshot);
      created++;
      continue;
    }

    // Existing invoice: merge (money columns override, blank text cells
    // keep their stored value). Snapshot rule as above: only a numeric
    // "Amount Received" paste is treated as authoritative and re-snapshots
    // the ledger; blank/— pastes zero the base so ledger money survives.
    const invoiceId = String(existing.id);
    let snapshot = ledgerTotalsWork.get(invoiceId) || 0;
    for (const c of nowBooking) {
      if (authoritativeBase) snapshot += Number(c.amount) || 0;
      await prisma.paymentCollection.update({
        where: { id: String(c.id) },
        data: { matchStatus: 'invoice', resolvedInvoiceId: invoiceId },
      });
      rebooked++;
    }
    if (authoritativeBase) {
      ledgerTotalsWork.set(invoiceId, snapshot);
    }

    await prisma.debtorInvoice.update({
      where: { id: invoiceId },
      data: {
        invoiceDate: row.invoiceDate ?? existing.invoiceDate ?? null,
        creditPeriodDays: row.creditPeriodDays ?? existing.creditPeriodDays ?? null,
        dueDate: row.dueDate ?? existing.dueDate ?? null,
        invoiceAmount: row.invoiceAmount || Number(existing.invoiceAmount) || 0,
        baseReceived: round2(row.baseReceived),
        collectedAtImport: round2(authoritativeBase ? snapshot : 0),
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
        updatedAt: new Date(),
      },
    });
    updated++;
  }

  await invalidatePaymentCache();
  return {
    parsed: rows.length,
    created, updated, rebooked,
    skippedLines: skipped.length,
    skipped,
  } as unknown as DebtorImportReport;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collections import (append; exact re-pastes are deduped silently)
// ─────────────────────────────────────────────────────────────────────────────

function collectionDedupKey(r: {
  collectionDate: string | null; customerName: string; invoiceNo: string;
  amount: number; mode: string; remarks: string;
}): string {
  return [
    r.collectionDate ?? '', r.customerName.toLowerCase(), normalizeInvoiceNo(r.invoiceNo).toLowerCase(),
    String(r.amount), (r.mode || '').toLowerCase(), (r.remarks || '').toLowerCase(),
  ].join('|');
}

export async function importCollections(text: string, importedBy: string): Promise<CollectionImportReport> {
  const { rows, headerRowFound, totalLines, skipped } = parseCollectionsTsv(text);
  if (rows.length === 0) {
    throw new PaymentTrackerError(
      headerRowFound
        ? 'No valid collection rows in the pasted data (each row needs a customer + amount)'
        : 'Could not find the header row (needs "Customer Name" + "Amount Received" columns) — copy the collections sheet in Excel from the header row down',
    );
  }

  // Whole-ledger single load for matching (dashboards are hundreds of rows).
  const invoices: any[] = await prisma.debtorInvoice.findMany({ where: { deleted: false } }) as any[];
  const byInvoiceNo = new Map<string, any[]>();
  const byCustomer = new Map<string, any[]>();
  for (const inv of invoices) {
    const noKey = normalizeInvoiceNo(inv.invoiceNo).toLowerCase();
    if (!byInvoiceNo.has(noKey)) byInvoiceNo.set(noKey, []);
    byInvoiceNo.get(noKey)!.push(inv);
    const custKey = normalizeCustomerName(inv.customerName).toLowerCase();
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

  const existingKeys: any[] = await prisma.paymentCollection.findMany({ where: { deleted: false } }) as any[];
  const existingDedup = new Set<string>();
  for (const c of existingKeys) if (c.dedupKey) existingDedup.add(String(c.dedupKey));

  let created = 0;
  let duplicated = 0;
  let matchedByInvoice = 0;
  let matchedByCustomer = 0;
  let unmatched = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    const key = collectionDedupKey(row);
    if (seen.has(key) || existingDedup.has(key)) { duplicated++; continue; }
    seen.add(key);

    const customerName = normalizeCustomerName(row.customerName);
    const invoiceNo = normalizeInvoiceNo(row.invoiceNo);
    let matchStatus = 'none';
    let resolvedInvoiceId: string | null = null;

    if (invoiceNo && byInvoiceNo.has(invoiceNo.toLowerCase())) {
      matchStatus = 'invoice';
      resolvedInvoiceId = String(byInvoiceNo.get(invoiceNo.toLowerCase())![0].id);
    }
    if (!resolvedInvoiceId) {
      // Customer fallback: the customer's OLDEST OPEN invoice (due date asc).
      const open = (byCustomer.get(customerName.toLowerCase()) || [])
        .find((inv) => (Number(inv.invoiceAmount) || 0) - (Number(inv.baseReceived) || 0) > 0.005);
      if (open) { matchStatus = 'customer'; resolvedInvoiceId = String(open.id); }
    }
    if (matchStatus === 'invoice') matchedByInvoice++;
    else if (matchStatus === 'customer') matchedByCustomer++;
    else unmatched++;

    await prisma.paymentCollection.create({
      data: {
        id: crypto.randomUUID(),
        customerName,
        invoiceNo,
        collectionDate: row.collectionDate ?? null,
        amount: round2(row.amount),
        mode: row.mode || '',
        remarks: row.remarks || '',
        weekStart: row.weekStart || '',
        matchStatus,
        resolvedInvoiceId,
        dedupKey: key,
        importedBy: importedBy || '',
      },
    });
    created++;
  }

  await invalidatePaymentCache();
  return {
    parsed: rows.length,
    created, updated: 0, rebooked: 0,
    skippedLines: skipped.length + duplicated,
    skipped,
    duplicated,
    matchedByInvoice, matchedByCustomer, unmatched,
  } as unknown as CollectionImportReport;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard payload (KV-cached)
// ─────────────────────────────────────────────────────────────────────────────

async function invalidatePaymentCache(): Promise<void> {
  await cacheDelPrefix(PAYMENT_CACHE_PREFIX);
}

export async function getPaymentTrackerData(): Promise<PaymentTrackerPayload> {
  return cached(`${PAYMENT_CACHE_PREFIX}full`, PAYMENT_TTL_MS, computePayload) as Promise<PaymentTrackerPayload>;
}

async function computePayload(): Promise<PaymentTrackerPayload> {
  const today = todayIST();
  const invoiceRows: any[] = await prisma.debtorInvoice.findMany({ where: { deleted: false } }) as any[];
  const collRows: any[] = await prisma.paymentCollection.findMany({ where: { deleted: false } }) as any[];

  const ledgerByInvoice = new Map<string, number>();
  for (const c of collRows) {
    if (!c.resolvedInvoiceId) continue;
    const k = String(c.resolvedInvoiceId);
    ledgerByInvoice.set(k, (ledgerByInvoice.get(k) || 0) + (Number(c.amount) || 0));
  }

  const liveInvoices: LiveInvoice[] = invoiceRows.map((inv) => {
    const id = String(inv.id);
    const ledgerReceived = ledgerByInvoice.get(id) || 0;
    // Drift-free effective received: pasted base + ledger delta since the
    // last debtor import snapshot. Ledgered money beyond the invoice amount
    // shows up as a NEGATIVE balance → advance received.
    const delta = ledgerReceived - (Number(inv.collectedAtImport) || 0);
    const effectiveReceived = round2((Number(inv.baseReceived) || 0) + delta);
    const invoiceAmount = round2(Number(inv.invoiceAmount) || 0);
    const balance = round2(invoiceAmount - effectiveReceived);
    const due = String(inv.dueDate || '');
    const daysOverdue = /^\d{4}-\d{2}-\d{2}$/.test(due) ? daysBetween(today, due) : null;
    return {
      id,
      customerName: inv.customerName,
      invoiceNo: inv.invoiceNo,
      invoiceDate: inv.invoiceDate ?? null,
      creditPeriodDays: inv.creditPeriodDays ?? null,
      dueDate: due || null,
      invoiceAmount,
      baseReceived: round2(Number(inv.baseReceived) || 0),
      ledgerReceived: round2(ledgerReceived),
      effectiveReceived,
      balance,
      daysOverdue,
      bucket: balance < -0.005 ? 'PAID' : (daysOverdue == null ? 'NOT_DUE' : bucketForDays(daysOverdue)),
      lastCallDate: inv.lastCallDate ?? null,
      callStatus: inv.callStatus || '',
      paymentStatus: inv.paymentStatus || '',
      remarks: inv.remarks || '',
      accountStatus: inv.accountStatus || '',
      mis: inv.mis || '',
      accountsRemarks: inv.accountsRemarks || '',
      employee: inv.employee || '',
      state: inv.state || '',
      region: inv.region || '',
      ledgerLink: inv.ledgerLink || '',
      lastImportAt: inv.lastImportAt ?? null,
      importedBy: inv.importedBy || '',
    };
  });

  // ── Per-customer ageing ───────────────────────────────────────────────────
  const customersMap = new Map<string, CustomerAgeingRow>();
  for (const inv of liveInvoices) {
    const key = inv.customerName;
    let row = customersMap.get(key);
    if (!row) {
      row = {
        customerName: key,
        totalReceivable: 0, notDue: 0, bucket0to30: 0, bucket31to60: 0,
        bucket61to90: 0, bucket91to180: 0, bucketAbove180: 0,
        grossDue: 0, advanceReceived: 0, netDue: 0, invoiceCount: 0,
      };
      customersMap.set(key, row);
    }
    row.invoiceCount++;
    row.totalReceivable = round2(row.totalReceivable + inv.balance);
    if (inv.balance < -0.005) {
      row.advanceReceived = round2(row.advanceReceived + (-inv.balance));
    } else if (inv.bucket === 'NOT_DUE') {
      row.notDue = round2(row.notDue + inv.balance);
    } else {
      row.grossDue = round2(row.grossDue + inv.balance);
      switch (inv.bucket) {
        case 'D0': row.bucket0to30 = round2(row.bucket0to30 + inv.balance); break;
        case 'D31': row.bucket31to60 = round2(row.bucket31to60 + inv.balance); break;
        case 'D61': row.bucket61to90 = round2(row.bucket61to90 + inv.balance); break;
        case 'D91': row.bucket91to180 = round2(row.bucket91to180 + inv.balance); break;
        case 'D181': row.bucketAbove180 = round2(row.bucketAbove180 + inv.balance); break;
      }
    }
  }

  const customerRows = [...customersMap.values()].map((row) => ({
    ...row,
    netDue: round2(row.grossDue - row.advanceReceived),
  })).sort((a, b) => b.grossDue - a.grossDue || b.totalReceivable - a.totalReceivable);

  // ── Top-level summary (mirrors the founder's SUMMARY block) ───────────────
  const summary = {
    totalReceivable: 0, notDue: 0, grossDue: 0, advanceReceived: 0, netDue: 0,
    bucket0to30: 0, bucket31to60: 0, bucket61to90: 0, bucket91to180: 0,
    bucketAbove180: 0, above90Total: 0,
    invoiceCount: liveInvoices.length,
    collectionCount: collRows.length,
    customerCount: customerRows.length,
  };
  for (const row of customerRows) {
    summary.totalReceivable = round2(summary.totalReceivable + row.totalReceivable);
    summary.notDue = round2(summary.notDue + row.notDue);
    summary.grossDue = round2(summary.grossDue + row.grossDue);
    summary.advanceReceived = round2(summary.advanceReceived + row.advanceReceived);
    summary.bucket0to30 = round2(summary.bucket0to30 + row.bucket0to30);
    summary.bucket31to60 = round2(summary.bucket31to60 + row.bucket31to60);
    summary.bucket61to90 = round2(summary.bucket61to90 + row.bucket61to90);
    summary.bucket91to180 = round2(summary.bucket91to180 + row.bucket91to180);
    summary.bucketAbove180 = round2(summary.bucketAbove180 + row.bucketAbove180);
  }
  summary.above90Total = round2(summary.bucket91to180 + summary.bucketAbove180);
  summary.netDue = round2(summary.grossDue - summary.advanceReceived);

  const liveCollections: LiveCollection[] = collRows
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 2000)
    .map((c) => ({
      id: String(c.id),
      customerName: c.customerName,
      invoiceNo: c.invoiceNo || '',
      collectionDate: c.collectionDate ?? null,
      amount: round2(Number(c.amount) || 0),
      mode: c.mode || '',
      remarks: c.remarks || '',
      matchStatus: c.matchStatus || 'none',
      resolvedInvoiceId: c.resolvedInvoiceId ? String(c.resolvedInvoiceId) : null,
      createdAt: String(c.createdAt ?? ''),
    }));

  return {
    summary, customers: customerRows, invoices: liveInvoices, collections: liveCollections,
    meta: { asOfIST: today, totalInvoices: liveInvoices.length, totalCollections: collRows.length },
  };
}
