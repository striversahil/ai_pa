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
] as const;
export type View = (typeof VIEWS)[number];

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
  referenceNumber: string;
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
}

export const VIEW_LABELS: Record<View, string> = {
  "dispatch-floor": "Dispatch Floor",
  unscheduled: "Schedule",
  scheduled: "Scheduled",
  dispatched: "Dispatched",
  "source-deleted": "Source Deleted",
  all: "All SOs",
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
