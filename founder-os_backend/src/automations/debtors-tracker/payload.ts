/**
 * Debtors Tracker — dashboard payload (KV-cached).
 * Joins the ledger/ageing computation with the customer contact master and the
 * reminder log. Every write path invalidates `DEBTORS_CACHE_PREFIX`.
 */
import { prisma } from '../../shared/prisma';
import { cached } from '../../shared/cache';
import { DEBTORS_CACHE_PREFIX, DEBTORS_TTL_MS } from './cache';
import { loadCustomerContacts } from './customers';
import { customerKeyOf } from './customers';
import { buildCustomerAgeing, buildLiveInvoices } from './ledger';
import { buildReceiptAgeing } from './receipt-ageing';
import { latestReminderByCustomer, loadRecentReminders, reminderConfigured, reminderMode } from './reminders';
import { loadRemarkIndex } from './remarks';
import { isAdvanceCollection, round2, todayIST } from './shared';
import { normalizeInvoiceNo } from './types';
import type {
  CustomerAgeingRow, LiveCollection, LiveInvoice, LiveReminder,
  DebtorsTrackerPayload, InvoiceNoConflict,
} from './types';

export async function getDebtorsTrackerData(): Promise<DebtorsTrackerPayload> {
  return cached(`${DEBTORS_CACHE_PREFIX}full`, DEBTORS_TTL_MS, computePayload) as Promise<DebtorsTrackerPayload>;
}

async function computePayload(): Promise<DebtorsTrackerPayload> {
  const today = todayIST();
  const [invoiceRows, collRows, contacts, reminders, remarkIndex] = await Promise.all([
    prisma.debtorInvoice.findMany({ where: { deleted: false } }) as Promise<any[]>,
    prisma.paymentCollection.findMany({ where: { deleted: false } }) as Promise<any[]>,
    loadCustomerContacts(),
    loadRecentReminders(500),
    loadRemarkIndex(),
  ]);

  const { liveInvoices, advanceByCustomer } = buildLiveInvoices(invoiceRows, collRows, today);
  const dues = buildCustomerAgeing(liveInvoices, advanceByCustomer);
  const receiptAgeing = buildReceiptAgeing(invoiceRows, collRows, today);

  // Latest follow-up across all invoices, per customer (sales workflow).
  const followUp = new Map<string, { date: string; status: string }>();
  for (const inv of liveInvoices) {
    const date = inv.lastCallDate || '';
    if (!date) continue;
    const cur = followUp.get(inv.customerName);
    if (!cur || date > cur.date) {
      followUp.set(inv.customerName, { date, status: inv.callStatus || inv.paymentStatus || '' });
    }
  }

  const latestReminder = latestReminderByCustomer(reminders);
  const customerRows: CustomerAgeingRow[] = dues.map((row) => {
    const key = customerKeyOf(row.customerName);
    const contact = contacts.get(key);
    const reminder = latestReminder.get(key);
    const follow = followUp.get(row.customerName);
    const remarkSummary = remarkIndex.get(key);
    return {
      ...row,
      customerKey: key,
      phone: contact?.phone || '',
      email: contact?.email || '',
      region: contact?.region || '',
      whatsappOptIn: !!contact?.whatsappOptIn,
      notes: contact?.notes || '',
      situation: contact?.situation || '',
      situationRemarks: remarkSummary?.latest.remark || contact?.situationRemarks || '',
      situationUpdatedAt: contact?.situationUpdatedAt ?? null,
      situationUpdatedBy: contact?.situationUpdatedBy || '',
      promisedDate: contact?.promisedDate ?? null,
      promisedDays: contact?.promisedDays ?? null,
      promisedAt: contact?.promisedAt ?? null,
      promisedBy: contact?.promisedBy || '',
      remarkCount: remarkSummary?.count ?? 0,
      lastRemarkAt: remarkSummary?.latest.createdAt ?? null,
      lastReminderAt: reminder ? String(reminder.createdAt ?? '') : null,
      lastReminderStatus: reminder ? String(reminder.status || '') : '',
      lastFollowUpDate: follow?.date ?? null,
      lastFollowUpStatus: follow?.status ?? '',
    };
  });

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
      receiptNo: c.receiptNo || '',
      collectionDate: c.collectionDate ?? null,
      amount: round2(Number(c.amount) || 0),
      mode: c.mode || '',
      remarks: c.remarks || '',
      matchStatus: isAdvanceCollection(c) ? 'advance' : (c.matchStatus || 'none'),
      resolvedInvoiceId: c.resolvedInvoiceId ? String(c.resolvedInvoiceId) : null,
      createdAt: String(c.createdAt ?? ''),
    }));

  const byInvoiceNo = new Map<string, { invoiceNo: string; customers: Set<string> }>();
  for (const inv of liveInvoices) {
    const key = normalizeInvoiceNo(inv.invoiceNo).toLowerCase();
    if (!key) continue;
    const cur = byInvoiceNo.get(key);
    if (cur) cur.customers.add(inv.customerName);
    else byInvoiceNo.set(key, { invoiceNo: inv.invoiceNo, customers: new Set([inv.customerName]) });
  }
  const invoiceConflicts: InvoiceNoConflict[] = [...byInvoiceNo.values()]
    .filter((v) => v.customers.size > 1)
    .map((v) => ({ invoiceNo: v.invoiceNo, customers: [...v.customers] }))
    .sort((a, b) => a.invoiceNo.localeCompare(b.invoiceNo));

  const liveReminders: LiveReminder[] = reminders.map((r: any) => ({
    id: String(r.id),
    customerKey: String(r.customerKey || ''),
    customerName: String(r.customerName || ''),
    phone: String(r.phone || ''),
    channel: String(r.channel || 'whatsapp'),
    status: String(r.status || ''),
    amount: round2(Number(r.amount) || 0),
    invoiceCount: Number(r.invoiceCount) || 0,
    invoiceNos: String(r.invoiceNos || ''),
    oldestDueDate: r.oldestDueDate ?? null,
    message: String(r.message || ''),
    error: String(r.error || ''),
    runDay: String(r.runDay || ''),
    trigger: String(r.trigger || 'cron'),
    createdAt: String(r.createdAt ?? ''),
  }));

  return {
    summary,
    customers: customerRows,
    invoices: liveInvoices as LiveInvoice[],
    collections: liveCollections,
    receiptAgeing,
    reminders: liveReminders,
    meta: {
      asOfIST: today,
      totalInvoices: liveInvoices.length,
      totalCollections: collRows.length,
      reminderConfigured: reminderConfigured(),
      reminderMode: reminderMode(),
      reminderRunDay: today,
      invoiceConflicts,
    },
  };
}
