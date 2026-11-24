/**
 * Debtors Tracker — dashboard payload (KV-cached).
 * Joins the ledger/ageing computation with the customer contact master and the
 * reminder log. Every write path invalidates the `debtors` cache REVISION.
 *
 * As-of history (2026-11-24): `?asOf=YYYY-MM-DD&from=YYYY-MM-DD` rebuilds the
 * whole snapshot at that date from the dated invoice/receipt rows (see
 * as-of.ts). No params = today's exact behaviour, so the live path is
 * byte-identical to before this feature.
 */
import { prisma } from '../../shared/prisma';
import { cached } from '../../shared/cache';
import { DEBTORS_CACHE_PREFIX, DEBTORS_TTL_MS, debtorsCacheRev } from './cache';
import { loadCustomerContacts } from './customers';
import { customerKeyOf } from './customers';
import { loadPrimaryPdfByInvoice } from './attachments';
import { DebtorsTrackerError } from './errors';
import { buildCustomerAgeing, buildLiveInvoices } from './ledger';
import { buildReceiptAgeing, receiptBucketAt } from './receipt-ageing';
import { latestReminderByCustomer, loadRecentReminders, reminderConfigured, reminderMode } from './reminders';
import { loadRemarkIndex } from './remarks';
import { getTopN, listTopPicks } from './top-picks';
import { isAdvanceCollection, round2, todayIST } from './shared';
import { normalizeInvoiceNo } from './types';
import {
  buildCoverage, buildMovement, bucketMovements, collectionVisibleAt, dayOf,
  invoiceVisibleAt, parseAsOfParams, rowVisibleAt, type AsOfParams,
} from './as-of';
import { loadReceivedEvents, type ReceivedEvent } from './received-events';
import type {
  CustomerAgeingRow, LiveCollection, LiveInvoice, LiveReminder,
  DebtorsTrackerPayload, InvoiceNoConflict, SummaryRow,
} from './types';

export interface DebtorsDataOptions {
  /** Point-in-time date (default today). */
  asOf?: string | null;
  /** Optional comparison point; must be before `asOf`. */
  from?: string | null;
}

type ReceivedEventMap = Map<string, ReceivedEvent[]>;

export async function getDebtorsTrackerData(opts: DebtorsDataOptions = {}): Promise<DebtorsTrackerPayload> {
  const today = todayIST();
  const params = parseAsOfParams({ asOf: opts.asOf, from: opts.from }, today);
  if (params.error) throw new DebtorsTrackerError(params.error, 400);
  const rev = await debtorsCacheRev();
  const key = `${DEBTORS_CACHE_PREFIX}${rev}:${params.asOf}:${params.from ?? '-'}`;
  return cached(key, DEBTORS_TTL_MS, () => computePayload(today, params)) as Promise<DebtorsTrackerPayload>;
}

interface Snapshot {
  liveInvoices: LiveInvoice[];
  dues: ReturnType<typeof buildCustomerAgeing>;
  summary: SummaryRow;
  receiptAgeing: ReturnType<typeof buildReceiptAgeing>;
}

/** One consistent point-in-time view (used for both `to` and `from`). */
function snapshot(
  invoiceRows: any[],
  collRows: any[],
  asOf: string,
  historical: boolean,
  eventsByInvoice: ReceivedEventMap,
): Snapshot {
  const visibleInvoices = invoiceRows.filter((inv) => rowVisibleAt(inv, asOf));
  const visibleColls = collRows.filter((c) => rowVisibleAt(c, asOf));
  // Historical mode filters by date and applies the sheet-received cutoff;
  // live mode passes no options, preserving the pre-feature computation.
  const { liveInvoices, advanceByCustomer } = buildLiveInvoices(
    visibleInvoices,
    visibleColls,
    asOf,
    historical ? { asOf, eventsByInvoice } : undefined,
  );
  const dues = buildCustomerAgeing(liveInvoices, advanceByCustomer);

  // Receipt ageing windows are relative to `asOf`, so the historical view shows
  // the same "this week / last week / this month" split for that date.
  const receiptInvoices = historical ? visibleInvoices.filter((inv) => invoiceVisibleAt(inv, asOf)) : visibleInvoices;
  const receiptColls = historical ? visibleColls.filter((c) => collectionVisibleAt(c, asOf)) : visibleColls;
  const receiptAgeing = buildReceiptAgeing(receiptInvoices, receiptColls, asOf);

  return {
    liveInvoices,
    dues,
    summary: summarise(dues, liveInvoices, receiptColls.length),
    receiptAgeing,
  };
}

/** The numeric fields a customer roll-up must provide for the totals. */
type SummarySource = {
  totalReceivable: number; notDue: number; grossDue: number; advanceReceived: number;
  bucket0to30: number; bucket31to60: number; bucket61to90: number;
  bucket91to180: number; bucketAbove180: number;
};

