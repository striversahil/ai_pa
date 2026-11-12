// Extracted verbatim from store.ts by scripts/refactor/split-module.mjs.
// store.ts re-exports everything public here, so existing imports keep working.
import { istToday, soKey, CANCELLED_STATUSES } from "../types";
import type { CrmOrderRow, CrmItemRow, View, EventKind, Lifecycle, ItemState } from "../types";
import { orderFlags, orderMatchesView, salesBucket } from "../queues";
import type { ViewOrder } from "../queues";
import { prisma } from "../../../shared/prisma";
import { normalizeRegionFilter, regionMatches, buildEstimateRegionIndex, resolveOrderRegion } from "../region";
import type { EstimateRegionIndex } from "../region";
import { deriveLifecycle, effectiveQty, validateSchedule, validateReschedule, validateDispatch, resolveDispatchQty, validateAmend, validateLocalCancel, isOverdueItem } from "../scheduling";
import type { DispatchProof, ItemLike, ScheduleEntry, RescheduleEntry, DispatchEntry, AmendQtyChange, AmendRemove, AmendAdd } from "../scheduling";
import { logger } from "../../../shared/logger";
import { ITEM_BATCH, toItemView, str, toOrderView, num, iso, proofFile, CrmError, isPdfFile, isImageFile, assertWorkable, mirrorOrderTouch, PROOF_DOC_SLOTS, PROOF_DOC_RULES, REGION_LOOKUP_BATCH, dayAdd, FLOOR_WINDOW_DAYS, SCORE_STAGES, STAGE_COMPLETION, isCompleteInZoho, orderStage, STAGE_DEPT, ORDER_COLS, sqlValue, ITEM_COLS, isChargeLine, lineKeyFor } from "./pure";
import type { ListArgs, ProofFile, ActionResult, ProofDocSlot, SyncedOrder, SyncVerify, SyncResult, ScoreStage } from "./types";

/** Attach the derived flags the UI needs (overdue / due-today / can-*). */
export function withFlags(order: CrmOrderRow, today: string): CrmOrderRow {
  const flags = orderFlags(order as ViewOrder, today);
  return { ...order, overdue: flags.overdue, dueToday: flags.dueToday };
}

export async function itemsForOrders(ids: string[]): Promise<Map<string, CrmItemRow[]>> {
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
  const region = normalizeRegionFilter(args.region);
  const filtered = orders.filter((o) => {
    if (o.sourceState === 'deleted_source' && view !== 'source-deleted') return false;
    if (!regionMatches(o.region, region)) return false;
    if (!matchesView(o, view, today)) return false;
    if (!q) return true;
    return (
      o.soNumber.toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      o.salesperson.toLowerCase().includes(q) ||
      o.referenceNumber.toLowerCase().includes(q)
    );
  });

  // Every tab reads newest-first: most recent SO at the top, tie-broken by SO
  // number descending (same-day orders). Overdue / due-today work is badged on
  // the card and counted in the KPIs, so it no longer reorders the list — the
  // desk works one rolling, newest-first stack.
  filtered.sort(sortNewestFirst);
  // Phase 4a floor shadow (floor-read-only, log-only): compare Crm* vs core
  // order spine + log diffs. Served values never change.
  try {
    const { shadowCompareFloor } = await import('../../core/orders');
    await shadowCompareFloor();
  } catch { /* never block the floor */ }
  return filtered.slice(0, limit);
}

/** Newest Zoho creation date first; same day → highest SO number first. */
export function sortNewestFirst(a: CrmOrderRow, b: CrmOrderRow): number {
  const da = a.createdDate || '';
  const db = b.createdDate || '';
  if (da !== db) return da < db ? 1 : -1;
  return a.soNumber < b.soNumber ? 1 : a.soNumber > b.soNumber ? -1 : 0;
}

export function matchesView(o: CrmOrderRow, view: View, today: string): boolean {
  // queues.ts is the single source of truth — the frontend mirror asserts
  // parity in scripts/guards/crm-lifecycle.test.mjs.
  return orderMatchesView(o as ViewOrder, view, today);
}

/** Region of one order — the authz check for an agent's promise-date write.
 *  Cheap single-column read; null when the order does not exist. */
export async function orderRegion(idOrSo: string): Promise<string | null> {
  const row: any =
    (await prisma.crmSalesOrder.findFirst({ where: { id: idOrSo }, select: { region: true } })) ||
    (await prisma.crmSalesOrder.findFirst({ where: { soNumber: idOrSo }, select: { region: true } }));
  if (!row) return null;
  return str(row.region);
}

/** Full order (with items + audit trail + consumed dispatch proofs) by row id or SO number. */
export async function getOrder(
  idOrSo: string,
): Promise<(CrmOrderRow & { events: any[]; proofs: any[] }) | null> {
  const row: any =
    (await prisma.crmSalesOrder.findFirst({ where: { id: idOrSo } })) ||
    (await prisma.crmSalesOrder.findFirst({ where: { soNumber: idOrSo } }));
  if (!row) return null;
  const itemRows = (await prisma.crmSoItem.findMany({ where: { soId: str(row.id) }, orderBy: { lineKey: 'asc' } })) as any[];
  const events = (await prisma.crmScheduleEvent.findMany({ where: { soId: str(row.id) }, orderBy: { createdAt: 'desc' }, take: 100 })) as any[];
  const order = withFlags(toOrderView(row, itemRows.map(toItemView)), istToday());  return {
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
    proofs: await proofsForOrder(str(row.id), itemRows, events),
  };
}

