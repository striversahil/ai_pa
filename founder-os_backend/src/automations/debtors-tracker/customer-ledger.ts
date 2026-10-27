/**
 * Debtors Tracker — complete customer statement.
 *
 * The dashboard payload is intentionally capped (collections 2,000 rows) and
 * grouped for dashboards, not statements. This module reads the customer's
 * own ledger rows, rebuilds every invoice/receipt line and reconciles the
 * balances the same way `buildLiveInvoices()` does:
 *   - invoice debit
 *   - itemized receipt credits (allocated, advance or unmatched)
 *   - a "received per ageing sheet" credit when the pasted sheet reports more
 *     received money than the itemized receipts ledger
 * Net receivable = invoice balances − advance/unmatched receipts.
 */
import { prisma } from '../../shared/prisma';
import { customerKeyOf } from './customers';
import { DebtorsTrackerError } from './errors';
import { buildLiveInvoices } from './ledger';
import { isAdvanceCollection, round2, todayIST } from './shared';
import type { CustomerLedger, CustomerLedgerEntry } from './types';

type LedgerLine = CustomerLedgerEntry & { sortDate: string; sortOrder: number };

const dateOnly = (value: unknown): string | null => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
};

export async function getCustomerLedger(customerKey: string): Promise<CustomerLedger> {
  const key = String(customerKey || '').trim().toLowerCase();
  if (!key) throw new DebtorsTrackerError('Customer key is required', 400);

  const [contact, invoiceRows, collectionRows] = await Promise.all([
    prisma.paymentCustomer.findFirst({ where: { customerKey: key } }),
    prisma.debtorInvoice.findMany({ where: { deleted: false } }),
    prisma.paymentCollection.findMany({ where: { deleted: false } }),
  ]);

  const invoices = (invoiceRows as any[]).filter((row) => customerKeyOf(row.customerName) === key);
  const collections = (collectionRows as any[]).filter((row) => customerKeyOf(row.customerName) === key);
  if (!contact && invoices.length === 0 && collections.length === 0) {
    throw new DebtorsTrackerError('Customer not found', 404);
  }

  const customerName = String(
    contact?.customerName || invoices[0]?.customerName || collections[0]?.customerName || '',
  );
  const today = todayIST();
  const { liveInvoices } = buildLiveInvoices(invoices, collections, today);
  const invoiceIds = new Set(liveInvoices.map((invoice) => String(invoice.id)));

  const lines: LedgerLine[] = [];
  for (const invoice of liveInvoices) {
    const date = dateOnly(invoice.invoiceDate);
    lines.push({
      id: `invoice:${invoice.id}`,
      date,
      type: 'invoice',
      reference: invoice.invoiceNo || '—',
      invoiceNo: invoice.invoiceNo || '',
      description: invoice.dueDate ? `Invoice · due ${invoice.dueDate}` : 'Invoice',
      debit: round2(invoice.invoiceAmount),
      credit: 0,
      balance: 0,
      status: invoice.bucket,
      sortDate: date || '9999-12-31',
      sortOrder: 0,
    });

    // The ageing sheet's "Amount Received" is not itemized. Credit the gap so
    // the running balance reconciles to the dashboard's invoice balance.
    const sheetCredit = round2(Math.max(0, invoice.baseReceived - invoice.ledgerReceived));
    if (sheetCredit > 0.005) {
      lines.push({
        id: `sheet:${invoice.id}`,
        date: date || dateOnly(invoice.lastImportAt),
        type: 'sheet_received',
        reference: invoice.invoiceNo || '—',
        invoiceNo: invoice.invoiceNo || '',
        description: 'Received per ageing sheet (not itemized)',
        debit: 0,
        credit: sheetCredit,
        balance: 0,
        status: 'sheet',
        sortDate: date || dateOnly(invoice.lastImportAt) || '9999-12-31',
        sortOrder: 1,
      });
    }
  }

  const unappliedReceiptIds: string[] = [];
  let itemizedReceived = 0;
  let sheetReceived = 0;
  for (const line of lines) if (line.type === 'sheet_received') sheetReceived = round2(sheetReceived + line.credit);

  for (const collection of collections) {
    const amount = round2(Number(collection.amount) || 0);
    const advance = isAdvanceCollection(collection);
    const applied = !advance && !!collection.resolvedInvoiceId && invoiceIds.has(String(collection.resolvedInvoiceId));
    const status = advance ? 'advance' : applied ? (collection.matchStatus === 'customer' ? 'customer' : 'invoice') : 'unmatched';
    const id = `receipt:${collection.id}`;
    if (!applied) unappliedReceiptIds.push(id);
    itemizedReceived = round2(itemizedReceived + amount);
    const date = dateOnly(collection.collectionDate) || dateOnly(collection.createdAt);
    lines.push({
      id,
      date,
      type: 'receipt',
      reference: String(collection.receiptNo || collection.invoiceNo || '—'),
      invoiceNo: String(collection.invoiceNo || ''),
      description: advance
        ? 'Customer advance'
        : applied
          ? (collection.mode ? `Receipt · ${collection.mode}` : 'Receipt')
          : 'Unmatched receipt',
      debit: 0,
      credit: amount,
      balance: 0,
      status,
      sortDate: date || '9999-12-31',
      sortOrder: 2,
    });
  }

  lines.sort((a, b) =>
    a.sortDate.localeCompare(b.sortDate)
    || a.sortOrder - b.sortOrder
    || a.reference.localeCompare(b.reference)
    || a.id.localeCompare(b.id));
  let balance = 0;
  for (const line of lines) {
    balance = round2(balance + line.debit - line.credit);
    line.balance = balance;
  }

  const totalInvoiced = round2(lines.reduce((sum, line) => sum + line.debit, 0));
  const totalReceived = round2(sheetReceived + itemizedReceived);
  const invoiceBalance = round2(liveInvoices.reduce((sum, invoice) => sum + invoice.balance, 0));
  const unappliedReceived = round2(lines.reduce(
    (sum, line) => sum + (line.type === 'receipt' && unappliedReceiptIds.includes(line.id) ? line.credit : 0),
    0,
  ));

  return {
    customerKey: key,
    customerName,
    phone: String(contact?.phone || ''),
    email: String(contact?.email || ''),
    region: String(contact?.region || ''),
    asOfIST: today,
    entries: lines.map(({ sortDate: _sortDate, sortOrder: _sortOrder, ...line }) => line),
    totals: {
      invoiceCount: liveInvoices.length,
      receiptCount: collections.length,
      totalInvoiced,
      itemizedReceived,
      sheetReceived,
      totalReceived,
      invoiceBalance,
      unappliedReceived,
      netReceivable: round2(invoiceBalance - unappliedReceived),
    },
    unappliedReceiptIds,
  };
}
