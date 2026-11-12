// Extracted verbatim from store.ts by scripts/refactor/split-module.mjs.
// store.ts re-exports everything public here, so existing imports keep working.
import type { CrmItemRow, ItemState, CrmOrderRow, Lifecycle } from "../types";
import type { ProofFile, ProofDocSlot, ScoreStage, SyncedOrder } from "./types";

// ── Mapping ────────────────────────────────────────────────────────────────

export const iso = (v: any): string | null => {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const str = (v: any): string => (v === undefined || v === null ? '' : String(v));

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
    amendedQty: row?.amendedQty === null || row?.amendedQty === undefined ? null : num(row.amendedQty),
    removedAt: iso(row?.removedAt),
    removedBy: row?.removedBy ? str(row.removedBy) : null,
    isLocalAdded: !!row?.isLocalAdded,
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
    region: str(row?.region),
    billingAddress: str(row?.billingAddress),
    shippingAddress: str(row?.shippingAddress),
    billingAddressEditedAt: iso(row?.billingAddressEditedAt),
    billingAddressEditedBy: row?.billingAddressEditedBy ? str(row.billingAddressEditedBy) : null,
    shippingAddressEditedAt: iso(row?.shippingAddressEditedAt),
    shippingAddressEditedBy: row?.shippingAddressEditedBy ? str(row.shippingAddressEditedBy) : null,
    paymentTerms: str(row?.paymentTerms),
    createdDate: str(row?.createdDate),
    lifecycle: (str(row?.lifecycle) || 'unscheduled') as Lifecycle,
    sourceState: str(row?.sourceState) === 'deleted_source' ? 'deleted_source' : 'active',
    soDelayReason: row?.soDelayReason ? str(row.soDelayReason) : null,
    missCount: num(row?.missCount),
    firstSeenAt: iso(row?.firstSeenAt),
    lastSeenAt: iso(row?.lastSeenAt),
    deletedDetectedAt: iso(row?.deletedDetectedAt),
    localCancelledAt: iso(row?.localCancelledAt),
    localCancelledBy: row?.localCancelledBy ? str(row.localCancelledBy) : null,
    localCancelReason: row?.localCancelReason ? str(row.localCancelReason) : null,
    items,
    itemCount: items.length,
  };
}

// ── Reads ──────────────────────────────────────────────────────────────────

export const ITEM_BATCH = 90;

export const proofFile = (row: any): ProofFile => ({
  id: str(row?.id),
  kind: str(row?.kind || 'other'),
  fileName: str(row?.fileName),
  mime: str(row?.mime || 'application/octet-stream'),
  size: num(row?.size),
  url: `/api/crm/files/${str(row?.id)}`,
  uploadedBy: str(row?.uploadedBy),
  createdAt: iso(row?.createdAt),
});

export const isPdfFile = (mime: string, name: string): boolean =>
  mime === 'application/pdf' || /\.pdf$/i.test(name);

export const isImageFile = (mime: string, name: string): boolean =>
  mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(name);

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

export function assertWorkable(orderRow: any, lifecycle: string) {
  if (str(orderRow.sourceState) === 'deleted_source') {
    throw new CrmError('This order was deleted at source — confirm the removal instead.', 409, 'source_deleted');
  }
  if (str(orderRow.localCancelledAt)) {
    throw new CrmError('This sales order was cancelled on the floor — reopen it before scheduling or dispatching.', 409, 'cancelled_local');
  }
  if (lifecycle === 'cancelled') {
    throw new CrmError('This order is cancelled in Zoho — nothing to schedule or dispatch.', 409, 'cancelled');
  }
}

export const PROOF_DOC_RULES: Record<
  ProofDocSlot,
  { kind: string; label: string; acceptsPdf: boolean }
> = {
  beforeId: { kind: 'packing_before', label: 'Before packing', acceptsPdf: false },
  afterId: { kind: 'packing_after', label: 'After packing', acceptsPdf: false },
  transportId: { kind: 'transport_receipt', label: 'Transport receipt', acceptsPdf: true },
  courierId: { kind: 'courier_receipt', label: 'Courier receipt', acceptsPdf: true },
  packingListId: { kind: 'packing_list', label: 'Packing list', acceptsPdf: true },
};