/** Dispatch proofs for one order (newest first) — each row carries the batch
 *  snapshot (items + quantities) written at dispatch time, plus the resolved
 *  files of every slot. Rows predating the `items` column (0107) backfill from
 *  the dispatch audit events on the same day so earlier batches still list what
 *  went out. Files are resolved here (fileName/mime/size/url) so the panel can
 *  draw a thumbnail and open the image/PDF in the shared big-view components
 *  without one extra round-trip per file. */
export async function proofsForOrder(soId: string, itemRows?: any[], eventRows?: any[]): Promise<any[]> {
  try {
    const rows = (await prisma.crmDispatchProof.findMany({
      where: { soId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })) as any[];
    const nameOf = new Map<string, { name: string; unit: string }>();
    for (const r of itemRows || []) {
      nameOf.set(str((r as any)?.id), {
        name: str((r as any)?.name || (r as any)?.description || (r as any)?.sku || 'Item'),
        unit: str((r as any)?.unit),
      });
    }
    const eventsByDay = new Map<string, any[]>();
    for (const e of eventRows || []) {
      if (str((e as any)?.kind) !== 'dispatch' && str((e as any)?.kind) !== 'partial_dispatch') continue;
      const day = str((e as any)?.day);
      const list = eventsByDay.get(day) || [];
      list.push(e);
      eventsByDay.set(day, list);
    }
    // Resolve every file of every proof in ONE query (5–6 ids per proof).
    const ids = new Set<string>();
    for (const p of rows) {
      for (const k of ['invoiceId', 'beforeId', 'afterId', 'transportId', 'courierId', 'packingListId']) {
        const v = str((p as any)[k]);
        if (v) ids.add(v);
      }
    }
    const files = new Map<string, ProofFile>();
    if (ids.size > 0) {
      // D1 caps ~100 bound parameters per statement — chunk the IN lookup so
      // an order with many past dispatches still resolves its thumbnails.
      const all = Array.from(ids);
      const chunks: string[][] = [];
      for (let i = 0; i < all.length; i += 50) chunks.push(all.slice(i, i + 50));
      try {
        const found = await Promise.all(
          chunks.map((chunk) =>
            prisma.soAttachment.findMany({ where: { id: { in: chunk } } }).catch(() => []),
          ),
        );
        for (const rowsOfChunk of found) {
          for (const row of (rowsOfChunk as any[]) ?? []) files.set(str(row.id), proofFile(row));
        }
      } catch {
        /* metadata best-effort — the IDs still render as inert tiles */
      }
    }
    const pickFile = (id: unknown): ProofFile | null => {
      const key = str(id);
      if (!key) return null;
      return (
        files.get(key) ?? {
          id: key,
          kind: '',
          fileName: '',
          mime: '',
          size: 0,
          url: `/api/crm/files/${key}`,
          uploadedBy: '',
          createdAt: null,
        }
      );
    };
    return rows.map((p) => {
      let items: any[] = [];
      try {
        const parsed = JSON.parse(str(p.items) || '[]');
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        items = [];
      }
      if (!items.length) {
        const fellows = eventsByDay.get(str(p.day)) || [];
        items = fellows
          .filter((e) => num((e as any)?.qty) > 0)
          .map((e) => {
            const meta = nameOf.get(str((e as any)?.itemId));
            return {
              itemId: str((e as any)?.itemId),
              name: meta?.name || 'Item',
              qty: num((e as any)?.qty),
              unit: meta?.unit || '',
            };
          });
      }
      return {
        id: str(p.id),
        invoiceId: str(p.invoiceId),
        beforeId: str(p.beforeId) || null,
        afterId: str(p.afterId) || null,
        transportId: str(p.transportId) || null,
        courierId: str(p.courierId) || null,
        packingListId: str(p.packingListId) || null,
        items,
        actor: str(p.actor),
        day: str(p.day),
        createdAt: iso(p.createdAt),
        files: {
          invoice: pickFile(p.invoiceId),
          before: pickFile(p.beforeId),
          after: pickFile(p.afterId),
          transport: pickFile(p.transportId),
          courier: pickFile(p.courierId),
          packingList: pickFile(p.packingListId),
        },
      };
    });
  } catch {
    return [];
  }
}

/**
 * Fresh-proof gate (2026-11-04): every dispatch consumes one fresh INVOICE
 * PDF. Before/after packing photos and the transport receipt / courier
 * receipt / packing list are optional — each is verified only when provided.
 * Verifies the files exist, belong to THIS soNumber, carry the right
 * kind/mime, and were never consumed by an earlier dispatch.
 */
export async function verifyDispatchProof(
  soId: string,
  soNumber: string,
  proof?: DispatchProof | null,
): Promise<{
  invoiceId: string;
  beforeId: string | null;
  afterId: string | null;
  transportId: string | null;
  courierId: string | null;
  packingListId: string | null;
}> {
  const pick = (v: unknown): string => String(v ?? '').trim();
  const invoiceId = pick((proof as any)?.invoiceId);
  const beforeId = pick((proof as any)?.beforeId) || null;
  const afterId = pick((proof as any)?.afterId) || null;
  const transportId = pick((proof as any)?.transportId) || null;
  const courierId = pick((proof as any)?.courierId) || null;
  const packingListId = pick((proof as any)?.packingListId) || null;
  if (!invoiceId) {
    throw new CrmError(
      'Add the invoice PDF before dispatching. Packing photos, receipts and the packing list are optional.',
      400,
      'proof_required',
    );
  }
  const load = (id: string | null) =>
    id ? prisma.soAttachment.findUnique({ where: { id } }).catch(() => null) : null;
  const [invoice, before, after, transport, courier, packingList] = (await Promise.all([
    load(invoiceId),
    load(beforeId),
    load(afterId),
    load(transportId),
    load(courierId),
    load(packingListId),
  ])) as any[];
  if (
    !invoice ||
    (beforeId && !before) ||
    (afterId && !after) ||
    (transportId && !transport) ||
    (courierId && !courier) ||
    (packingListId && !packingList)
  ) {
    throw new CrmError('Dispatch proof files not found — please re-upload them.', 400, 'proof_not_found');
  }
  const present = [invoice, before, after, transport, courier, packingList].filter(Boolean);
  for (const row of present) {
    if (str(row.soNumber) !== soNumber) {
      throw new CrmError('Dispatch proof belongs to a different sales order.', 400, 'proof_wrong_order');
    }
  }
  if (str(invoice.kind) !== 'invoice' || !isPdfFile(str(invoice.mime), str(invoice.fileName))) {
    throw new CrmError('The invoice proof must be a PDF uploaded as kind "invoice".', 400, 'proof_kind');
  }
  if (before && (str(before.kind) !== 'packing_before' || !isImageFile(str(before.mime), str(before.fileName)))) {
    throw new CrmError('The before-packing proof must be a photo uploaded as "before packing".', 400, 'proof_kind');
  }
  if (after && (str(after.kind) !== 'packing_after' || !isImageFile(str(after.mime), str(after.fileName)))) {
    throw new CrmError('The after-packing proof must be a photo uploaded as "after packing".', 400, 'proof_kind');
  }
  // The three extra docs accept a photo OR a PDF (receipts arrive both ways,
  // the packing list is usually a PDF).
  const docChecks: Array<[any, string, string]> = [
    [transport, 'transport_receipt', 'transport receipt'],
    [courier, 'courier_receipt', 'courier receipt'],
    [packingList, 'packing_list', 'packing list'],
  ];
  for (const [row, kind, label] of docChecks) {
    if (!row) continue;
    const mime = str(row.mime);
    const name = str(row.fileName);
    if (str(row.kind) !== kind || !(isPdfFile(mime, name) || isImageFile(mime, name))) {
      throw new CrmError(
        `The ${label} must be uploaded as "${label}" (photo or PDF).`,
        400,
        'proof_kind',
      );
    }
  }
  const reuseChecks = [prisma.crmDispatchProof.findFirst({ where: { invoiceId } }).catch(() => null)];
  const reuseCols: Array<[string, string | null]> = [
    ['beforeId', beforeId],
    ['afterId', afterId],
    ['transportId', transportId],
    ['courierId', courierId],
    ['packingListId', packingListId],
  ];
  for (const [col, id] of reuseCols) {
    if (id) reuseChecks.push(prisma.crmDispatchProof.findFirst({ where: { [col]: id } as any }).catch(() => null));
  }
  const reused = (await Promise.all(reuseChecks)) as any[];
  if (reused.some(Boolean)) {
    throw new CrmError(
      'This proof was already used for a dispatch — upload a fresh invoice. The other documents are optional.',
      400,
      'proof_reused',
    );
  }
  return { invoiceId, beforeId, afterId, transportId, courierId, packingListId };
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
    /** True once the detail pass captured the client addresses. */
    hasAddress: boolean;
    /** True once the detail pass captured the payment-terms line. */
    hasPaymentTerms: boolean;
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
      hasAddress: !!(str(r.billingAddress) || str(r.shippingAddress)),
      hasPaymentTerms: !!str(r.paymentTerms),
    })),
  };
}

