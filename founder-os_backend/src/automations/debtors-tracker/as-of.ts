/**
 * Debtors Tracker — point-in-time ("as of") reconstruction.
 *
 * The dashboard ledger stores only current state: invoice amount, the pasted
 * "Amount Received" snapshot, and a receipts ledger with REAL collection dates.
 * So a historical view is derived, never stored:
 *
 *   receivedAt(invoice, D) = max( sheetReceivedAt(invoice, D),
 *                                  Σ receipts with collectionDate ≤ D )
 *   balanceAt              = invoiceAmount − receivedAt
 *   bucketAt               = bucket of daysBetween(due || invoiceDate, D)
 *
 * `sheetReceivedAt` is the honest part: the pasted figure carries no date, so
 * it counts only from the import that produced it (`lastImportAt`), and from
 * the append-only `DebtorInvoiceReceivedEvent` rows once they exist (those are
 * written on every import, so sheet history is exact after the first import
 * that shipped this feature). Before either stamp we count nothing — we never
 * invent received money.
 *
 * Pure: no DB/framework imports, so guards and both runtimes can use it.
 */
import { daysBetween, isAdvanceCollection, isIsoDate, round2 } from './shared';

export const AS_OF_EPSILON = 0.005;
/** Longest window the picker may ask for (5 years of daily views). */
export const AS_OF_MAX_SPAN_DAYS = 366 * 5;

const EPS = AS_OF_EPSILON;

