// ── CRM order workflow: types + identity helpers ───────────────────────────
//
// The dispatch floor. A sales order syncs from Zoho Books into `CrmSalesOrder`,
// its line items become `CrmSoItem` rows, and the floor schedules each item for
// a tentative dispatch date, then dispatches it on the day.
//
// Lifecycle mirrors live in TWO places on purpose (single source of truth per
// side, same names + semantics):
//   backend  → src/modules/crm/scheduling.ts
//   frontend → src/crm/lifecycle.ts
// `scripts/guards/crm-lifecycle.test.mjs` asserts they agree on shared fixtures.
//
// Zoho stays READ-ONLY. Nothing in this module writes back to Zoho Books.

/** Local order lifecycle. Derived — never set by hand except for `cancelled`. */
export const LIFECYCLES = [
  'unscheduled',
  'partially_scheduled',
  'scheduled',
  'partially_dispatched',
  'dispatched',
  'cancelled',
] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

/** Per-item dispatch state. `unscheduled` + a reason = blocked item. */
export const ITEM_STATES = ['unscheduled', 'scheduled', 'dispatched'] as const;
export type ItemState = (typeof ITEM_STATES)[number];

/** Audit kinds written to CrmScheduleEvent (append-only). */
export const EVENT_KINDS = [
  'schedule',
  'reschedule',
  'delay',
  'dispatch',
  'partial_dispatch',
  'source_deleted',
  'confirmed_removal',
  'address_updated',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Zoho statuses that mean "this order is out of the working queues". */
export const CANCELLED_STATUSES = new Set(['cancelled', 'void']);

/** A delay/reschedule reason must actually say something. */
export const REASON_MIN = 10;

/** Free-text presets offered in the reschedule dialog (UI mirror). */
export const DELAY_REASON_PRESETS = [
  'Vendor delayed the material',
  'Material shortage / awaiting stock',
  'Payment hold — awaiting clearance',
  'Transporter not available',
  'Customer requested a later date',
  'Quality check pending',
] as const;

/** IST calendar day (YYYY-MM-DD). The dispatch floor runs on IST days. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);
}

/** True when `day` (YYYY-MM-DD) is a valid date string. */
export function isDayString(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Org-scoped identity for a sales order. Identical SO numbers in two Zoho orgs
 * are distinct pipeline rows (same rule as the old KV snapshot keys).
 */
export function soKey(org: string | null | undefined, soNumber: string): string {
  return `${org || ''}:${soNumber || ''}`;
}

/** Shipped row shape (what the API returns to the dashboard). */
export interface CrmOrderRow {
  id: string;
  org: string;
  soNumber: string;
  zohoId: string;
  customerName: string;
  customerId: string;
  value: number;
  currency: string;
  orderStatus: string;
  invoicedStatus: string;
  shippedStatus: string;
  paidStatus: string;
  status: string;
  salesperson: string;
  /** Zoho reference number — in practice the EST number (EST-024014). */
  referenceNumber: string;
  /** Sales region owning this order (R1–R4). Derived every sync tick from the
   *  estimate behind `referenceNumber`; '' = unmapped. Never hand-edited. */
  region: string;
  billingAddress: string;
  shippingAddress: string;
  /** Set when a human edits the address on the floor — the sync then leaves it alone. */
  billingAddressEditedAt: string | null;
  billingAddressEditedBy: string | null;
  shippingAddressEditedAt: string | null;
  shippingAddressEditedBy: string | null;
  /** Payment line extracted from Zoho's free-text `terms` (source-owned, display-only). */
  paymentTerms: string;
  createdDate: string;
  lifecycle: Lifecycle;
  sourceState: 'active' | 'deleted_source';
  soDelayReason: string | null;
  missCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  deletedDetectedAt: string | null;
  items?: CrmItemRow[];
  /** Number of line items on this order (populated on list views). */
  itemCount?: number;
  /** Scheduled items dated today or earlier and still not dispatched. */
  dueToday?: number;
  overdue?: boolean;
}

export interface CrmItemRow {
  id: string;
  soId: string;
  lineKey: string;
  name: string;
  sku: string;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  itemTotal: number;
  dispatchState: ItemState;
  tentativeDispatchDate: string | null;
  delayReason: string | null;
  dispatchedQty: number;
  dispatchedAt: string | null;
  scheduledBy: string | null;
  scheduledAt: string | null;
}

/** Dashboard tab → the predicate that fills it (see queues.ts semantics). */
export const VIEWS = [
  'dispatch-floor',
  'unscheduled',
  'scheduled',
  'dispatched',
  'source-deleted',
  'all',
  // Unified Sales → Dispatch buckets (region-owned view).
  'incomplete',
  'completed',
] as const;
export type View = (typeof VIEWS)[number];

/** The sales-facing split: everything still owed vs fully paid.
 *  Incomplete runs the whole pipeline — unscheduled → scheduled → dispatched —
 *  until the payment process completes. Cancelled / source-deleted belong to
 *  neither bucket. */
export const SALES_BUCKETS = ['incomplete', 'completed'] as const;
export type SalesBucket = (typeof SALES_BUCKETS)[number];

export function normalizeSalesBucket(v: unknown): SalesBucket {
  return String(v ?? '').trim() === 'completed' ? 'completed' : 'incomplete';
}

export function normalizeView(v: unknown): View {
  const s = String(v ?? '').trim();
  return (VIEWS as readonly string[]).includes(s) ? (s as View) : 'dispatch-floor';
}