export async function loadRawOrder(idOrSo: string): Promise<any> {
  const row: any =
    (await prisma.crmSalesOrder.findFirst({ where: { id: idOrSo } })) ||
    (await prisma.crmSalesOrder.findFirst({ where: { soNumber: idOrSo } }));
  if (!row) throw new CrmError('Sales order not found.', 404, 'not_found');
  return row;
}

export async function loadRawItems(soId: string): Promise<any[]> {
  return (await prisma.crmSoItem.findMany({ where: { soId }, orderBy: { lineKey: 'asc' } })) as any[];
}

export async function writeEvent(args: {
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

export async function refreshLifecycle(orderRow: any, items: any[]): Promise<Lifecycle> {
  const lifecycle = deriveLifecycle(
    items.map((it) => ({
      id: str(it.id),
      dispatchState: str(it.dispatchState) as ItemState,
      tentativeDispatchDate: it.tentativeDispatchDate ? str(it.tentativeDispatchDate).slice(0, 10) : null,
      delayReason: it.delayReason ?? null,
      qty: effectiveQty({ qty: num(it.qty), amendedQty: it.amendedQty ?? null }),
      dispatchedQty: num(it.dispatchedQty),
      removedAt: it.removedAt ? iso(it.removedAt) : null,
    })) as ItemLike[],
    { status: str(orderRow.status), orderStatus: str(orderRow.orderStatus) },
  );
  await prisma.crmSalesOrder.update({
    where: { id: str(orderRow.id) },
    data: { lifecycle, updatedAt: new Date() },
  });
  return lifecycle;
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
    qty: effectiveQty({ qty: num(r.qty), amendedQty: (r as any).amendedQty ?? null }),
    dispatchedQty: num(r.dispatchedQty),
    removedAt: (r as any).removedAt ? iso((r as any).removedAt) : null,
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
  await mirrorOrderTouch(str(orderRow.id));
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
    qty: effectiveQty({ qty: num(r.qty), amendedQty: (r as any).amendedQty ?? null }),
    dispatchedQty: num(r.dispatchedQty),
    removedAt: (r as any).removedAt ? iso((r as any).removedAt) : null,
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
  await mirrorOrderTouch(str(orderRow.id));
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
  /** Fresh proof triple — required for every dispatch, full or partial. */
  proof?: DispatchProof | null;
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
    qty: effectiveQty({ qty: num(r.qty), amendedQty: (r as any).amendedQty ?? null }),
    dispatchedQty: num(r.dispatchedQty),
    removedAt: (r as any).removedAt ? iso((r as any).removedAt) : null,
  })) as ItemLike[];

  const check = validateDispatch({ items, entries: args.entries, proof: args.proof });
  if (!check.ok) throw new CrmError(check.message, 400, check.code);

  // Proof files are verified BEFORE anything moves — a bad triple fails the
  // whole dispatch and consumes nothing.
  const proofIds = await verifyDispatchProof(str(orderRow.id), str(orderRow.soNumber), args.proof);

  const byId = new Map(itemRows.map((r) => [str(r.id), r]));
  const now = new Date();
  const batchItems: Array<{ itemId: string; name: string; qty: number; unit: string }> = [];
  for (const e of args.entries) {
    const row = byId.get(e.itemId);
    if (!row) continue;
    const item = items.find((it) => it.id === e.itemId);
    const qty = resolveDispatchQty(item, e);
    const total = effectiveQty({ qty: num(row.qty), amendedQty: (row as any).amendedQty ?? null });
    const nextQty = Math.min(total, num(row.dispatchedQty) + qty);
    const complete = nextQty >= total - 1e-6;
    batchItems.push({
      itemId: str(row.id),
      name: str(row.name || row.description || row.sku || 'Item'),
      qty,
      unit: str(row.unit),
    });
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
  // Consume the proof AFTER the items moved: a failed dispatch must not burn
  // a fresh invoice, and the UNIQUE columns turn a double-submit race into a
  // clean `proof_reused` instead of a double dispatch.
  try {
    await prisma.crmDispatchProof.create({
      data: {
        id: crypto.randomUUID(),
        soId: str(orderRow.id),
        soNumber: str(orderRow.soNumber),
        invoiceId: proofIds.invoiceId,
        beforeId: proofIds.beforeId,
        afterId: proofIds.afterId,
        items: JSON.stringify(batchItems),
        transportId: proofIds.transportId,
        courierId: proofIds.courierId,
        packingListId: proofIds.packingListId,
        actor: args.actor || '',
        day: today,
        createdAt: new Date(),
      },
    });
  } catch (e: any) {
    throw new CrmError(
      'This proof was already used for a dispatch — upload a fresh invoice.',
      400,
      'proof_reused',
    );
  }
  const credited = await creditDispatch(
    str(orderRow.soNumber),
    lifecycle === 'dispatched',
    args.actor || null,
    today,
  );
  await mirrorOrderTouch(str(orderRow.id));
  return { order: await getOrder(str(orderRow.id)), lifecycle, credited };
}

