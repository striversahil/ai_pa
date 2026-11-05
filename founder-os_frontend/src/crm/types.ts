// crm/types.ts — dispatch-floor view types.
//
// Shape mirrors the backend API (src/modules/crm/types.ts → CrmOrderRow /
// CrmItemRow). Read-only client model: the server owns every transition.
export const LIFECYCLES = [
  "unscheduled",
  "partially_scheduled",
  "scheduled",
  "partially_dispatched",
  "dispatched",
  "cancelled",
] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export const ITEM_STATES = ["unscheduled", "scheduled", "dispatched"] as const;
export type ItemState = (typeof ITEM_STATES)[number];

export const VIEWS = [
  "dispatch-floor",
  "unscheduled",
  "scheduled",
  "dispatched",
  "source-deleted",
  "all",
  // Unified Sales → Dispatch buckets (region-owned view).
  "incomplete",
  "completed",
] as const;
export type View = (typeof VIEWS)[number];

/** The sales-facing split: still owed vs paid in full. Cancelled and
 *  source-deleted orders belong to neither. */
export const SALES_BUCKETS = ["incomplete", "completed"] as const;
export type SalesBucket = (typeof SALES_BUCKETS)[number];

export interface CrmItem {
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

export interface CrmEvent {
  id: string;
  kind: string;
  itemId: string | null;
  fromDate: string | null;
  toDate: string | null;
  reason: string | null;
  actor: string;
  qty: number | null;
  day: string;
  createdAt: string | null;
}

/** One batch line of a consumed dispatch proof (what went out, how much). */
export interface CrmProofItem {
  itemId: string;
  name: string;
  qty: number;
  unit?: string;
}

/** One attachment on a consumed dispatch proof — enough to draw a thumbnail
 *  and open the image/PDF in the shared big-view components. */
export interface CrmProofFile {
  id: string;
  kind: string;
  fileName: string;
  mime: string;
  size: number;
  /** Authed file route (`/api/crm/files/:id`), never a raw KV key. */
  url: string;
  uploadedBy: string;
  createdAt: string | null;
}

/** One consumed dispatch proof: invoice (required) + optional packing photos
 *  and transport/courier/packing-list documents. */
export interface CrmDispatchProof {
  id: string;
  invoiceId: string;
  beforeId: string | null;
  afterId: string | null;
  transportId: string | null;
  courierId: string | null;
  packingListId: string | null;
  /** Batch snapshot written at dispatch time — what went out in this batch. */
  items: CrmProofItem[];
  actor: string;
  day: string;
  createdAt: string | null;
  /** Resolved attachment metadata per slot (null when that slot was empty). */
  files?: {
    invoice: CrmProofFile | null;
    before: CrmProofFile | null;
    after: CrmProofFile | null;
    transport: CrmProofFile | null;
    courier: CrmProofFile | null;
    packingList: CrmProofFile | null;
  };
}

export interface CrmOrder {
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
  /** Zoho reference — in practice the EST number (EST-024014). */
  referenceNumber: string;
  /** Sales region owning this order (R1–R4; '' = unmapped). Derived from the
   *  estimate behind `referenceNumber` on every sync tick. */
  region: string;
  /** From the Zoho detail call; empty until the detail pass reaches the order. */
  billingAddress: string;
  shippingAddress: string;
  /** Set when a human corrects the address on the floor (sync then leaves it alone). */
  billingAddressEditedAt: string | null;
  billingAddressEditedBy: string | null;
  shippingAddressEditedAt: string | null;
  shippingAddressEditedBy: string | null;
  /** Payment line extracted from Zoho's free-text terms (source-owned, display-only). */
  paymentTerms: string;
  createdDate: string;
  lifecycle: Lifecycle;
  sourceState: "active" | "deleted_source";
  soDelayReason: string | null;
  missCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  deletedDetectedAt: string | null;
  items: CrmItem[];
  itemCount: number;
  dueToday?: number;
  overdue?: boolean;
  events?: CrmEvent[];
  /** Consumed dispatch proofs, newest first (each dispatch burns one triple). */
  proofs?: CrmDispatchProof[];
}

export interface CrmSummary {
  total: number;
  unscheduled: number;
  partiallyScheduled: number;
  scheduled: number;
  partiallyDispatched: number;
  dispatched: number;
  cancelled: number;
  deletedSource: number;
  floorToday: number;
  overdue: number;
  /** Tab totals — item-level membership, so an SO can be counted twice. */
  tabUnscheduled: number;
  tabScheduled: number;
  tabDispatched: number;
  /** Unified Sales → Dispatch buckets (after the viewer's region filter). */
  incomplete?: number;
  completed?: number;
  /** Per-region facet counts — always global, never narrowed by the filter.
   *  Key '' = unmapped. */
  regions?: Record<string, { incomplete: number; completed: number; total: number }>;
}

/** Server-resolved viewer contract for the Sales → Dispatch panel. */
export interface CrmViewerMeta {
  staffId: string | null;
  name: string;
  /** Roster region ('' = not mapped). Managers get ''. */
  region: string;
  /** Root/MIS/sales-head/crm/dispatch — sees every region. */
  isManager: boolean;
  /** Floor transitions (schedule/dispatch/addresses/removal). */
  canWrite: boolean;
  /** Tentative dates + delay reasons (floor + sales agents, own region). */
  canPromise: boolean;
}

export const VIEW_LABELS: Record<View, string> = {
  "dispatch-floor": "Dispatch Floor",
  unscheduled: "To Schedule",
  scheduled: "Scheduled",
  dispatched: "Dispatched",
  "source-deleted": "Source Deleted",
  all: "All SOs",
  incomplete: "Incomplete",
  completed: "Completed",
};

/** Colour identity per lifecycle — the floor must be readable at a glance. */
export const LIFECYCLE_META: Record<Lifecycle, { label: string; chip: string; dot: string }> = {
  unscheduled: {
    label: "Unscheduled",
    chip: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
    dot: "bg-red-500",
  },
  partially_scheduled: {
    label: "Partially Scheduled",
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    dot: "bg-amber-500",
  },
  scheduled: {
    label: "Scheduled",
    chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30",
    dot: "bg-sky-500",
  },
  partially_dispatched: {
    label: "Partially Dispatched",
    chip: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30",
    dot: "bg-violet-500",
  },
  dispatched: {
    label: "Dispatched",
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    dot: "bg-emerald-500",
  },
  cancelled: {
    label: "Cancelled",
    chip: "bg-zinc-500/10 text-zinc-500 border-zinc-500/30",
    dot: "bg-zinc-400",
  },
};

/** Free-text presets offered in the reschedule / delay dialogs. */
export const DELAY_REASON_PRESETS = [
  "Vendor delayed the material",
  "Material shortage / awaiting stock",
  "Payment hold — awaiting clearance",
  "Transporter not available",
  "Customer requested a later date",
  "Quality check pending",
];
