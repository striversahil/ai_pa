// Extracted verbatim from store.ts by scripts/refactor/split-module.mjs.
// store.ts re-exports everything public here, so existing imports keep working.
import type { View, CrmOrderRow, Lifecycle } from "../types";
import { SCORE_STAGES } from "./pure";

export interface ListArgs {
  view: View;
  q?: string;
  today?: string;
  limit?: number;
  /** 'all' (default) | region id | 'unmapped'. */
  region?: string;
}

/** One attachment as the SO panel needs it: enough to render a thumbnail and
 *  open the big view (url is the authed file route, never the raw KV key). */
export interface ProofFile {
  id: string;
  kind: string;
  fileName: string;
  mime: string;
  size: number;
  url: string;
  uploadedBy: string;
  createdAt: string | null;
}

export interface ActionResult {
  order: (CrmOrderRow & { events: any[] }) | null;
  lifecycle: Lifecycle;
  points?: number;
}

/**
 * Attach documents to an existing dispatch proof AFTER the dispatch
 * (2026-11-05): the floor usually dispatches invoice-only and adds the rest
 * when the transporter hands over the receipt or the signed packing list comes
 * back. All five optional slots are addable later —
 *   before/after packing photos        (packing_before / packing_after, photos)
 *   transport / courier / packing list (photo OR PDF)
 * First-write-wins per slot: a filled slot is never overwritten. Consumed-file
 * rules match the dispatch gate (same SO, right kind/mime, never used by
 * another dispatch proof).
 */
export type ProofDocSlot = 'beforeId' | 'afterId' | 'transportId' | 'courierId' | 'packingListId';

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
  // Client addresses — present only when the runner sent this order's detail
  // (the Zoho list response carries no addresses). Empty = leave the row as is.
  // A locally edited address (marker set) is never overwritten by the sync.
  billingAddress?: string;
  shippingAddress?: string;
  /** Detail-pass only: payment line extracted from Zoho's free-text `terms`. */
  paymentTerms?: string;
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

export type ScoreStage = (typeof SCORE_STAGES)[number];