export async function attachProofDocs(args: {
  idOrSo: string;
  proofId: string;
  beforeId?: string | null;
  afterId?: string | null;
  transportId?: string | null;
  courierId?: string | null;
  packingListId?: string | null;
  actor?: string | null;
}): Promise<{ order: (CrmOrderRow & { events: any[] }) | null }> {
  const orderRow = await loadRawOrder(args.idOrSo);
  assertWorkable(orderRow, str(orderRow.lifecycle));
  const proof: any = await prisma.crmDispatchProof
    .findUnique({ where: { id: str(args.proofId) } })
    .catch(() => null);
  if (!proof || str(proof.soId) !== str(orderRow.id)) {
    throw new CrmError('Dispatch proof not found on this sales order.', 404, 'proof_not_found');
  }

  const incoming: Array<[ProofDocSlot, string]> = [];
  for (const slot of PROOF_DOC_SLOTS) {
    const id = str((args as any)[slot]).trim();
    if (id) incoming.push([slot, id]);
  }
  if (incoming.length === 0) {
    throw new CrmError('Nothing to attach — pick at least one document.', 400, 'no_docs');
  }

  // One file can never fill two slots of the same proof (and never the invoice).
  const seen = new Set<string>();
  const invoiceId = str(proof.invoiceId);
  if (invoiceId) seen.add(invoiceId);
  for (const [slot, id] of incoming) {
    if (seen.has(id)) {
      throw new CrmError(
        `${PROOF_DOC_RULES[slot].label} must be a different file from the invoice and the other documents.`,
        400,
        'proof_kind',
      );
    }
    seen.add(id);
  }

  // First write wins — an already-filled slot is never replaced.
  for (const [slot] of incoming) {
    if (str(proof[slot])) {
      throw new CrmError(`${PROOF_DOC_RULES[slot].label} is already attached.`, 409, 'doc_attached');
    }
  }

  for (const [slot, id] of incoming) {
    const rule = PROOF_DOC_RULES[slot];
    const row: any = await prisma.soAttachment.findUnique({ where: { id } }).catch(() => null);
    if (!row) {
      throw new CrmError(`${rule.label} file not found — please re-upload it.`, 400, 'proof_not_found');
    }
    if (str(row.soNumber) !== str(orderRow.soNumber)) {
      throw new CrmError(`${rule.label} belongs to a different sales order.`, 400, 'proof_wrong_order');
    }
    const mime = str(row.mime);
    const name = str(row.fileName);
    const okMime = isImageFile(mime, name) || (rule.acceptsPdf && isPdfFile(mime, name));
    if (str(row.kind) !== rule.kind || !okMime) {
      throw new CrmError(
        rule.acceptsPdf
          ? `The ${rule.label.toLowerCase()} must be uploaded as "${rule.label}" (photo or PDF).`
          : `The ${rule.label.toLowerCase()} must be a photo uploaded as "${rule.label}".`,
        400,
        'proof_kind',
      );
    }
    const reuseChecks = [prisma.crmDispatchProof.findFirst({ where: { invoiceId: id } }).catch(() => null)];
    for (const col of PROOF_DOC_SLOTS) {
      reuseChecks.push(prisma.crmDispatchProof.findFirst({ where: { [col]: id } as any }).catch(() => null));
    }
    const reused = (await Promise.all(reuseChecks)) as any[];
    if (reused.some(Boolean)) {
      throw new CrmError(
        'This file was already used in a dispatch proof — upload a fresh one.',
        400,
        'proof_reused',
      );
    }
  }

  const data: Record<string, unknown> = {};
  for (const [slot, id] of incoming) data[slot] = id;
  await prisma.crmDispatchProof.update({ where: { id: str(proof.id) }, data: data as any });
  await mirrorOrderTouch(str(orderRow.id));
  return { order: await getOrder(str(orderRow.id)) };
}