function summarise(
  customerRows: SummarySource[],
  liveInvoices: LiveInvoice[],
  collectionCount: number,
): SummaryRow {
  const summary: SummaryRow = {
    totalReceivable: 0, notDue: 0, grossDue: 0, advanceReceived: 0, netDue: 0,
    bucket0to30: 0, bucket31to60: 0, bucket61to90: 0, bucket91to180: 0,
    bucketAbove180: 0, above90Total: 0,
    invoiceCount: liveInvoices.length,
    collectionCount,
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
  return summary;
}

/** Append-only sheet-received deltas (exact history after the first import). */

async function computePayload(today: string, params: AsOfParams): Promise<DebtorsTrackerPayload> {
  const { asOf, from, historical } = params;
  const [invoiceRows, collRows, contacts, reminders, remarkIndex, pdfByInvoice, topPicks, topN, eventsByInvoice] = await Promise.all([
    prisma.debtorInvoice.findMany({}) as Promise<any[]>,
    prisma.paymentCollection.findMany({}) as Promise<any[]>,
    loadCustomerContacts(),
    loadRecentReminders(500),
    loadRemarkIndex(),
    loadPrimaryPdfByInvoice().catch(() => new Map()),
    listTopPicks().catch(() => []),
    getTopN().catch(() => 20),
    loadReceivedEvents(),
  ]);

  const now = snapshot(invoiceRows, collRows, asOf, historical, eventsByInvoice);
  const then = from ? snapshot(invoiceRows, collRows, from, true, eventsByInvoice) : null;
  const { liveInvoices } = now;

  for (const inv of liveInvoices) {
    const pdf = (pdfByInvoice as Map<string, any>).get(String((inv as any).id));
    if (pdf) {
      (inv as any).invoicePdf = {
        id: String(pdf.id), fileName: String(pdf.fileName), url: String(pdf.url),
        source: String(pdf.source), uploadedBy: String(pdf.uploadedBy || ''),
        contentKey: String((pdf as any).contentKey || ''),
      };
    }
  }

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

  const thenByCustomer = new Map<string, { grossDue: number; netDue: number }>();
  for (const row of then?.dues ?? []) {
    thenByCustomer.set(String(row.customerName), { grossDue: row.grossDue, netDue: row.netDue });
  }

  const latestReminder = latestReminderByCustomer(reminders);
  const customerRows: CustomerAgeingRow[] = now.dues.map((row) => {
    const key = customerKeyOf(row.customerName);
    const contact = contacts.get(key);
    const reminder = latestReminder.get(key);
    const follow = followUp.get(row.customerName);
    const remarkSummary = remarkIndex.get(key);
    const before = thenByCustomer.get(String(row.customerName));
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
      ...(then ? { thenGrossDue: before?.grossDue ?? 0, thenNetDue: before?.netDue ?? 0 } : {}),
    };
  });

  const summary = now.summary;
  const invoiceById = new Map<string, any>();
  for (const inv of invoiceRows) invoiceById.set(String(inv.id), inv);

  const liveCollections: LiveCollection[] = collRows
    .filter((c) => rowVisibleAt(c, asOf))
    .filter((c) => !historical || collectionVisibleAt(c, asOf))
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
      receiptBucket: receiptBucketAt(
        c.resolvedInvoiceId ? invoiceById.get(String(c.resolvedInvoiceId)) : undefined,
        c,
      ),
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

  const liveReminders: LiveReminder[] = reminders
    .filter((r: any) => dayOf(r.runDay) <= asOf)
    .map((r: any) => ({
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

  const coverage = buildCoverage(invoiceRows, collRows);
  const receivedNow = round2(liveInvoices.reduce((sum, inv) => sum + (Number(inv.effectiveReceived) || 0), 0));

  let compare: DebtorsTrackerPayload['compare'];
  if (then && from) {
    const receivedThen = round2(then.liveInvoices.reduce((sum, inv) => sum + (Number(inv.effectiveReceived) || 0), 0));
    compare = {
      from,
      to: asOf,
      then: { asOfIST: from, summary: then.summary },
      now: { asOfIST: asOf, summary },
      movement: buildMovement({
        invoices: invoiceRows.filter((inv) => rowVisibleAt(inv, asOf)),
        collections: collRows.filter((c) => rowVisibleAt(c, asOf)),
        from,
        to: asOf,
        thenInvoices: then.liveInvoices,
        nowInvoices: liveInvoices,
        thenCustomers: then.dues,
        nowCustomers: now.dues,
        thenSummary: then.summary,
        nowSummary: summary,
        receivedThen,
        receivedNow,
      }),
      migration: bucketMovements(then.liveInvoices, liveInvoices),
    };
  }

  return {
    summary,
    customers: customerRows,
    invoices: liveInvoices as LiveInvoice[],
    collections: liveCollections,
    receiptAgeing: now.receiptAgeing,
    reminders: liveReminders,
    topPicks: topPicks.map((t) => t.customerKey),
    topN,
    meta: {
      asOfIST: asOf,
      totalInvoices: liveInvoices.length,
      totalCollections: now.summary.collectionCount,
      reminderConfigured: reminderConfigured(),
      reminderMode: reminderMode(),
      reminderRunDay: asOf,
      invoiceConflicts,
      isHistorical: historical,
      rangeFrom: from,
      coverage,
      caveats: buildCaveats({ historical, asOf, from, coverage }),
      ...(compare ? { compare } : {}),
    },
  };
}

/** Honest limits of a rebuilt snapshot — shown in the dashboard banner. */
function buildCaveats(input: {
  historical: boolean;
  asOf: string;
  from: string | null;
  coverage: ReturnType<typeof buildCoverage>;
}): string[] {
  if (!input.historical) return [];
  const out = [
    'Rebuilt from invoice and receipt dates. Amounts Received pasted in the ageing sheet count only from the import that recorded them.',
    'Region, CRM situation and promises show their current state — they have no history.',
  ];
  const firstImport = input.coverage.firstImportAt;
  if (firstImport && input.asOf < firstImport) {
    out.push(`No import is recorded before ${firstImport}. Received money is shown as unknown, never assumed paid.`);
  }
  if (input.from) out.push('Bills deleted after this date are still shown; edits made later are reflected.');
  return out;
}