export const PROOF_DOC_SLOTS = Object.keys(PROOF_DOC_RULES) as ProofDocSlot[];

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
export const SCORE_STAGES = ['confirm', 'invoice', 'ship', 'payment'] as const;

export const STAGE_DEPT: Record<ScoreStage, string> = {
  confirm: 'crm',
  invoice: 'accounts',
  ship: 'dispatch',
  payment: 'accounts',
};

export const STAGE_COMPLETION: Record<ScoreStage, Array<[string, number, string]>> = {
  confirm: [
    ['crm', 50, 'Sales order confirmed'],
    ['procurement', 25, 'Material allocated — cleared confirm'],
  ],
  invoice: [['accounts', 50, 'Invoice raised']],
  ship: [['dispatch', 50, 'Order shipped']],
  payment: [['accounts', 100, 'Payment received']],
};

/** Furthest pipeline stage an order has reached, from its Zoho statuses. */
export function orderStage(o: {
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
export const FLOOR_WINDOW_DAYS = 30;

export function dayAdd(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Zoho `complete` predicate — mirrors the runner's pendingStep() === 'complete'. */
export function isCompleteInZoho(o: SyncedOrder): boolean {
  const status = str(o.status).toLowerCase();
  if (status === 'cancelled' || status === 'void') return true;
  const orderStatus = str(o.orderStatus).toLowerCase();
  const paidStatus = str(o.paidStatus).toLowerCase();
  return paidStatus === 'paid' || orderStatus === 'closed';
}

export function lineKeyFor(li: any, index: number): string {
  const id = str(li?.line_item_id || li?.item_id || '').trim();
  if (id) return id;
  const sku = str(li?.sku || li?.item_code || '').trim();
  if (sku) return `sku:${sku}:${index}`;
  return `L${index}`;
}

/** One batched estimate read per sync tick: referenceNumber → region. Chunked
 *  because D1 caps bound parameters per statement. */
export const REGION_LOOKUP_BATCH = 40;

/** Column order is fixed so the raw INSERT is identical on every chunk. */
export const ORDER_COLS = [
  'id', 'org', 'soNumber', 'zohoId', 'customerName', 'customerId', 'value', 'currency',
  'orderStatus', 'invoicedStatus', 'shippedStatus', 'paidStatus', 'status', 'salesperson',
  'referenceNumber', 'region', 'billingAddress', 'shippingAddress', 'createdDate', 'lifecycle', 'sourceState', 'soDelayReason',
  'fingerprint', 'missCount', 'firstSeenAt', 'lastSeenAt', 'deletedDetectedAt',
  'createdAt', 'updatedAt',
] as const;

export function sqlValue(v: any): any {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

export const ITEM_COLS = [
  'id', 'soId', 'lineKey', 'name', 'sku', 'description', 'qty', 'unit', 'rate',
  'itemTotal', 'dispatchState', 'tentativeDispatchDate', 'delayReason',
  'dispatchedQty', 'dispatchedAt', 'scheduledBy', 'scheduledAt', 'createdAt', 'updatedAt',
] as const;

/**
 * Standing charges that Zoho emits as a line item on EVERY sales order but
 * that the desk neither dates nor ships ("Packaging & Forwarding"). They are
 * dropped at the door so the item list is only real, dispatchable goods.
 * MIRROR: scripts/crm-runner.js `isChargeLine` (kept in sync by hand — the
 * runner filters them out of the payload, the store refuses them anyway).
 */
export const CHARGE_LINES = new Set([
  'packaging & forwarding',
  'packaging and forwarding',
  'packaging & forwarding charges',
  'packaging and forwarding charges',
]);

export const normalizeLine = (v: unknown) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');

export function isChargeLine(...names: Array<string | null | undefined>): boolean {
  // Exact (normalized) match only — "Packing Straps" is a real item and must
  // not be swallowed by a loose /packing/ prefix.
  return names.some((n) => CHARGE_LINES.has(normalizeLine(n)));
}