/** Backwards-compatible name for the photos-only era. */
export const attachProofPhotos = attachProofDocs;

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

export async function creditDispatch(
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
  await mirrorOrderTouch(str(orderRow.id));
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

/**
 * Human address correction from the floor. The edit writes straight into the
 * address column and sets the edited marker, so the Zoho sync leaves that
 * address alone from then on (local wins permanently). Zoho itself is never
 * written back to — the module stays read-only toward Books.
 */
export async function updateAddresses(args: {
  idOrSo: string;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  actor?: string | null;
  today?: string;
}): Promise<{ order: (CrmOrderRow & { events: any[] }) | null }> {
  const today = args.today || istToday();
  const orderRow = await loadRawOrder(args.idOrSo);
  assertWorkable(orderRow, str(orderRow.lifecycle));
  const hasBilling = args.billingAddress !== undefined && args.billingAddress !== null;
  const hasShipping = args.shippingAddress !== undefined && args.shippingAddress !== null;
  if (!hasBilling && !hasShipping) throw new CrmError('Nothing to update — pass billingAddress and/or shippingAddress.', 400, 'no_addresses');
  const now = new Date();
  const data: Record<string, unknown> = { updatedAt: now };
  if (hasBilling) {
    data.billingAddress = str(args.billingAddress).slice(0, 600);
    data.billingAddressEditedAt = now;
    data.billingAddressEditedBy = str(args.actor) || '';
  }
  if (hasShipping) {
    data.shippingAddress = str(args.shippingAddress).slice(0, 600);
    data.shippingAddressEditedAt = now;
    data.shippingAddressEditedBy = str(args.actor) || '';
  }
  await prisma.crmSalesOrder.update({ where: { id: str(orderRow.id) }, data: data as any });
  await writeEvent({
    soId: str(orderRow.id),
    soNumber: str(orderRow.soNumber),
    kind: 'address_updated',
    reason: `Address corrected on the floor${hasBilling && hasShipping ? ' (billing + shipping)' : hasBilling ? ' (billing)' : ' (shipping)'}`,
    actor: args.actor,
    day: today,
  });
  await mirrorOrderTouch(str(orderRow.id));
  return { order: await getOrder(str(orderRow.id)) };
}

// ── Amendments (client-confirmed floor overlay) ──────────────────────────────
//
// The client confirms a different count, drops a line, or adds one. The floor
// records it as a local overlay — NEVER a Zoho write-back:
//   qty change → `amendedQty` (the floor works against it, the sync never clears it)
//   removal    → `removedAt/By` (the line stays in DB, struck-through, out of queues)
//   addition   → a new `isLocalAdded` row (no Zoho lineKey, the sync ignores it)
// Every line gets its own audit event; the reason is the client-confirmation note.
export async function amendOrderItems(args: {
  idOrSo: string;
  qtyChanges?: AmendQtyChange[];
  removals?: AmendRemove[];
  additions?: AmendAdd[];
  reason?: string | null;
  actor?: string | null;
  today?: string;
}): Promise<ActionResult> {
  const today = args.today || istToday();
  const orderRow = await loadRawOrder(args.idOrSo);
  assertWorkable(orderRow, str(orderRow.lifecycle));
  const itemRows = await loadRawItems(str(orderRow.id));

  const items = itemRows.map((r) => ({
    id: str(r.id),
    dispatchState: str(r.dispatchState) as ItemState,
    tentativeDispatchDate: r.tentativeDispatchDate ? str(r.tentativeDispatchDate).slice(0, 10) : null,
    delayReason: r.delayReason ?? null,
    qty: effectiveQty({ qty: num(r.qty), amendedQty: (r as any).amendedQty ?? null }),
    dispatchedQty: num(r.dispatchedQty),
    removedAt: (r as any).removedAt ? iso((r as any).removedAt) : null,
  })) as ItemLike[];

  const check = validateAmend({
    items,
    qtyChanges: args.qtyChanges,
    removals: args.removals,
    additions: args.additions,
    reason: args.reason,
  });
  if (!check.ok) throw new CrmError(check.message, 400, check.code);

  const now = new Date();
  const byId = new Map(itemRows.map((r) => [str(r.id), r]));
  const note = str(args.reason).trim();

  for (const c of args.qtyChanges || []) {
    const row = byId.get(String(c.itemId));
    if (!row) continue;
    const before = effectiveQty({ qty: num(row.qty), amendedQty: (row as any).amendedQty ?? null });
    const want = Number(c.qty);
    await prisma.crmSoItem.update({
      where: { id: String(c.itemId) },
      data: { amendedQty: want, itemTotal: Math.round(want * num(row.rate) * 100) / 100, updatedAt: now } as any,
    });
    await writeEvent({
      soId: str(orderRow.id),
      soNumber: str(orderRow.soNumber),
      kind: 'item_amended',
      itemId: String(c.itemId),
      qty: want,
      reason: `Qty ${before} → ${want} (client-confirmed: ${note})`,
      actor: args.actor,
      day: today,
    });
  }

  for (const r of args.removals || []) {
    const row = byId.get(String(r.itemId));
    if (!row) continue;
    await prisma.crmSoItem.update({
      where: { id: String(r.itemId) },
      data: { removedAt: now, removedBy: str(args.actor) || '', updatedAt: now } as any,
    });
    await writeEvent({
      soId: str(orderRow.id),
      soNumber: str(orderRow.soNumber),
      kind: 'item_removed',
      itemId: String(r.itemId),
      reason: `Removed from the SO (client-confirmed: ${note}) — ${str(row.name || row.description || row.sku || 'line')}`,
      actor: args.actor,
      day: today,
    });
  }

  for (const a of args.additions || []) {
    const id = crypto.randomUUID();
    const qty = Number(a.qty);
    const rate = Number(a.rate ?? 0);
    await prisma.crmSoItem.create({
      data: {
        id,
        soId: str(orderRow.id),
        lineKey: `local:${id.slice(0, 8)}`,
        name: str(a.name).slice(0, 300),
        sku: '',
        description: '',
        qty,
        unit: str(a.unit).slice(0, 40),
        rate,
        itemTotal: Math.round(qty * (Number.isFinite(rate) ? rate : 0) * 100) / 100,
        dispatchState: 'unscheduled',
        tentativeDispatchDate: null,
        delayReason: null,
        dispatchedQty: 0,
        dispatchedAt: null,
        scheduledBy: null,
        scheduledAt: null,
        amendedQty: null,
        removedAt: null,
        removedBy: null,
        isLocalAdded: true,
        createdAt: now,
        updatedAt: now,
      } as any,
    });
    await writeEvent({
      soId: str(orderRow.id),
      soNumber: str(orderRow.soNumber),
      kind: 'item_added',
      itemId: id,
      qty,
      reason: `Added to the SO (client-confirmed: ${note}) — ${str(a.name).slice(0, 300)}`,
      actor: args.actor,
      day: today,
    });
  }

  const fresh = await loadRawItems(str(orderRow.id));
  const lifecycle = await refreshLifecycle(orderRow, fresh);
  await mirrorOrderTouch(str(orderRow.id));
  return { order: await getOrder(str(orderRow.id)), lifecycle };
}

/**
 * Cancel the whole SO on the floor (client-confirmed). Sets the local marker
 * and parks the lifecycle at `cancelled` — out of every working queue, kept
 * for audit. Distinct from a Zoho `status=cancelled`; the Zoho sync never
 * clears the marker. MIS can reverse it with `reopenOrderLocal`.
 */
export async function cancelOrderLocal(args: {
  idOrSo: string;
  reason?: string | null;
  actor?: string | null;
  today?: string;
}): Promise<ActionResult> {
  const today = args.today || istToday();
  const orderRow = await loadRawOrder(args.idOrSo);
  if (str(orderRow.sourceState) === 'deleted_source') {
    throw new CrmError('This order was deleted at source — confirm the removal instead.', 409, 'source_deleted');
  }
  const check = validateLocalCancel({
    reason: args.reason,
    order: { status: str(orderRow.status), orderStatus: str(orderRow.orderStatus) },
    localCancelledAt: str(orderRow.localCancelledAt) || null,
  });
  if (!check.ok) throw new CrmError(check.message, 400, check.code);
  const now = new Date();
  await prisma.crmSalesOrder.update({
    where: { id: str(orderRow.id) },
    data: {
      localCancelledAt: now,
      localCancelledBy: str(args.actor) || '',
      localCancelReason: str(args.reason).trim(),
      lifecycle: 'cancelled',
      updatedAt: now,
    } as any,
  });
  await writeEvent({
    soId: str(orderRow.id),
    soNumber: str(orderRow.soNumber),
    kind: 'order_cancelled_local',
    reason: str(args.reason).trim(),
    actor: args.actor,
    day: today,
  });
  await mirrorOrderTouch(str(orderRow.id));
  return { order: await getOrder(str(orderRow.id)), lifecycle: 'cancelled' };
}

/** Reverse a floor cancel (MIS only — the route enforces it). Re-derives the lifecycle. */
export async function reopenOrderLocal(args: {
  idOrSo: string;
  actor?: string | null;
  today?: string;
}): Promise<ActionResult> {
  const today = args.today || istToday();
  const orderRow = await loadRawOrder(args.idOrSo);
  if (!str(orderRow.localCancelledAt)) {
    throw new CrmError('This sales order is not floor-cancelled — nothing to reopen.', 409, 'not_cancelled');
  }
  await prisma.crmSalesOrder.update({
    where: { id: str(orderRow.id) },
    data: { localCancelledAt: null, localCancelledBy: null, localCancelReason: null, updatedAt: new Date() } as any,
  });
  await writeEvent({
    soId: str(orderRow.id),
    soNumber: str(orderRow.soNumber),
    kind: 'order_reopened_local',
    reason: 'Floor cancel reversed — order back to the working queues',
    actor: args.actor,
    day: today,
  });
  const fresh = await loadRawItems(str(orderRow.id));
  const lifecycle = await refreshLifecycle(orderRow, fresh);
  await mirrorOrderTouch(str(orderRow.id));
  return { order: await getOrder(str(orderRow.id)), lifecycle };
}

export async function loadEstimateRegionIndex(refs: string[]): Promise<EstimateRegionIndex> {
  const unique = [...new Set(refs.map((r) => str(r).trim()).filter(Boolean))];
  if (!unique.length) return new Map();
  const rows: any[] = [];
  for (let i = 0; i < unique.length; i += REGION_LOOKUP_BATCH) {
    const chunk = unique.slice(i, i + REGION_LOOKUP_BATCH);
    try {
      const found = await prisma.estimate.findMany({
        where: { estimateNumber: { in: chunk } },
        select: { estimateNumber: true, organizationId: true, region: true, date: true, lastSyncTime: true },
      });
      rows.push(...((found as any[]) || []));
    } catch (e: any) {
      // Region is a view-layer split — a lookup fault must never fail the tick.
      logger.warn({ err: e?.message }, 'crm sync: estimate region lookup failed');
    }
  }
  return buildEstimateRegionIndex(rows);
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
  const regionIndex = await loadEstimateRegionIndex(orders.map((o) => str(o.ref)));

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
        region: resolveOrderRegion(regionIndex, o.ref, org),
        billingAddress: str(o.billingAddress).slice(0, 600),
        shippingAddress: str(o.shippingAddress).slice(0, 600),
        paymentTerms: str(o.paymentTerms).slice(0, 120),
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
    // Addresses only arrive with the detail pass (one Zoho call per order), so
    // a list-only tick sends none — an empty value must never overwrite a real
    // address, and a late address must still be written when the rest of the
    // row is unchanged. A LOCALLY EDITED address is never overwritten at all.
    const addrPatch: Record<string, string> = {};
    if (str(o.billingAddress) && !str(existing.billingAddressEditedAt)) addrPatch.billingAddress = str(o.billingAddress).slice(0, 600);
    if (str(o.shippingAddress) && !str(existing.shippingAddressEditedAt)) addrPatch.shippingAddress = str(o.shippingAddress).slice(0, 600);
    // Payment terms are source-owned like everything else Zoho-side: an empty
    // value never clears a real one, a changed one writes through.
    const payPatch: Record<string, string> = {};
    const payTerms = str(o.paymentTerms).slice(0, 120);
    if (payTerms && payTerms !== str(existing.paymentTerms)) payPatch.paymentTerms = payTerms;
    const addrChanged = Object.entries(addrPatch).some(([k, v]) => str((existing as any)[k]) !== v);
    const payChanged = Object.entries(payPatch).some(([k, v]) => str((existing as any)[k]) !== v);
    // Region is DERIVED: re-resolve every tick so a Controller re-home (which
    // rewrites Estimate.region) lands here without any extra wiring.
    const nextRef = str(o.ref).slice(0, 120) || str(existing.referenceNumber);
    const nextRegion = resolveOrderRegion(regionIndex, nextRef, org);
    const regionChanged = str(existing.region) !== nextRegion;
    if (str(existing.fingerprint) === fp && !healedNow && !addrChanged && !payChanged && !regionChanged) {
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
        referenceNumber: nextRef,
        region: nextRegion,
        ...addrPatch,
        ...payPatch,
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

  // Phase 4a dual-write: project the synced batch into the core order spine.
  try {
    const { mirrorOrdersByKeys } = await import('../../core/orders');
    if (seen.size) await mirrorOrdersByKeys([...seen]);
  } catch { /* non-fatal */ }

  return result;
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
export async function insertOrders(rows: any[]): Promise<number> {
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

/** Bulk-insert items for an order that has none yet (the new-order path). */
export async function insertItems(rows: any[]): Promise<number> {
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

export async function upsertItems(soId: string, rawItems: any[]): Promise<number> {
  const existing = (await prisma.crmSoItem.findMany({ where: { soId } })) as any[];
  const byKey = new Map(existing.map((r) => [str(r.lineKey), r]));
  const now = new Date();
  let written = 0;
  const seenKeys = new Set<string>();

  const pending: any[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const li = rawItems[i] || {};
    if (isChargeLine(li.name, li.description)) continue; // standing charge, not an item
    const lineKey = lineKeyFor(li, i);
    if (seenKeys.has(lineKey)) continue;
    seenKeys.add(lineKey);
    // Floor-added lines (lineKey `local:*`) never come from Zoho — a collision
    // would mean Zoho reused the key, which must not clobber the local line.
    if (lineKey.startsWith('local:')) continue;
    const rate = num(li.rate);
    const payload: Record<string, unknown> = {
      name: str(li.name).slice(0, 300),
      sku: str(li.sku || li.item_code).slice(0, 120),
      description: str(li.description).slice(0, 500),
      unit: str(li.unit).slice(0, 40),
      rate,
      updatedAt: now,
    };
    const found = byKey.get(lineKey);
    if (found) {
      // NEVER clobber local scheduling state — only the Zoho-side fields. A
      // client-confirmed qty override (`amendedQty`) wins permanently: the
      // sync refreshes the rate but keeps the floor qty and re-prices the line.
      const amended = (found as any).amendedQty;
      if (amended !== null && amended !== undefined) {
        const aq = num(amended);
        payload.itemTotal = Math.round(aq * rate * 100) / 100;
      } else {
        const qty = num(li.quantity ?? li.qty);
        payload.qty = qty;
        payload.itemTotal = num(li.item_total) || Math.round(qty * rate * 100) / 100;
      }
      await prisma.crmSoItem.update({ where: { id: str(found.id) }, data: payload });
    } else {
      const qty = num(li.quantity ?? li.qty);
      pending.push({
        id: crypto.randomUUID(),
        soId,
        lineKey,
        ...payload,
        qty,
        itemTotal: num(li.item_total) || Math.round(qty * rate * 100) / 100,
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

export async function recomputeLifecyclesById(ids: string[]): Promise<void> {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += ITEM_BATCH) {
    const chunk = ids.slice(i, i + ITEM_BATCH);
    const rows = (await prisma.crmSalesOrder.findMany({ where: { id: { in: chunk } } })) as any[];
    const itemsBySo = await itemsForOrders(chunk);
    for (const r of rows) {
      const items = itemsBySo.get(str(r.id)) || [];
      if (!items.length) continue; // items not fetched this tick — keep state
      // A floor cancel parks the lifecycle at `cancelled` — the tick must not
      // resurrect it (only an MIS reopen clears the marker).
      if (str((r as any).localCancelledAt)) {
        if (str(r.lifecycle) !== 'cancelled') {
          await prisma.crmSalesOrder.update({ where: { id: str(r.id) }, data: { lifecycle: 'cancelled', updatedAt: new Date() } });
        }
        continue;
      }
      const lifecycle = deriveLifecycle(
        items.map((it) => ({
          id: it.id,
          dispatchState: it.dispatchState,
          tentativeDispatchDate: it.tentativeDispatchDate,
          qty: effectiveQty({ qty: num((it as any).qty), amendedQty: (it as any).amendedQty ?? null }),
          dispatchedQty: num((it as any).dispatchedQty),
          removedAt: (it as any).removedAt ? iso((it as any).removedAt) : null,
        })) as ItemLike[],
        { status: str(r.status), orderStatus: str(r.orderStatus) },
      );
      if (lifecycle !== str(r.lifecycle)) {
        await prisma.crmSalesOrder.update({ where: { id: str(r.id) }, data: { lifecycle, updatedAt: new Date() } });
      }
    }
  }
}

/** Dashboard headline counters (cheap — the floor is open orders only).
 *
 *  `regionFilter` narrows the headline counters; `regions` always carries the
 *  per-region incomplete/completed split so the Sales → Dispatch chips can show
 *  every region's workload in one pass. */
export async function dispatchSummary(
  today = istToday(),
  regionFilter: unknown = 'all',
): Promise<Record<string, any>> {
  const rows = (await prisma.crmSalesOrder.findMany({ take: 4000 })) as any[];
  const itemsBySo = await itemsForOrders(rows.map((r) => str(r.id)));
  const region = normalizeRegionFilter(regionFilter);
  const counts: Record<string, any> = {
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
    // Unified Sales → Dispatch buckets.
    incomplete: 0,
    completed: 0,
    // Tab totals — item-level membership (an order can sit in several tabs),
    // so the badges always equal what the list actually renders.
    tabUnscheduled: 0,
    tabScheduled: 0,
    tabDispatched: 0,
  };
  const regions: Record<string, { incomplete: number; completed: number; total: number }> = {};
  const bucketOf = (r: any, items: any[]) => {
    const shape = {
      lifecycle: str(r.lifecycle),
      sourceState: str(r.sourceState) === 'deleted_source' ? 'deleted_source' : 'active',
      items,
      status: str(r.status),
      orderStatus: str(r.orderStatus),
      paidStatus: str(r.paidStatus),
    } as unknown as ViewOrder;
    return salesBucket(shape);
  };
  for (const r of rows) {
    const items = itemsBySo.get(str(r.id)) || [];
    const bucket = bucketOf(r, items);
    // Region facet counts are global (never narrowed by the viewer's filter).
    if (bucket) {
      const key = str(r.region) || '';
      const slot = (regions[key] ||= { incomplete: 0, completed: 0, total: 0 });
      slot[bucket]++;
      slot.total++;
    }
    if (!regionMatches(str(r.region), region)) continue;
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
    if (bucket) counts[bucket]++;
    if (lifecycle !== 'cancelled') {
      if (items.some((it) => it.dispatchState === 'scheduled' && it.tentativeDispatchDate === today)) counts.floorToday++;
      if (items.some((it) => isOverdueItem(it as ItemLike, today))) counts.overdue++;
    }
    const shape = { lifecycle, sourceState: 'active', items } as unknown as ViewOrder;
    if (orderMatchesView(shape, 'unscheduled', today)) counts.tabUnscheduled++;
    if (orderMatchesView(shape, 'scheduled', today)) counts.tabScheduled++;
    if (orderMatchesView(shape, 'dispatched', today)) counts.tabDispatched++;
  }
  counts.regions = regions;
  return counts;
}