/** ISO day (`YYYY-MM-DD`) of any stored date/string; '' when unparseable. */
export function dayOf(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/** Book date of an invoice: the invoice date, else the day it was imported. */
export function invoiceDay(inv: any): string {
  return dayOf(inv?.invoiceDate) || dayOf(inv?.createdAt);
}

/** Receipt day: the collection date, else the day the row was created. */
export function collectionDay(c: any): string {
  return dayOf(c?.collectionDate) || dayOf(c?.createdAt);
}

export function importDay(inv: any): string {
  return dayOf(inv?.lastImportAt);
}

/**
 * Row visible at `asOf`.
 * - not deleted → visible
 * - deleted BEFORE/AFTER asOf → invisible at/after the delete day, visible
 *   before it (migration 0161 stamps `deletedAt`)
 * - deleted with no stamp (legacy rows) → invisible, exactly as today
 */
export function rowVisibleAt(row: any, asOf: string): boolean {
  if (!row?.deleted) return true;
  const deleted = dayOf(row?.deletedAt);
  return !!deleted && deleted > asOf;
}

export function invoiceVisibleAt(inv: any, asOf: string): boolean {
  const day = invoiceDay(inv);
  return !!day && day <= asOf && rowVisibleAt(inv, asOf);
}

export function collectionVisibleAt(c: any, asOf: string): boolean {
  const day = collectionDay(c);
  return !!day && day <= asOf && rowVisibleAt(c, asOf);
}

/**
 * Received money the ageing sheet reported for this invoice, as known at `asOf`.
 * `events` (append-only import deltas) win when present for the invoice.
 */
export function sheetReceivedAt(
  inv: any,
  asOf: string,
  events?: Array<{ day?: string | null; amount?: number | null }> | null,
): number {
  if (events && events.length) {
    let total = 0;
    for (const e of events) {
      const day = dayOf(e?.day);
      if (day && day <= asOf) total += Number(e?.amount) || 0;
    }
    return round2(total);
  }
  const base = Number(inv?.baseReceived) || 0;
  if (base <= EPS) return 0;
  // No import stamp (legacy rows): the figure was known from the day the row
  // appeared at the earliest — never before it.
  const imported = importDay(inv) || dayOf(inv?.createdAt);
  if (!imported) return round2(base);
  return imported <= asOf ? round2(base) : 0;
}

export interface AsOfParams {
  /** Clamped to today; the view's "now". */
  asOf: string;
  /** Comparison point; null when no range is active. */
  from: string | null;
  /** True when `asOf` is before today (mutation lock + banner). */
  historical: boolean;
  error?: string;
}

/**
 * Validate/clamp `?asOf=&from=`. Missing asOf = today (live path, unchanged).
 * A future asOf is clamped to today rather than rejected (a shared URL keeps
 * working); a malformed date is a 400 because silently showing "today" would
 * misreport money.
 */
export function parseAsOfParams(
  input: { asOf?: unknown; from?: unknown },
  today: string,
): AsOfParams {
  const rawAsOf = String(input.asOf ?? '').trim();
  const rawFrom = String(input.from ?? '').trim();
  if (rawAsOf && !isIsoDate(rawAsOf)) {
    return { asOf: today, from: null, historical: false, error: 'asOf must be YYYY-MM-DD' };
  }
  if (rawFrom && !isIsoDate(rawFrom)) {
    return { asOf: today, from: null, historical: false, error: 'from must be YYYY-MM-DD' };
  }
  const asOf = rawAsOf && rawAsOf < today ? rawAsOf : today;
  const from = rawFrom && rawFrom < asOf ? rawFrom : null;
  if (from && daysBetween(from, asOf) > AS_OF_MAX_SPAN_DAYS) {
    return { asOf, from: null, historical: asOf < today, error: `Range is limited to ${AS_OF_MAX_SPAN_DAYS} days` };
  }
  return { asOf, from, historical: asOf < today };
}

const BUCKET_RANK: Record<string, number> = {
  NOT_DUE: 0, D0: 1, D31: 2, D61: 3, D91: 4, D181: 5, PAID: 6,
};

export interface BucketMovement {
  fromBucket: string;
  toBucket: string;
  count: number;
  amount: number;
}

/** Bucket transitions for invoices visible at BOTH dates (the ageing shift). */
export function bucketMovements(thenInvoices: any[], nowInvoices: any[]): BucketMovement[] {
  const thenById = new Map<string, any>();
  for (const inv of thenInvoices) thenById.set(String(inv.id), inv);
  const pairs = new Map<string, BucketMovement>();
  for (const inv of nowInvoices) {
    const before = thenById.get(String(inv.id));
    if (!before || before.bucket === inv.bucket) continue;
    const key = `${before.bucket}|${inv.bucket}`;
    const row = pairs.get(key) ?? { fromBucket: before.bucket, toBucket: inv.bucket, count: 0, amount: 0 };
    row.count += 1;
    row.amount = round2(row.amount + Math.max(0, Number(inv.balance) || 0));
    pairs.set(key, row);
  }
  return [...pairs.values()].sort(
    (a, b) => b.count - a.count
      || (BUCKET_RANK[a.toBucket] ?? 9) - (BUCKET_RANK[b.toBucket] ?? 9),
  );
}

export interface AsOfMovement {
  /** New invoice value booked in the window (invoiceDate in (from, to]). */
  invoicedInRange: number;
  /** Receipts dated inside the window (all receipts, advances included). */
  collectedInRange: number;
  /** Subset of the above: receipts booked against the customer, not an invoice. */
  advanceInRange: number;
  /** Sheet "Amount Received" deltas the receipts ledger cannot explain. */
  sheetAdjustments: number;
  /** Change in total receivable (all open balances, bucket-independent). */
  receivableChange: number;
  /** Change in gross due (past-due balances only — moves with ageing too). */
  grossDueChange: number;
  /** Change in net due (gross due − advances). */
  netDueChange: number;
  invoicesBooked: number;
  invoicesSettled: number;
  customersAdded: number;
  customersSettled: number;
  /** Invoices that aged into a deeper bucket vs out of one (PAID counts as paid). */
  agedDeeper: number;
  agedShallower: number;
  paidInRange: number;
}

/**
 * Then-vs-now movement. The reconciliation line is exact by construction:
 *   receivableChange = invoicedInRange − collectedInRange − sheetAdjustments
 * (advances are reported separately because they reduce net due, not gross).
 */
export function buildMovement(input: {
  invoices: any[];
  collections: any[];
  from: string;
  to: string;
  thenInvoices: any[];
  nowInvoices: any[];
  thenCustomers: any[];
  nowCustomers: any[];
  thenSummary: { totalReceivable: number; grossDue: number; netDue: number };
  nowSummary: { totalReceivable: number; grossDue: number; netDue: number };
  receivedThen: number;
  receivedNow: number;
}): AsOfMovement {
  const { from, to } = input;

  let invoicedInRange = 0;
  let invoicesBooked = 0;
  for (const inv of input.invoices) {
    const day = invoiceDay(inv);
    if (day && day > from && day <= to && rowVisibleAt(inv, to)) {
      invoicedInRange += Number(inv.invoiceAmount) || 0;
      invoicesBooked += 1;
    }
  }

  let collectedInRange = 0;
  let advanceInRange = 0;
  for (const c of input.collections) {
    const day = collectionDay(c);
    if (!(day && day > from && day <= to) || !rowVisibleAt(c, to)) continue;
    const amount = Number(c.amount) || 0;
    collectedInRange += amount;
    if (isAdvanceCollection(c)) advanceInRange += amount;
  }

  const thenById = new Map<string, any>();
  for (const inv of input.thenInvoices) thenById.set(String(inv.id), inv);
  let invoicesSettled = 0;
  let agedDeeper = 0;
  let agedShallower = 0;
  let paidInRange = 0;
  for (const inv of input.nowInvoices) {
    const before = thenById.get(String(inv.id));
    if (!before) continue;
    if (Number(before.balance) > EPS && Number(inv.balance) <= EPS) invoicesSettled += 1;
    if (before.bucket !== inv.bucket) {
      if (inv.bucket === 'PAID') paidInRange += 1;
      else if ((BUCKET_RANK[inv.bucket] ?? 0) > (BUCKET_RANK[before.bucket] ?? 0)) agedDeeper += 1;
      else agedShallower += 1;
    }
  }

  const thenNames = new Set(input.thenCustomers.map((c: any) => String(c.customerName)));
  const nowNames = new Set(input.nowCustomers.map((c: any) => String(c.customerName)));
  let customersAdded = 0;
  for (const name of nowNames) if (!thenNames.has(name)) customersAdded += 1;
  let customersSettled = 0;
  for (const row of input.nowCustomers) {
    if (!thenNames.has(String(row.customerName))) continue;
    const before = input.thenCustomers.find((c: any) => String(c.customerName) === String(row.customerName));
    if (before && Number(before.netDue) > EPS && Number(row.netDue) <= EPS) customersSettled += 1;
  }

  const receivableChange = round2(input.nowSummary.totalReceivable - input.thenSummary.totalReceivable);
  const collected = round2(collectedInRange);
  // receivedNow − receivedThen already includes both receipt and sheet deltas.
  const receivedDelta = round2(input.receivedNow - input.receivedThen);

  return {
    invoicedInRange: round2(invoicedInRange),
    collectedInRange: collected,
    advanceInRange: round2(advanceInRange),
    sheetAdjustments: round2(receivedDelta - collected),
    receivableChange,
    grossDueChange: round2(input.nowSummary.grossDue - input.thenSummary.grossDue),
    netDueChange: round2(input.nowSummary.netDue - input.thenSummary.netDue),
    invoicesBooked,
    invoicesSettled,
    customersAdded,
    customersSettled,
    agedDeeper,
    agedShallower,
    paidInRange,
  };
}

/** Earliest/latest dates the ledger can speak about (UI clamps the picker). */
export interface AsOfCoverage {
  firstInvoiceDate: string | null;
  lastInvoiceDate: string | null;
  lastCollectionDate: string | null;
  firstImportAt: string | null;
  lastImportAt: string | null;
}

export function buildCoverage(invoices: any[], collections: any[]): AsOfCoverage {
  let firstInvoiceDate = '';
  let lastInvoiceDate = '';
  let firstImportAt = '';
  let lastImportAt = '';
  for (const inv of invoices) {
    const day = invoiceDay(inv);
    if (day && (!firstInvoiceDate || day < firstInvoiceDate)) firstInvoiceDate = day;
    if (day && (!lastInvoiceDate || day > lastInvoiceDate)) lastInvoiceDate = day;
    const imported = importDay(inv);
    if (imported && (!firstImportAt || imported < firstImportAt)) firstImportAt = imported;
    if (imported && (!lastImportAt || imported > lastImportAt)) lastImportAt = imported;
  }
  let lastCollectionDate = '';
  for (const c of collections) {
    const day = collectionDay(c);
    if (day && (!lastCollectionDate || day > lastCollectionDate)) lastCollectionDate = day;
  }
  return {
    firstInvoiceDate: firstInvoiceDate || null,
    lastInvoiceDate: lastInvoiceDate || null,
    lastCollectionDate: lastCollectionDate || null,
    firstImportAt: firstImportAt || null,
    lastImportAt: lastImportAt || null,
  };
}

/** Buckets that are past due, in display order (mirror of the FE ageing chart). */
export const PAST_DUE_BUCKETS = ['D0', 'D31', 'D61', 'D91', 'D181'] as const;

export function isPastDueBucket(bucket: string): boolean {
  return (PAST_DUE_BUCKETS as readonly string[]).includes(bucket);
}
