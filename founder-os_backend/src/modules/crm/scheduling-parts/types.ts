// Extracted verbatim from scheduling.ts by scripts/refactor/split-module.mjs.
// scheduling.ts re-exports everything public here, so existing imports keep working.
import type { ItemState } from "../types";

/** The minimum an item must expose for lifecycle/overdue logic. */
export interface ItemLike {
  id: string;
  dispatchState: ItemState;
  tentativeDispatchDate?: string | null;
  delayReason?: string | null;
  qty?: number;
  dispatchedQty?: number;
  /** Client-confirmed qty override (NULL = follow Zoho qty). */
  amendedQty?: number | null;
  /** Floor removal marker — removed lines leave every queue. */
  removedAt?: string | null;
  /** True for lines added by the floor (no Zoho lineKey). */
  isLocalAdded?: boolean | null;
}

/** Order-level inputs that can override the derived lifecycle. */
export interface OrderLike {
  status?: string | null;
  orderStatus?: string | null;
}

// ── Validation ──────────────────────────────────────────────────────────────

export type ValidationOk = { ok: true };

export type ValidationFail = { ok: false; code: string; message: string; itemId?: string };

export type Validation = ValidationOk | ValidationFail;

export interface ScheduleEntry {
  itemId: string;
  /** YYYY-MM-DD tentative dispatch date; omit/null when the item can't go today. */
  date?: string | null;
  /** Item-level delay reason (required for every undated item). */
  reason?: string | null;
}

export interface ScheduleArgs {
  /** IST today (YYYY-MM-DD). */
  today: string;
  /** Every item currently on the order. */
  items: readonly ItemLike[];
  /** Items the dispatch executive touched in this call. */
  entries: readonly ScheduleEntry[];
  /** Whole-order delay reason — only valid when NOTHING is scheduled. */
  soReason?: string | null;
}

export interface RescheduleEntry {
  itemId: string;
  /** New committed date (YYYY-MM-DD). */
  date?: string | null;
}

export interface RescheduleArgs {
  today: string;
  items: readonly ItemLike[];
  entries: readonly RescheduleEntry[];
  /** Comprehensive reason for the slip — always mandatory. */
  reason?: string | null;
}

export interface DispatchEntry {
  itemId: string;
  /** Quantity going out now; defaults to the full remaining quantity. */
  qty?: number | null;
}

/**
 * Fresh proof for one dispatch action (decided 2026-11-04): every Mark
 * dispatched — full or partial — consumes a fresh INVOICE PDF. Before/after
 * packing photos and the transport receipt / courier receipt / packing list are
 * optional and ride along when the floor has them. IDs reference SoAttachment
 * rows; the store verifies ownership/kind/mime/freshness (shape-only here).
 */
export interface DispatchProof {
  invoiceId?: string | null;
  beforeId?: string | null;
  afterId?: string | null;
  transportId?: string | null;
  courierId?: string | null;
  packingListId?: string | null;
}

export interface DispatchArgs {
  items: readonly ItemLike[];
  entries: readonly DispatchEntry[];
  /** Required: no proof, no dispatch (even partial). */
  proof?: DispatchProof | null;
}

// ── Amendments (floor overlay, client-confirmed) ─────────────────────────────

export interface AmendQtyChange {
  itemId: string;
  /** New total quantity (must stay ≥ already-dispatched). */
  qty: number;
}

export interface AmendRemove {
  itemId: string;
}

export interface AmendAdd {
  /** Client-confirmed line: name + qty required, rate/unit follow when known. */
  name: string;
  qty: number;
  unit?: string | null;
  rate?: number | null;
}

export interface AmendArgs {
  items: readonly ItemLike[];
  /** Qty overrides (client confirmed a different count). */
  qtyChanges?: readonly AmendQtyChange[];
  /** Lines the client dropped. */
  removals?: readonly AmendRemove[];
  /** Lines the client added. */
  additions?: readonly AmendAdd[];
  /** Client-confirmation note — the whole audit trail. Always mandatory. */
  reason?: string | null;
}

export interface LocalCancelArgs {
  /** Floor-cancel marker already on the order (when set, the order is out). */
  localCancelledAt?: string | null;
}
