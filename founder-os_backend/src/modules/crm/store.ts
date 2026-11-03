// ── CRM order workflow: persistence (D1 through the prisma shim) ───────────
//
// Exactly two jobs live here:
//   1. map rows ↔ API shapes
//   2. perform write lifecycles (schedule / reschedule / dispatch / confirm
//      removal / sync) with validation, audit rows and score credits
//
// No HTTP, no authz — those are the route module's problem (routes.ts).
// Pure rules live in scheduling.ts; queue predicates in queues.ts.
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import {
  deriveLifecycle,
  isOverdueItem,
  resolveDispatchQty,
  validateDispatch,
  validateReschedule,
  validateSchedule,
  type DispatchEntry,
  type ItemLike,
  type RescheduleEntry,
  type ScheduleEntry,
} from './scheduling';
import { orderFlags, orderMatchesView, type ViewOrder } from './queues';
import {
  CANCELLED_STATUSES,
  istToday,
  soKey,
  type CrmItemRow,
  type CrmOrderRow,
  type EventKind,
  type ItemState,
  type Lifecycle,
  type View,
} from './types';

// ── Mapping ────────────────────────────────────────────────────────────────

const iso = (v: any): string | null => {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const str = (v: any): string => (v === undefined || v === null ? '' : String(v));

export function toItemView(row: any): CrmItemRow {
  return {
    id: str(row?.id),
    soId: str(row?.soId),
    lineKey: str(row?.lineKey),
    name: str(row?.name),
    sku: str(row?.sku),
    description: str(row?.description),
    qty: num(row?.qty),
    unit: str(row?.unit),
    rate: num(row?.rate),
    itemTotal: num(row?.itemTotal),
    dispatchState: (str(row?.dispatchState) || 'unscheduled') as ItemState,
    tentativeDispatchDate: row?.tentativeDispatchDate ? str(row.tentativeDispatchDate).slice(0, 10) : null,
    delayReason: row?.delayReason ? str(row.delayReason) : null,
    dispatchedQty: num(row?.dispatchedQty),
    dispatchedAt: iso(row?.dispatchedAt),
    scheduledBy: row?.scheduledBy ? str(row.scheduledBy) : null,
    scheduledAt: iso(row?.scheduledAt),
  };
}

export function toOrderView(row: any, items: CrmItemRow[]): CrmOrderRow {
  return {
    id: str(row?.id),
    org: str(row?.org),
    soNumber: str(row?.soNumber),
    zohoId: str(row?.zohoId),
    customerName: str(row?.customerName),
    customerId: str(row?.customerId),
    value: num(row?.value),
    currency: str(row?.currency) || 'INR',
    orderStatus: str(row?.orderStatus),
    invoicedStatus: str(row?.invoicedStatus),
    shippedStatus: str(row?.shippedStatus),
    paidStatus: str(row?.paidStatus),
    status: str(row?.status),
    salesperson: str(row?.salesperson),
    referenceNumber: str(row?.referenceNumber),
    createdDate: str(row?.createdDate),
    lifecycle: (str(row?.lifecycle) || 'unscheduled') as Lifecycle,
    sourceState: str(row?.sourceState) === 'deleted_source' ? 'deleted_source' : 'active',
    soDelayReason: row?.soDelayReason ? str(row.soDelayReason) : null,
    missCount: num(row?.missCount),
    firstSeenAt: iso(row?.firstSeenAt),
    lastSeenAt: iso(row?.lastSeenAt),
    deletedDetectedAt: iso(row?.deletedDetectedAt),
    items,
    itemCount: items.length,
  };
}

/** Attach the derived flags the UI needs (overdue / due-today / can-*). */
function withFlags(order: CrmOrderRow, today: string): CrmOrderRow {
  const flags = orderFlags(order as ViewOrder, today);
  return { ...order, overdue: flags.overdue, dueToday: flags.dueToday };
}

// ── Reads ──────────────────────────────────────────────────────────────────

const ITEM_BATCH = 90;

async function itemsForOrders(ids: string[]): Promise<Map<string, CrmItemRow[]>> {
  const out = new Map<string, CrmItemRow[]>();
  if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += ITEM_BATCH) {
    const chunk = ids.slice(i, i + ITEM_BATCH);
    const rows = await prisma.crmSoItem.findMany({ where: { soId: { in: chunk } } });
    for (const r of rows as any[]) {
      const item = toItemView(r);
      const list = out.get(item.soId) || [];
      list.push(item);
      out.set(item.soId, list);
    }
  }
  return out;
}

export interface ListArgs {
  view: View;
  q?: string;
  today?: string;
  limit?: number;
}

/**
 * List orders for a dashboard tab. Rows + items are read once and grouped in
 * memory — the floor is small (open orders only) and every view shares the
 * same row set, so a single pass is cheaper than per-view SQL.
 */
