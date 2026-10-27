/**
 * Debtors Tracker — pure ledger/ageing computation.
 * Shared by the dashboard payload and the reminder dry-run so both always
 * agree on effective received money and ageing buckets.
 */
import type { LiveInvoice } from './types';
import {
  bucketForDays, daysBetween, isAdvanceCollection, isIsoDate, monthLabel,
  round2, weekStart,
} from './shared';

export type CustomerDue = {
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
  oldestDueDate: string | null;
  /** Latest invoice date across all of the customer's invoices. */
  lastInvoiceDate: string | null;
};

export type LiveLedger = {
  liveInvoices: LiveInvoice[];
  advanceByCustomer: Map<string, number>;
};

export function buildLiveInvoices(
  invoiceRows: any[],
  collRows: any[],
  today: string,
): LiveLedger {
  const ledgerByInvoice = new Map<string, number>();
  const advanceByCustomer = new Map<string, number>();

  for (const c of collRows) {
    const amount = Number(c.amount) || 0;
    if (isAdvanceCollection(c)) {
      const key = String(c.customerName || '');
      advanceByCustomer.set(key, round2((advanceByCustomer.get(key) || 0) + amount));
      continue;
    }
    if (!c.resolvedInvoiceId) continue;
    const k = String(c.resolvedInvoiceId);
    ledgerByInvoice.set(k, (ledgerByInvoice.get(k) || 0) + amount);
  }

  const liveInvoices: LiveInvoice[] = invoiceRows.map((inv) => {
    const id = String(inv.id);
    const ledgerReceived = ledgerByInvoice.get(id) || 0;
    // The receipts sheet is a cumulative history: its per-invoice total is the
    // SAME money the ageing sheet already reports in Amount Received. Taking
    // the larger of sheet vs ledger is order-independent (debtors-first or
    // collections-first) and never double-counts the history; new receipts
    // still register once the cumulative ledger exceeds the sheet figure.
    const effectiveReceived = round2(Math.max(Number(inv.baseReceived) || 0, ledgerReceived));
    const invoiceAmount = round2(Number(inv.invoiceAmount) || 0);
    const balance = round2(invoiceAmount - effectiveReceived);
    const invoiceDate = isIsoDate(inv.invoiceDate) ? inv.invoiceDate : '';
    // Ageing is derived, never pasted: the due date is the anchor when known
    // (the parser also derives it from invoiceDate + credit period), else the
    // invoice date itself becomes the anchor.
    const due = isIsoDate(inv.dueDate) ? inv.dueDate : '';
    const anchor = due || invoiceDate;
    const daysOverdue = anchor ? daysBetween(anchor, today) : null;
    const daysSinceInvoice = invoiceDate ? daysBetween(invoiceDate, today) : null;
    return {
      id,
      customerName: inv.customerName,
      invoiceNo: inv.invoiceNo,
      invoiceDate: invoiceDate || null,
      creditPeriodDays: inv.creditPeriodDays ?? null,
      dueDate: due || null,
      invoiceAmount,
      baseReceived: round2(Number(inv.baseReceived) || 0),
      ledgerReceived: round2(ledgerReceived),
      effectiveReceived,
      balance,
      daysOverdue,
      daysSinceInvoice,
      dueMonth: due ? monthLabel(due) : '',
      invoiceWeekStart: invoiceDate ? weekStart(invoiceDate) : null,
      dueWeekStart: anchor ? weekStart(anchor) : null,
      // Future-due (or unbucketed) invoices are NOT DUE; only past-due amounts age.
      bucket: balance <= 0.005 ? 'PAID' : (daysOverdue == null || daysOverdue <= 0 ? 'NOT_DUE' : bucketForDays(daysOverdue)),
      contactName: inv.contactName || '',
      contactPhone: inv.contactPhone || '',
      contactMail: inv.contactMail || '',
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

  return { liveInvoices, advanceByCustomer };
}

/** Per-customer ageing (advance-only customers included as credit rows). */
export function buildCustomerAgeing(
  liveInvoices: LiveInvoice[],
  advanceByCustomer: Map<string, number>,
): CustomerDue[] {
  const map = new Map<string, CustomerDue>();
  for (const inv of liveInvoices) {
    const key = inv.customerName;
    let row = map.get(key);
    if (!row) {
      row = {
        customerName: key,
        totalReceivable: 0, notDue: 0, bucket0to30: 0, bucket31to60: 0,
        bucket61to90: 0, bucket91to180: 0, bucketAbove180: 0,
        grossDue: 0, advanceReceived: 0, netDue: 0, invoiceCount: 0,
        oldestDueDate: null, lastInvoiceDate: null,
      };
      map.set(key, row);
    }
    row.invoiceCount++;
    if (inv.invoiceDate && (!row.lastInvoiceDate || inv.invoiceDate > row.lastInvoiceDate)) {
      row.lastInvoiceDate = inv.invoiceDate;
    }
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
      if (inv.balance > 0.005) {
        const due = inv.dueDate || inv.invoiceDate || '';
        if (due && (!row.oldestDueDate || due < row.oldestDueDate)) row.oldestDueDate = due;
      }
    }
  }

  // Customer advances reduce the customer's Net Due. A customer with an
  // advance but no invoice still appears (credit-only row) so totals reconcile.
  for (const [customerName, advance] of advanceByCustomer) {
    let row = map.get(customerName);
    if (!row) {
      row = {
        customerName,
        totalReceivable: 0, notDue: 0, bucket0to30: 0, bucket31to60: 0,
        bucket61to90: 0, bucket91to180: 0, bucketAbove180: 0,
        grossDue: 0, advanceReceived: 0, netDue: 0, invoiceCount: 0,
        oldestDueDate: null, lastInvoiceDate: null,
      };
      map.set(customerName, row);
    }
    row.advanceReceived = round2(row.advanceReceived + advance);
  }

  return [...map.values()]
    .map((row) => ({ ...row, netDue: round2(row.grossDue - row.advanceReceived) }))
    .sort((a, b) => b.grossDue - a.grossDue || b.totalReceivable - a.totalReceivable);
}