export async function listOrders(args: ListArgs): Promise<CrmOrderRow[]> {
  const today = args.today || istToday();
  const view = args.view;
  const limit = Math.min(Math.max(Number(args.limit) || 500, 1), 2000);

  const where: any = view === 'source-deleted' ? { sourceState: 'deleted_source' } : {};
  const rows = (await prisma.crmSalesOrder.findMany({
    where,
    orderBy: { createdDate: 'desc' },
    take: view === 'source-deleted' ? 1000 : 3000,
  })) as any[];

  const itemsBySo = await itemsForOrders(rows.map((r) => str(r.id)));
  const orders = rows.map((r) => withFlags(toOrderView(r, itemsBySo.get(str(r.id)) || []), today));

  const q = str(args.q).trim().toLowerCase();
  const filtered = orders.filter((o) => {
    if (o.sourceState === 'deleted_source' && view !== 'source-deleted') return false;
    if (!matchesView(o, view, today)) return false;
    if (!q) return true;
    return (
      o.soNumber.toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      o.salesperson.toLowerCase().includes(q) ||
      o.referenceNumber.toLowerCase().includes(q)
    );
  });

  // Floor: overdue first, then soonest committed date. Everything else: newest
  // Zoho creation date (the list is already ordered that way).
  if (view === 'dispatch-floor') {
    filtered.sort((a, b) => {
      const ka = floorKey(a);
      const kb = floorKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }
  return filtered.slice(0, limit);
}

function floorKey(o: CrmOrderRow): string {
  const items = (o.items || []).filter((it) => it.dispatchState === 'scheduled' && it.tentativeDispatchDate);
  const today = istToday();
  const overdue = items.some((it) => isOverdueItem(it as ItemLike, today));
  const dates = items.map((it) => String(it.tentativeDispatchDate)).sort();
  return `${overdue ? '0' : '1'}:${dates[0] || ''}:${o.soNumber}`;
}

function matchesView(o: CrmOrderRow, view: View, today: string): boolean {
  // queues.ts is the single source of truth — the frontend mirror asserts
  // parity in scripts/guards/crm-lifecycle.test.mjs.
  return orderMatchesView(o as ViewOrder, view, today);
}

/** Full order (with items + audit trail) by row id or SO number. */
export async function getOrder(idOrSo: string): Promise<(CrmOrderRow & { events: any[] }) | null> {
  const row: any =
    (await prisma.crmSalesOrder.findFirst({ where: { id: idOrSo } })) ||
    (await prisma.crmSalesOrder.findFirst({ where: { soNumber: idOrSo } }));
  if (!row) return null;
  const itemRows = (await prisma.crmSoItem.findMany({ where: { soId: str(row.id) }, orderBy: { lineKey: 'asc' } })) as any[];
  const events = (await prisma.crmScheduleEvent.findMany({ where: { soId: str(row.id) }, orderBy: { createdAt: 'desc' }, take: 100 })) as any[];
  const order = withFlags(toOrderView(row, itemRows.map(toItemView)), istToday());
  return {
    ...order,
    events: events.map((e) => ({
      id: str(e.id),
      kind: str(e.kind),
      itemId: e.itemId ? str(e.itemId) : null,
      fromDate: e.fromDate ? str(e.fromDate) : null,
      toDate: e.toDate ? str(e.toDate) : null,
      reason: e.reason ? str(e.reason) : null,
      actor: str(e.actor),
      qty: e.qty === null || e.qty === undefined ? null : num(e.qty),
      day: str(e.day),
      createdAt: iso(e.createdAt),
    })),
  };
}

/**
 * Runner-side working set: what the worker already knows about.
 *
 * `itemCount` is what drives the runner's backfill queue — orders with items
 * are never re-fetched from Zoho, so the per-tick detail budget is always spent
 * on rows the floor still shows without line items.
 */
export async function syncState(): Promise<{
  orders: Array<{
    so: string;
    org: string;
    zohoId: string;
    lifecycle: string;
    sourceState: string;
    createdDate: string;
    itemCount: number;
  }>;
}> {
  const rows = (await prisma.crmSalesOrder.findMany({
    where: { sourceState: 'active' },
    take: 3000,
  })) as any[];
  // One cheap pass over item rows (a few hundred) instead of a JOIN per order.
  const itemRows = (await prisma.crmSoItem.findMany({ take: 5000 })) as any[];
  const counts = new Map<string, number>();
  for (const it of itemRows) {
    const id = str(it.soId);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return {
    orders: rows.map((r) => ({
      so: str(r.soNumber),
      org: str(r.org),
      zohoId: str(r.zohoId),
      lifecycle: str(r.lifecycle),
      sourceState: str(r.sourceState),
      createdDate: str(r.createdDate).slice(0, 10),
      itemCount: counts.get(str(r.id)) || 0,
    })),
  };
}

// ── Writes ─────────────────────────────────────────────────────────────────

export class CrmError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'invalid') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function loadRawOrder(idOrSo: string): Promise<any> {
  const row: any =
    (await prisma.crmSalesOrder.findFirst({ where: { id: idOrSo } })) ||
    (await prisma.crmSalesOrder.findFirst({ where: { soNumber: idOrSo } }));
  if (!row) throw new CrmError('Sales order not found.', 404, 'not_found');
  return row;
}

async function loadRawItems(soId: string): Promise<any[]> {
  return (await prisma.crmSoItem.findMany({ where: { soId }, orderBy: { lineKey: 'asc' } })) as any[];
}

async function writeEvent(args: {
  soId: string;
  soNumber: string;
  kind: EventKind;
  itemId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  reason?: string | null;
  actor?: string | null;
  qty?: number | null;
  day?: string;
}): Promise<void> {
  try {
    await prisma.crmScheduleEvent.create({
      data: {
        id: crypto.randomUUID(),
        soId: args.soId,
        soNumber: args.soNumber || '',
        itemId: args.itemId ?? null,
        kind: args.kind,
        fromDate: args.fromDate ?? null,
        toDate: args.toDate ?? null,
        reason: args.reason ?? null,
        actor: args.actor || '',
        qty: args.qty ?? null,
        day: args.day || istToday(),
      },
    });
  } catch (e: any) {
    // The audit is important but must never fail the action itself.
    logger.warn({ err: e?.message, kind: args.kind, so: args.soNumber }, 'crm: schedule event write failed');
  }
}

async function refreshLifecycle(orderRow: any, items: any[]): Promise<Lifecycle> {
  const lifecycle = deriveLifecycle(
    items.map((it) => ({
      id: str(it.id),
      dispatchState: str(it.dispatchState) as ItemState,
      tentativeDispatchDate: it.tentativeDispatchDate ? str(it.tentativeDispatchDate).slice(0, 10) : null,
      delayReason: it.delayReason ?? null,
      qty: num(it.qty),
      dispatchedQty: num(it.dispatchedQty),
    })) as ItemLike[],
    { status: str(orderRow.status), orderStatus: str(orderRow.orderStatus) },
  );
  await prisma.crmSalesOrder.update({
    where: { id: str(orderRow.id) },
    data: { lifecycle, updatedAt: new Date() },
  });
  return lifecycle;
}

function assertWorkable(orderRow: any, lifecycle: string) {
  if (str(orderRow.sourceState) === 'deleted_source') {
    throw new CrmError('This order was deleted at source — confirm the removal instead.', 409, 'source_deleted');
  }
  if (lifecycle === 'cancelled') {
    throw new CrmError('This order is cancelled in Zoho — nothing to schedule or dispatch.', 409, 'cancelled');
  }
}

export interface ActionResult {
  order: (CrmOrderRow & { events: any[] }) | null;
  lifecycle: Lifecycle;
  points?: number;
}

/** Schedule (or partially schedule) an order — the dispatch desk's first task. */
export async function scheduleOrder(args: {
  idOrSo: string;
  entries: ScheduleEntry[];
  soReason?: string | null;
  actor?: string | null;
  today?: string;
}): Promise<ActionResult> {
  const today = args.today || istToday();
  const orderRow = await loadRawOrder(args.idOrSo);
  const itemRows = await loadRawItems(str(orderRow.id));
  const lifecycleNow = str(orderRow.lifecycle) || 'unscheduled';
  assertWorkable(orderRow, lifecycleNow);

  const items = itemRows.map((r) => ({
    id: str(r.id),
    dispatchState: str(r.dispatchState) as ItemState,
    tentativeDispatchDate: r.tentativeDispatchDate ? str(r.tentativeDispatchDate).slice(0, 10) : null,
    delayReason: r.delayReason ?? null,
    qty: num(r.qty),
    dispatchedQty: num(r.dispatchedQty),
  })) as ItemLike[];

  const check = validateSchedule({ today, items, entries: args.entries, soReason: args.soReason });
  if (!check.ok) throw new CrmError(check.message, 400, check.code);

  const byId = new Map(itemRows.map((r) => [str(r.id), r]));
  for (const e of args.entries) {
    const row = byId.get(e.itemId);
    if (!row) continue;
    const date = e.date ? String(e.date) : null;
    await prisma.crmSoItem.update({
      where: { id: e.itemId },
      data: date
        ? {
            dispatchState: 'scheduled',
            tentativeDispatchDate: date,
            delayReason: null,
            scheduledBy: args.actor || '',
            scheduledAt: new Date(),
            updatedAt: new Date(),
          }
        : {
            dispatchState: 'unscheduled',
            tentativeDispatchDate: null,
            delayReason: str(e.reason || args.soReason || '') || null,
            updatedAt: new Date(),
          },
    });
    await writeEvent({
      soId: str(orderRow.id),
      soNumber: str(orderRow.soNumber),
      kind: date ? 'schedule' : 'delay',
      itemId: e.itemId,
      toDate: date,
      reason: date ? null : str(e.reason || args.soReason || '') || null,
      actor: args.actor,
      day: today,
    });
  }

  const anyDated = args.entries.some((e) => !!e.date);
  await prisma.crmSalesOrder.update({
    where: { id: str(orderRow.id) },
    data: {
      soDelayReason: anyDated ? null : str(args.soReason || '') || null,
      updatedAt: new Date(),
    },
  });

  const fresh = await loadRawItems(str(orderRow.id));
  const lifecycle = await refreshLifecycle(orderRow, fresh);
  return { order: await getOrder(str(orderRow.id)), lifecycle };
}

/** Move committed items to a later date — reason always mandatory. */
export async function rescheduleOrder(args: {
  idOrSo: string;
  entries: RescheduleEntry[];
  reason?: string | null;
  actor?: string | null;
  today?: string;
}): Promise<ActionResult> {
  const today = args.today || istToday();
  const orderRow = await loadRawOrder(args.idOrSo);
  const itemRows = await loadRawItems(str(orderRow.id));
  assertWorkable(orderRow, str(orderRow.lifecycle));

  const items = itemRows.map((r) => ({
    id: str(r.id),
    dispatchState: str(r.dispatchState) as ItemState,
    tentativeDispatchDate: r.tentativeDispatchDate ? str(r.tentativeDispatchDate).slice(0, 10) : null,
    delayReason: r.delayReason ?? null,
    qty: num(r.qty),
    dispatchedQty: num(r.dispatchedQty),
  })) as ItemLike[];

  const check = validateReschedule({ today, items, entries: args.entries, reason: args.reason });
  if (!check.ok) throw new CrmError(check.message, 400, check.code);

  const byId = new Map(itemRows.map((r) => [str(r.id), r]));
  for (const e of args.entries) {
    const row = byId.get(e.itemId);
    if (!row) continue;
    const fromDate = row.tentativeDispatchDate ? str(row.tentativeDispatchDate).slice(0, 10) : null;
    const toDate = String(e.date);
    await prisma.crmSoItem.update({
      where: { id: e.itemId },
      data: {
        dispatchState: 'scheduled',
        tentativeDispatchDate: toDate,
        delayReason: str(args.reason || '') || null,
        scheduledBy: args.actor || str(row.scheduledBy) || '',
        scheduledAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await writeEvent({
      soId: str(orderRow.id),
      soNumber: str(orderRow.soNumber),
      kind: 'reschedule',
      itemId: e.itemId,
      fromDate,
      toDate,
      reason: str(args.reason || ''),
      actor: args.actor,
      day: today,
    });
  }

  const fresh = await loadRawItems(str(orderRow.id));
  const lifecycle = await refreshLifecycle(orderRow, fresh);
  return { order: await getOrder(str(orderRow.id)), lifecycle };
}

/**
 * Dispatch scheduled items. Quantity defaults to the full remaining amount;
 * a partial quantity leaves the item `scheduled` with `dispatchedQty` recorded.
 *
 * SCORING: the first dispatch action on an order credits Dispatch +50 (whole
 * order) or +25 (partial). Later batches score nothing, and the Zoho-driven
 * "Order shipped" credit is skipped once a local dispatch credit exists —
 * one shipment must never score twice.
 */
export async function dispatchOrder(args: {
  idOrSo: string;
  entries: DispatchEntry[];
  actor?: string | null;
  today?: string;
}): Promise<ActionResult & { credited: boolean }> {
  const today = args.today || istToday();
  const orderRow = await loadRawOrder(args.idOrSo);
  const itemRows = await loadRawItems(str(orderRow.id));
  assertWorkable(orderRow, str(orderRow.lifecycle));

  const items = itemRows.map((r) => ({
    id: str(r.id),
    dispatchState: str(r.dispatchState) as ItemState,
    tentativeDispatchDate: r.tentativeDispatchDate ? str(r.tentativeDispatchDate).slice(0, 10) : null,
    delayReason: r.delayReason ?? null,
    qty: num(r.qty),
    dispatchedQty: num(r.dispatchedQty),
  })) as ItemLike[];

  const check = validateDispatch({ items, entries: args.entries });
  if (!check.ok) throw new CrmError(check.message, 400, check.code);

  const byId = new Map(itemRows.map((r) => [str(r.id), r]));
  const now = new Date();
  for (const e of args.entries) {
    const row = byId.get(e.itemId);
    if (!row) continue;
    const item = items.find((it) => it.id === e.itemId);
    const qty = resolveDispatchQty(item, e);
    const total = num(row.qty);
    const nextQty = Math.min(total, num(row.dispatchedQty) + qty);
    const complete = nextQty >= total - 1e-6;
    await prisma.crmSoItem.update({
      where: { id: e.itemId },
      data: {
        dispatchState: complete ? 'dispatched' : 'scheduled',
        dispatchedQty: nextQty,
        dispatchedAt: complete ? now : iso(row.dispatchedAt) ? new Date(row.dispatchedAt) : now,
        updatedAt: now,
      },
    });
    await writeEvent({
      soId: str(orderRow.id),
      soNumber: str(orderRow.soNumber),
      kind: complete ? 'dispatch' : 'partial_dispatch',
      itemId: e.itemId,
      toDate: row.tentativeDispatchDate ? str(row.tentativeDispatchDate).slice(0, 10) : null,
      qty,
      actor: args.actor,
      day: today,
    });
  }

  const fresh = await loadRawItems(str(orderRow.id));
  const lifecycle = await refreshLifecycle(orderRow, fresh);
  const credited = await creditDispatch(
    str(orderRow.soNumber),
    lifecycle === 'dispatched',
    args.actor || null,
    today,
  );
  return { order: await getOrder(str(orderRow.id)), lifecycle, credited };
}

// ── Points ─────────────────────────────────────────────────────────────────

/**
 * One dispatch credit per sales order, ever. Zoho's own ship-completion credit
 * (`Order shipped`, dispatch dept) suppresses the local one and vice versa —
 * the snapshot route calls this same check before crediting.
 */
export async function hasDispatchCredit(soNumber: string): Promise<boolean> {
  if (!soNumber) return false;
  // The Zoho-driven credit keys rows by `org:soNumber`, the local one by bare
  // `soNumber` — match both so neither path can double-credit a shipment.
  const row: any =
    (await prisma.departmentScoreEvent.findFirst({ where: { dept: 'dispatch', soNumber } })) ||
    (await prisma.departmentScoreEvent.findFirst({
      where: { dept: 'dispatch', soNumber: { endsWith: `:${soNumber}` } },
    }));
  return !!row;
}

async function creditDispatch(
  soNumber: string,
  full: boolean,
  actor: string | null,
  day: string,
): Promise<boolean> {
  if (!soNumber) return false;
  try {
    if (await hasDispatchCredit(soNumber)) return false;
    await prisma.departmentScoreEvent.create({
      data: {
        id: crypto.randomUUID(),
        dept: 'dispatch',
        soNumber,
        points: full ? 50 : 25,
        reason: full ? 'Order dispatched (dispatch floor)' : 'Partial dispatch (dispatch floor)',
        actor: actor || null,
        day,
      },
    });
    return true;
  } catch (e: any) {
    logger.warn({ err: e?.message, so: soNumber }, 'crm: dispatch points write failed');
    return false;
  }
}

// ── Source deletion ────────────────────────────────────────────────────────

/** Human confirmation on a `deleted_source` row → purge the order + items. */
export async function confirmSourceDeletion(args: {
  idOrSo: string;
  actor?: string | null;
  today?: string;
}): Promise<{ soNumber: string; removed: boolean }> {
  const orderRow = await loadRawOrder(args.idOrSo);
  if (str(orderRow.sourceState) !== 'deleted_source') {
    throw new CrmError('Only orders flagged as deleted at source can be confirmed.', 409, 'not_deleted');
  }
  const soNumber = str(orderRow.soNumber);
  // Audit first — the event survives the row purge (no FK on purpose).
  await writeEvent({
    soId: str(orderRow.id),
    soNumber,
    kind: 'confirmed_removal',
    reason: 'Confirmed deleted at source — removed locally',
    actor: args.actor,
    day: args.today || istToday(),
  });
  await prisma.crmSoItem.deleteMany({ where: { soId: str(orderRow.id) } });
  await prisma.crmSalesOrder.deleteMany({ where: { id: str(orderRow.id) } });
  return { soNumber, removed: true };
}

// ── Sync (runner → rows) ───────────────────────────────────────────────────

export interface SyncedOrder {
  so: string;
  org?: string;
  zohoId?: string;
  customer?: string;
  customerId?: string;
  total?: number;
  currency?: string;
  status?: string;
  orderStatus?: string;
  invoicedStatus?: string;
  shippedStatus?: string;
  paidStatus?: string;
  salesperson?: string;
  ref?: string;
  createdDate?: string;
  createdTime?: string;
  /** Full line items — present only when the runner fetched this order's detail. */
  items?: any[];
}

export interface SyncVerify {
  /** Orders the runner re-checked by id and Zoho still returns. */
  present?: string[];
  /** Orders the runner re-checked by id and Zoho returned 404. */
  gone?: string[];
}

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  itemsUpserted: number;
  missIncremented: number;
  flagged: number;
  healed: number;
  missing: Array<{ so: string; org: string; zohoId: string }>;
}

// ── Department scoring (the CRM ↔ Accounts ↔ Procurement points game) ───────
//
// These credits used to be produced by diffing the KV snapshot inside
// /api/runner/crm/snapshot. That route is retired, so the SAME rules now run
// against the D1 row's previous Zoho statuses during sync — one ledger, one
// source of truth, no blob:
//
//   new SO created today      → CRM +25
//   left the confirm stage    → CRM +50 and Procurement +25 (material allocated)
//   left the invoice stage    → Accounts +50
//   left the ship stage       → Dispatch +50 (suppressed if the floor scored it)
//   closed as paid            → Accounts +100 (plus every stage completion)
//   closed cancelled/void     → −20 to the dept owning the stage it reached
const SCORE_STAGES = ['confirm', 'invoice', 'ship', 'payment'] as const;
type ScoreStage = (typeof SCORE_STAGES)[number];

const STAGE_DEPT: Record<ScoreStage, string> = {
  confirm: 'crm',
  invoice: 'accounts',
  ship: 'dispatch',
  payment: 'accounts',
};

const STAGE_COMPLETION: Record<ScoreStage, Array<[string, number, string]>> = {
  confirm: [
    ['crm', 50, 'Sales order confirmed'],
    ['procurement', 25, 'Material allocated — cleared confirm'],
  ],
  invoice: [['accounts', 50, 'Invoice raised']],
  ship: [['dispatch', 50, 'Order shipped']],
  payment: [['accounts', 100, 'Payment received']],
};

/** Furthest pipeline stage an order has reached, from its Zoho statuses. */
function orderStage(o: {
  status?: string;
  orderStatus?: string;
  invoicedStatus?: string;
  shippedStatus?: string;
  paidStatus?: string;
}): ScoreStage | 'complete' {
  const status = str(o.status).toLowerCase();
  if (status === 'cancelled' || status === 'void') return 'complete';
  if (str(o.paidStatus).toLowerCase() === 'paid') return 'complete';
  if (str(o.shippedStatus).toLowerCase() === 'shipped') return 'payment';
  if (str(o.invoicedStatus).toLowerCase() === 'invoiced') return 'ship';
  if (str(o.orderStatus).toLowerCase() === 'confirmed') return 'invoice';
  return 'confirm';
}

/**
 * The floor only tracks RECENT orders. Zoho Books holds years of history and
 * thousands of legacy open orders — syncing all of them would make the floor
 * unusable and the line-item fetch (one Zoho call per order, rate limited)
 * would never catch up. Anything older stays in Zoho; the floor is the
 * current flow.
 */
const FLOOR_WINDOW_DAYS = 30;

function dayAdd(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Zoho `complete` predicate — mirrors the runner's pendingStep() === 'complete'. */
function isCompleteInZoho(o: SyncedOrder): boolean {
  const status = str(o.status).toLowerCase();
  if (status === 'cancelled' || status === 'void') return true;
  const orderStatus = str(o.orderStatus).toLowerCase();
  const paidStatus = str(o.paidStatus).toLowerCase();
  return paidStatus === 'paid' || orderStatus === 'closed';
}

function lineKeyFor(li: any, index: number): string {
  const id = str(li?.line_item_id || li?.item_id || '').trim();
  if (id) return id;
  const sku = str(li?.sku || li?.item_code || '').trim();
  if (sku) return `sku:${sku}:${index}`;
  return `L${index}`;
}

/**
 * Upsert one tick of Zoho rows into D1.
 *
 * - new OPEN order            → row at `unscheduled`
 * - existing order            → Zoho fields refreshed, local scheduling untouched
 * - brand-new COMPLETE order  → skipped (it was never on the floor)
 * - order absent from the tick→ missCount++, flagged at 2 (or immediately when
 *                               the runner verified a 404 by id)
 * - flagged order reappears   → self-heals back to active
 */
export async function syncOrders(args: {
  day: string;
  orders: SyncedOrder[];
  verify?: SyncVerify;
}): Promise<SyncResult> {
  const day = args.day || istToday();
  const orders = Array.isArray(args.orders) ? args.orders : [];
  const verifyPresent = new Set((args.verify?.present || []).map((k) => String(k)));
  const verifyGone = new Set((args.verify?.gone || []).map((k) => String(k)));

  const cutoff = dayAdd(day, -FLOOR_WINDOW_DAYS);
  const existingRows = (await prisma.crmSalesOrder.findMany({ take: 4000 })) as any[];
  const byKey = new Map<string, any>();
  for (const r of existingRows) byKey.set(soKey(str(r.org), str(r.soNumber)), r);

  const result: SyncResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    itemsUpserted: 0,
    missIncremented: 0,
    flagged: 0,
    healed: 0,
    missing: [],
  };

  const seen = new Set<string>();
  const toCreate: any[] = [];
  // Stage-completion credits for orders that advanced this tick.
  const stageCredits: Array<{ dept: string; soNumber: string; points: number; reason: string; actor: string | null }> = [];
  const awardStages = (
    fromIdx: number,
    toIdx: number,
    soNumber: string,
    salesperson: string | null,
    shipAlreadyCredited: boolean,
  ) => {
    for (let i = Math.max(0, fromIdx); i <= toIdx && i < SCORE_STAGES.length; i++) {
      const stage = SCORE_STAGES[i];
      // One shipment never scores twice: skip the Zoho ship credit when the
      // dispatch floor already credited the order locally.
      if (stage === 'ship' && shipAlreadyCredited) continue;
      for (const [dept, points, reason] of STAGE_COMPLETION[stage] || []) {
        stageCredits.push({
          dept,
          soNumber,
          points,
          reason,
          actor: dept === 'crm' || dept === 'dispatch' ? salesperson : null,
        });
      }
    }
  };
  const newOrderCredits: Array<{ soNumber: string; salesperson: string | null; day: string }> = [];
  const withItems: Array<{ soId: string; items: any[] }> = [];
  const now = new Date();
  const today = istToday();

  for (const o of orders) {
    const soNumber = str(o?.so).trim();
    if (!soNumber) continue;
    const org = str(o?.org);
    const key = soKey(org, soNumber);
    seen.add(key);
    const existing = byKey.get(key);
    const cancelled = CANCELLED_STATUSES.has(str(o.status).toLowerCase());
    const createdDate = str(o.createdDate || o.createdTime).slice(0, 10);

    if (!existing) {
      if (isCompleteInZoho(o) && !cancelled) {
        // Never on the floor — do not create history rows for closed orders.
        result.skipped++;
        continue;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(createdDate) && createdDate < cutoff) {
        // Older than the floor window — Zoho keeps it, the floor does not.
        result.skipped++;
        continue;
      }
      const id = crypto.randomUUID();
      toCreate.push({
        id,
        org,
        soNumber,
        zohoId: str(o.zohoId),
        customerName: str(o.customer),
        customerId: str(o.customerId),
        value: num(o.total),
        currency: str(o.currency) || 'INR',
        orderStatus: str(o.orderStatus).toLowerCase(),
        invoicedStatus: str(o.invoicedStatus).toLowerCase(),
        shippedStatus: str(o.shippedStatus).toLowerCase(),
        paidStatus: str(o.paidStatus).toLowerCase(),
        status: str(o.status).toLowerCase() || 'open',
        salesperson: str(o.salesperson),
        referenceNumber: str(o.ref).slice(0, 120),
        createdDate,
        lifecycle: cancelled ? 'cancelled' : 'unscheduled',
        sourceState: 'active',
        soDelayReason: null,
        fingerprint: '',
        missCount: 0,
        firstSeenAt: now,
        lastSeenAt: now,
        deletedDetectedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      if (!cancelled && createdDate === today) {
        // New-order points only when Zoho says it was created today (never
        // re-credit on a cold start).
        newOrderCredits.push({ soNumber, salesperson: str(o.salesperson) || null, day });
      }
      if (Array.isArray(o.items) && o.items.length) withItems.push({ soId: id, items: o.items });
      continue;
    }

    // Steady-state ticks must be nearly free: if nothing Zoho-side moved,
    // skip the write entirely (the row is already `seen`, which is all the
    // deletion detector needs).
    const fp = [
      str(o.status).toLowerCase(),
      str(o.orderStatus).toLowerCase(),
      str(o.invoicedStatus).toLowerCase(),
      str(o.shippedStatus).toLowerCase(),
      str(o.paidStatus).toLowerCase(),
      String(num(o.total)),
      str(o.customer),
      str(o.salesperson),
      createdDate || str(existing.createdDate),
    ].join('|');
    const healedNow = str(existing.sourceState) === 'deleted_source';
    if (str(existing.fingerprint) === fp && !healedNow) {
      result.unchanged++;
      if (Array.isArray(o.items) && o.items.length) withItems.push({ soId: str(existing.id), items: o.items });
      continue;
    }
    await prisma.crmSalesOrder.update({
      where: { id: str(existing.id) },
      data: {
        fingerprint: fp,
        zohoId: str(o.zohoId) || str(existing.zohoId),
        customerName: str(o.customer) || str(existing.customerName),
        customerId: str(o.customerId) || str(existing.customerId),
        value: num(o.total),
        currency: str(o.currency) || str(existing.currency) || 'INR',
        orderStatus: str(o.orderStatus).toLowerCase(),
        invoicedStatus: str(o.invoicedStatus).toLowerCase(),
        shippedStatus: str(o.shippedStatus).toLowerCase(),
        paidStatus: str(o.paidStatus).toLowerCase(),
        status: str(o.status).toLowerCase() || str(existing.status),
        salesperson: str(o.salesperson) || str(existing.salesperson),
        referenceNumber: str(o.ref).slice(0, 120) || str(existing.referenceNumber),
        createdDate: createdDate || str(existing.createdDate),
        sourceState: 'active',
        missCount: 0,
        deletedDetectedAt: null,
        lastSeenAt: now,
        updatedAt: now,
      },
    });
    result.updated++;
    if (healedNow) result.healed++;

    // ── Department points for pipeline movement ────────────────────────────
    // Only orders we already track are scored (a first sighting is never
    // back-credited — a cold start must not flood the ledger).
    if (!healedNow) {
      const prevStage = orderStage({
        status: str(existing.status),
        orderStatus: str(existing.orderStatus),
        invoicedStatus: str(existing.invoicedStatus),
        shippedStatus: str(existing.shippedStatus),
        paidStatus: str(existing.paidStatus),
      });
      const nextStage = orderStage(o as any);
      const cancelledNow = CANCELLED_STATUSES.has(str(o.status).toLowerCase());
      const wasCancelled = CANCELLED_STATUSES.has(str(existing.status).toLowerCase());
      if (cancelledNow && !wasCancelled) {
        // Order pulled out of the pipeline — the desk holding it takes the hit.
        stageCredits.push({
          dept: STAGE_DEPT[prevStage as ScoreStage] || 'crm',
          soNumber,
          points: -20,
          reason: `Order cancelled (was in ${prevStage})`,
          actor: str(o.salesperson) || null,
        });
      } else if (!cancelledNow) {
        const prevIdx = SCORE_STAGES.indexOf(prevStage as ScoreStage);
        const nextIdx = SCORE_STAGES.indexOf(nextStage as ScoreStage);
        if (prevStage === 'complete') {
          // Reopened after closing — nothing to credit, never a double score.
        } else if (nextStage === 'complete') {
          // Closed paid: every remaining stage completion is implied.
          const shipDone = await hasDispatchCredit(soNumber);
          awardStages(prevIdx < 0 ? 0 : prevIdx, SCORE_STAGES.length - 1, soNumber, str(o.salesperson) || null, shipDone);
        } else if (nextIdx > prevIdx) {
          const shipDone = await hasDispatchCredit(soNumber);
          awardStages(prevIdx < 0 ? 0 : prevIdx, nextIdx - 1, soNumber, str(o.salesperson) || null, shipDone);
        }
        // A regression (credit note / manual revert) scores nothing.
      }
    }
    if (Array.isArray(o.items) && o.items.length) withItems.push({ soId: str(existing.id), items: o.items });
  }

  // Bulk insert the new rows. D1 caps bound parameters per statement, so the
  // batch is split into small chunks — still far cheaper than one INSERT +
  // SELECT round trip per order (which blew the 90s runner timeout).
  if (toCreate.length) {
    result.created = await insertOrders(toCreate);
  }

  for (const { soId, items } of withItems) {
    result.itemsUpserted += await upsertItems(soId, items);
  }

  // Mark rows missing from this tick.
  for (const [key, row] of byKey) {
    if (seen.has(key)) continue;
    if (str(row.sourceState) !== 'active') continue;
    // A row older than the floor window may simply be outside the scan — never
    // let the deletion detector flag history. An UNPARSEABLE created date is
    // equally untrustworthy: refuse to flag rather than risk deleting a live
    // order because a formatted date slipped into an ISO column.
    const rowCreated = str(row.createdDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rowCreated)) continue;
    if (rowCreated < cutoff) continue;
    const soNumber = str(row.soNumber);
    const org = str(row.org);
    const verifiedPresent = verifyPresent.has(key) || verifyPresent.has(soNumber);
    const verifiedGone = verifyGone.has(key) || verifyGone.has(soNumber);
    if (verifiedPresent) {
      if (num(row.missCount) !== 0) {
        await prisma.crmSalesOrder.update({ where: { id: str(row.id) }, data: { missCount: 0, updatedAt: now } });
      }
      continue;
    }
    const missCount = num(row.missCount) + 1;

    if (verifiedGone || missCount >= 2) {
      await prisma.crmSalesOrder.update({
        where: { id: str(row.id) },
        data: { sourceState: 'deleted_source', missCount, deletedDetectedAt: now, updatedAt: now },
      });
      await writeEvent({
        soId: str(row.id),
        soNumber,
        kind: 'source_deleted',
        reason: 'Zoho stopped returning this sales order',
        day,
      });
      result.flagged++;
      continue;
    }

    await prisma.crmSalesOrder.update({
      where: { id: str(row.id) },
      data: { missCount, updatedAt: now },
    });
    result.missIncremented++;
    result.missing.push({ so: soNumber, org, zohoId: str(row.zohoId) });
  }

  // Stage completions detected above (status moves since the last tick).
  const scoreEvents: any[] = stageCredits.map((c) => ({
    id: crypto.randomUUID(),
    dept: c.dept,
    soNumber: c.soNumber,
    points: c.points,
    reason: c.reason,
    actor: c.actor,
    day,
  }));
  for (const c of newOrderCredits) {
    scoreEvents.push({
      id: crypto.randomUUID(),
      dept: 'crm',
      soNumber: c.soNumber,
      points: 25,
      reason: 'New sales order created',
      actor: c.salesperson,
      day: c.day,
    });
  }
  if (scoreEvents.length) {
    try {
      await prisma.departmentScoreEvent.createMany({ data: scoreEvents });
    } catch (e: any) {
      logger.warn({ err: e?.message, events: scoreEvents.length }, 'crm sync: points write failed');
    }
  }

  // Only orders that actually received items can change lifecycle — anything
  // else keeps its stored state (items were not fetched this tick).
  if (withItems.length) {
    const ids = [...new Set(withItems.map((w) => w.soId))];
    await recomputeLifecyclesById(ids);
  }

  return result;
}

/** Column order is fixed so the raw INSERT is identical on every chunk. */
const ORDER_COLS = [
  'id', 'org', 'soNumber', 'zohoId', 'customerName', 'customerId', 'value', 'currency',
  'orderStatus', 'invoicedStatus', 'shippedStatus', 'paidStatus', 'status', 'salesperson',
  'referenceNumber', 'createdDate', 'lifecycle', 'sourceState', 'soDelayReason',
  'fingerprint', 'missCount', 'firstSeenAt', 'lastSeenAt', 'deletedDetectedAt',
  'createdAt', 'updatedAt',
] as const;

function sqlValue(v: any): any {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

/**
 * Bulk insert new orders.
 *
 * D1 caps bound parameters per statement (~100), so rows are packed 3 per
 * INSERT; and because the Worker's D1 client exposes `batch()` (one network
 * round trip for many statements), the statements themselves go out in
 * chunks. A per-row INSERT loop was costing ~1s per 10 orders and blew the
 * runner's 90s request budget.
 */
async function insertOrders(rows: any[]): Promise<number> {
  if (!rows.length) return 0;
  const cols = ORDER_COLS as readonly string[];
  const perStatement = Math.max(1, Math.floor(90 / cols.length));
  const statements: { sql: string; params: any[] }[] = [];
  const colList = cols.map((c) => `"${c}"`).join(', ');

  for (let i = 0; i < rows.length; i += perStatement) {
    const chunk = rows.slice(i, i + perStatement);
    const tuples: string[] = [];
    const params: any[] = [];
    for (const r of chunk) {
      tuples.push(`(${cols.map(() => '?').join(', ')})`);
      for (const c of cols) params.push(sqlValue(r[c]));
    }
    statements.push({
      sql: `INSERT OR IGNORE INTO "CrmSalesOrder" (${colList}) VALUES ${tuples.join(', ')}`,
      params,
    });
  }

  const batch = (prisma as any).batch;
  if (typeof batch !== 'function') {
    // Express/Postgres runtime — no D1 batch, plain per-chunk inserts.
    let written = 0;
    for (let i = 0; i < rows.length; i += perStatement) {
      try {
        const res = await prisma.crmSalesOrder.createMany({ data: rows.slice(i, i + perStatement) });
        written += res?.count ?? 0;
      } catch (e: any) {
        logger.warn({ err: e?.message }, 'crm sync: order insert failed');
      }
    }
    return written;
  }

  // D1 batch: 50 statements per round trip (150 orders) — comfortably inside
  // D1's per-batch statement limit.
  const BATCH = 50;
  let written = 0;
  for (let i = 0; i < statements.length; i += BATCH) {
    const slice = statements.slice(i, i + BATCH);
    try {
      const results = await batch.call(prisma, slice);
      for (const r of results || []) written += Number(r?.meta?.changes ?? 0);
    } catch (e: any) {
      logger.warn({ err: e?.message, statements: slice.length }, 'crm sync: order batch insert failed');
    }
  }
  return written;
}

const ITEM_COLS = [
  'id', 'soId', 'lineKey', 'name', 'sku', 'description', 'qty', 'unit', 'rate',
  'itemTotal', 'dispatchState', 'tentativeDispatchDate', 'delayReason',
  'dispatchedQty', 'dispatchedAt', 'scheduledBy', 'scheduledAt', 'createdAt', 'updatedAt',
] as const;

/** Bulk-insert items for an order that has none yet (the new-order path). */
async function insertItems(rows: any[]): Promise<number> {
  if (!rows.length) return 0;
  const perStatement = Math.max(1, Math.floor(90 / (ITEM_COLS as readonly string[]).length));
  let written = 0;
  for (let i = 0; i < rows.length; i += perStatement) {
    const chunk = rows.slice(i, i + perStatement);
    try {
      const res = await prisma.crmSoItem.createMany({ data: chunk });
      written += res?.count ?? chunk.length;
    } catch (e: any) {
      logger.warn({ err: e?.message }, 'crm sync: item insert failed');
    }
  }
  return written;
}

async function upsertItems(soId: string, rawItems: any[]): Promise<number> {
  const existing = (await prisma.crmSoItem.findMany({ where: { soId } })) as any[];
  const byKey = new Map(existing.map((r) => [str(r.lineKey), r]));
  const now = new Date();
  let written = 0;
  const seenKeys = new Set<string>();

  const pending: any[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const li = rawItems[i] || {};
    const lineKey = lineKeyFor(li, i);
    if (seenKeys.has(lineKey)) continue;
    seenKeys.add(lineKey);
    const qty = num(li.quantity ?? li.qty);
    const rate = num(li.rate);
    const itemTotal = num(li.item_total) || Math.round(qty * rate * 100) / 100;
    const payload = {
      name: str(li.name).slice(0, 300),
      sku: str(li.sku || li.item_code).slice(0, 120),
      description: str(li.description).slice(0, 500),
      qty,
      unit: str(li.unit).slice(0, 40),
      rate,
      itemTotal,
      updatedAt: now,
    };
    const found = byKey.get(lineKey);
    if (found) {
      // NEVER clobber local scheduling state — only the Zoho-side fields.
      await prisma.crmSoItem.update({ where: { id: str(found.id) }, data: payload });
    } else {
      pending.push({
        id: crypto.randomUUID(),
        soId,
        lineKey,
        ...payload,
        dispatchState: 'unscheduled',
        tentativeDispatchDate: null,
        delayReason: null,
        dispatchedQty: 0,
        dispatchedAt: null,
        scheduledBy: null,
        scheduledAt: null,
        createdAt: now,
      });
    }
    written++;
  }
  if (pending.length) await insertItems(pending);
  return written;
}

async function recomputeLifecyclesById(ids: string[]): Promise<void> {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += ITEM_BATCH) {
    const chunk = ids.slice(i, i + ITEM_BATCH);
    const rows = (await prisma.crmSalesOrder.findMany({ where: { id: { in: chunk } } })) as any[];
    const itemsBySo = await itemsForOrders(chunk);
    for (const r of rows) {
      const items = itemsBySo.get(str(r.id)) || [];
      if (!items.length) continue; // items not fetched this tick — keep state
      const lifecycle = deriveLifecycle(
        items.map((it) => ({
          id: it.id,
          dispatchState: it.dispatchState,
          tentativeDispatchDate: it.tentativeDispatchDate,
          qty: it.qty,
          dispatchedQty: it.dispatchedQty,
        })) as ItemLike[],
        { status: str(r.status), orderStatus: str(r.orderStatus) },
      );
      if (lifecycle !== str(r.lifecycle)) {
        await prisma.crmSalesOrder.update({ where: { id: str(r.id) }, data: { lifecycle, updatedAt: new Date() } });
      }
    }
  }
}

/** Dashboard headline counters (cheap — the floor is open orders only). */
export async function dispatchSummary(today = istToday()): Promise<Record<string, number>> {
  const rows = (await prisma.crmSalesOrder.findMany({ take: 4000 })) as any[];
  const itemsBySo = await itemsForOrders(rows.map((r) => str(r.id)));
  const counts: Record<string, number> = {
    total: 0,
    unscheduled: 0,
    partiallyScheduled: 0,
    scheduled: 0,
    partiallyDispatched: 0,
    dispatched: 0,
    cancelled: 0,
    deletedSource: 0,
    floorToday: 0,
    overdue: 0,
  };
  for (const r of rows) {
    const items = itemsBySo.get(str(r.id)) || [];
    if (str(r.sourceState) === 'deleted_source') {
      counts.deletedSource++;
      continue;
    }
    counts.total++;
    const lifecycle = str(r.lifecycle);
    if (lifecycle === 'unscheduled') counts.unscheduled++;
    else if (lifecycle === 'partially_scheduled') counts.partiallyScheduled++;
    else if (lifecycle === 'scheduled') counts.scheduled++;
    else if (lifecycle === 'partially_dispatched') counts.partiallyDispatched++;
    else if (lifecycle === 'dispatched') counts.dispatched++;
    else if (lifecycle === 'cancelled') counts.cancelled++;
    if (lifecycle !== 'cancelled') {
      if (items.some((it) => it.dispatchState === 'scheduled' && it.tentativeDispatchDate === today)) counts.floorToday++;
      if (items.some((it) => isOverdueItem(it as ItemLike, today))) counts.overdue++;
    }
  }
  return counts;
}
