// enquiry/queue.ts — queue predicates: THE single frontend source of truth for
// which enquiry sits in which dashboard queue.
//
// Mirrors `founder-os_backend/src/modules/enquiries/queues.ts` (backend copy
// for server-side gating). Keep them in sync: same names + semantics. If the
// rule changes, change it here AND there together.
//
// Pipeline recap:
//   Sales creates (rate_pending) → Procurement quotes (rates_received) →
//   Management decides (finalized) → Sales marks sent. `procurementSubmittedAt`
//   is the explicit "Enquiry Concluded" handoff; `rateAvailable` /
//   `internalRates` are per-item bypasses, open spec records are holds.
import type { Enquiry, EnquiryItem } from "@/types";
import { openLoops } from "./loops";

type ItemRateShape = Pick<EnquiryItem, "rateAvailable" | "notAvailable" | "internalRates" | "rates">;
type ItemDecisionShape = Pick<EnquiryItem, "rateAvailable" | "notAvailable" | "internalRates" | "rates" | "finalRate">;
type EnquiryShape = Pick<Enquiry, "items"> & { procurementSubmittedAt?: string };

/** Loop-eligible for Procurement: unavailable, not internal, unquoted or re-requested. */
export function itemNeedsRates(it: ItemRateShape): boolean {
  return !it?.rateAvailable && !(it as any)?.notAvailable && openLoops(it, 'not_available').length === 0 && !it?.internalRates && (((it?.rates ?? []).length === 0) || openLoops(it, 'rates').length > 0);
}

/** Sent-revision marker: management reopened a `sent` enquiry for additional
 *  scope (revise flow). While set, the row loops procurement → management →
 *  sent again — Zoho non-draft does NOT hold it terminal. Mirrors backend. */
export function isSentReopened(e: { sentRevisionAt?: string }): boolean {
  return !!String((e as any)?.sentRevisionAt ?? "").trim();
}

/** Submitted to management: the explicit procurement handoff. */
export function isSubmitted(e: { procurementSubmittedAt?: string }): boolean {
  return !!String(e?.procurementSubmittedAt ?? "").trim();
}

/** Loop-eligible for Management: quoted/internal, undecided — open spec asks intimate, rates-available normal flow not blocked. */
export function itemNeedsDecision(it: ItemDecisionShape): boolean {
  return !it?.rateAvailable && !(it as any)?.notAvailable
    && (((it?.rates ?? []).length > 0) || it?.internalRates === true)
    && (it?.finalRate === undefined || it?.finalRate === null);
}

/** Fresh unquoted work reopens procurement Active even on concluded rows. */
export function hasFreshUnquotedWork(e: Pick<Enquiry, "items">): boolean {
  return (e.items ?? []).some((it) => !it?.rateAvailable && !(it as any)?.notAvailable && openLoops(it, 'not_available').length === 0 && !it?.internalRates && openLoops(it, 'spec').length === 0
    && ((it?.rates ?? []).length === 0) && (it?.finalRate === undefined || it?.finalRate === null));
}

/** One fresh line is quotable even on a concluded row (card stays editable). */
export function isFreshQuotableItem(it: ItemDecisionShape): boolean {
  return !it?.rateAvailable && !(it as any)?.notAvailable && openLoops(it, 'not_available').length === 0 && !it?.internalRates && openLoops(it, 'spec').length === 0
    && (((it as any)?.rates ?? []).length === 0) && ((it as any)?.finalRate === undefined || (it as any)?.finalRate === null);
}

/** Open records on an item (shared with the backend loops engine). */
export { openLoops };

/** Pending sales query held by PROCUREMENT (forwarded by management).
 *  Reopens the procurement Active queue even on concluded rows. Fresh asks
 *  land with management first and do NOT reopen procurement until forwarded.
 *  Mirror: `backend/.../queues.ts` — change both together. */
export function hasPendingVariationWork(e: Pick<Enquiry, "items">): boolean {
  return (e.items ?? []).some((it) => openLoops(it, 'query', 'procurement').length > 0);
}

/** Any open sales query (needs action — with management or procurement). */
export function hasOpenQuery(e: Pick<Enquiry, "items">): boolean {
  return (e.items ?? []).some((it: any) => openLoops(it, 'query').length > 0);
}

/** Open query currently held by one desk (Query tab state chips). */
export function hasRoutedQuery(e: Pick<Enquiry, "items">, withDesk: 'management' | 'procurement'): boolean {
  return (e.items ?? []).some((it: any) => openLoops(it, 'query', withDesk).length > 0);
}

/** Resolved-query window for the Query tab's Resolved filter (days). */
export const QUERY_RESOLVED_DAYS = 30;

/** Answered query with no open query left (Resolved filter adjacent to
 *  Needs action). Windowed so the filter stays a recent-answers list. */
export function hasResolvedQuery(e: Pick<Enquiry, "items">, nowMs = Date.now()): boolean {
  if (hasOpenQuery(e)) return false;
  return (e.items ?? []).some((it: any) =>
    (Array.isArray((it as any)?.loops) ? (it as any).loops : []).some((l: any) =>
      l?.kind === 'query' && l?.status === 'answered'
      && Number.isFinite(Date.parse(String(l?.closedAt ?? '')))
      && nowMs - Date.parse(String(l.closedAt)) < QUERY_RESOLVED_DAYS * 86400 * 1000));
}

/** Pending not-available ask: procurement says material not available, awaiting management approval. */
export function hasPendingNotAvailableWork(e: Pick<Enquiry, "items">): boolean {
  return (e.items ?? []).some((it) => openLoops(it, 'not_available').length > 0);
}

/** Zoho-cancelled requirement (client side): declined / void / cancelled /
 *  rejected. Dead rows never sit in Active — they conclude automatically.
 *  Mirrors `founder-os_backend/src/modules/enquiries/queues.ts` — keep in sync. */
export function isZohoCancelledStatus(s: unknown): boolean {
  const v = String(s ?? '').toLowerCase().trim();
  if (!v) return false;
  return v.includes('declin') || v.includes('cancel') || v === 'void' || v.includes('reject');
}

/** Zoho-closed requirement: cancelled-like OR client-accepted. Both are
 *  terminal client decisions — procurement quoting is over. `sent` is NOT
 *  closed (estimate awaiting decision; concludes only once quotable work is
 *  done — see the conditional stamp in worker/routes/enquiries.ts). */
export function isZohoClosedStatus(s: unknown): boolean {
  const v = String(s ?? '').toLowerCase().trim();
  if (!v) return false;
  return isZohoCancelledStatus(v) || v.includes('accept');
}

export function isProcurementPendingEnquiry(e: EnquiryShape): boolean {
  const items = e.items ?? [];
  if (items.length === 0) return false;
  if (hasPendingProcurementLoop(e as any)) return true;
  const reopened = isSentReopened(e as any);
  const isTerminal = !reopened && (String((e as any).rateStatus ?? '') === 'sent' || (String((e as any).zohoStatus ?? '').trim() && String((e as any).zohoStatus ?? '').trim().toLowerCase() !== 'draft'));
  if (isTerminal && hasOpenSalesLoop(e as any)) return true;
  const zs = String((e as any).zohoStatus ?? '').trim().toLowerCase();
  if (!reopened && String((e as any).rateStatus ?? '') === 'sent') return false;
  if (!reopened && zs && zs !== 'draft') return false;
  // Fresh work (new unquoted lines, pending alternate requests) reopens the
  // queue even on concluded rows — the client keeps asking.
  if (hasFreshUnquotedWork(e) || hasPendingVariationWork(e)) return true;
  if (isSubmitted(e)) return false;
  return items.some((it) => !it?.rateAvailable && !(it as any)?.notAvailable && openLoops(it, 'not_available').length === 0 && !it?.internalRates);
}

export function isProcurementHistoryEnquiry(e: EnquiryShape): boolean {
  const items = e.items ?? [];
  if (hasPendingProcurementLoop(e as any)) return false;
  const reopened = isSentReopened(e as any);
  const isTerminal = !reopened && (String((e as any).rateStatus ?? '') === 'sent' || (String((e as any).zohoStatus ?? '').trim() && String((e as any).zohoStatus ?? '').trim().toLowerCase() !== 'draft'));
  if (isTerminal && hasOpenSalesLoop(e as any)) return false;
  if (!reopened && String((e as any).rateStatus ?? '') === 'sent') return items.length > 0;
  const zs = String((e as any).zohoStatus ?? '').trim().toLowerCase();
  if (!reopened && zs && zs !== 'draft') return items.length > 0;
  // Closed requirement: concluded automatically — visible in History even
  // before/without the explicit handoff stamp.
  if (!isSubmitted(e)) return false;
  // Fresh unquoted lines / pending alternate requests live in Active
  // (pending above), never double-listed.
  if (hasFreshUnquotedWork(e) || hasPendingVariationWork(e)) return false;
  if (hasPendingNotAvailableWork(e as any)) return false;
  return items.some((it) => ((it.rates ?? []).length > 0 && openLoops(it, 'rates').length === 0) || (it as any).notAvailable || openLoops(it, 'not_available').length > 0 || it.rateAvailable);
}

export function isManagementPendingEnquiry(e: EnquiryShape): boolean {
  void isSubmitted; // live visibility — submitted flag no longer gates management
  const items = e.items ?? [];
  const reopened = isSentReopened(e as any);
  if (!reopened && String((e as any).rateStatus ?? '') === 'sent') return false;
  const zs = String((e as any).zohoStatus ?? '').trim().toLowerCase();
  if (!reopened && zs && zs !== 'draft') return false;
  // Any item needing a decision appears here instantly (correct spec, quoted
  // or internal, not yet finalized) — plus open not-available asks awaiting
  // approval. Decided items stay decided: late quotes never reopen the queue
  // (founder decision 2026-11-12).
  return items.some((it) => itemNeedsDecision(it) || openLoops(it, 'not_available').length > 0);
}

/** Open spec ask: procurement opened it and sales hasn't answered yet.
 *  Answered text lingers on the row (audit trail in the record) but must
 *  never block the queue, the chip, or conclude. Mirrors `backend/.../queues.ts`. */
export function isOpenSpecFlag(it: any): boolean {
  return openLoops(it, 'spec').length > 0;
}

/** Submit readiness: every quotable loop item carries ≥1 vendor rate. */
export function procurementSubmittable(e: Pick<Enquiry, "items">): { ok: boolean; reason: string } {
  const items = e.items ?? [];
  const flagged = items.filter((it) => isOpenSpecFlag(it) && !(it as any)?.notAvailable && openLoops(it, 'not_available').length === 0).length;
  if (flagged > 0) return { ok: false, reason: `${flagged} item${flagged === 1 ? "" : "s"} awaiting sales spec fix` };
  const loop = items.filter((it) => !isOpenSpecFlag(it) && !it?.rateAvailable && !(it as any)?.notAvailable && openLoops(it, 'not_available').length === 0 && !it?.internalRates);
  if (loop.length === 0) {
    const hasBypass = items.some((it) => it?.rateAvailable || (it as any)?.notAvailable || openLoops(it, 'not_available').length > 0 || it?.internalRates);
    if (hasBypass) return { ok: true, reason: "" };
    return { ok: false, reason: "No quotable items yet" };
  }
  const unrated = loop.filter((it) => (it?.rates ?? []).length === 0).length;
  if (unrated > 0) return { ok: false, reason: `${unrated} item${unrated === 1 ? "" : "s"} still need${unrated === 1 ? "s" : ""} vendor rates (or mark rate available / not available)` };
  return { ok: true, reason: "" };
}

/** Rates coverage (Management row badge): every loop item carries ≥1 vendor
 *  rate. True bypasses are EXCLUDED — rateAvailable, internalRates,
 *  notAvailable(+Requested). Open spec-held items are NOT excluded: they
 *  still have no rates, so they block green and surface as `held` (with
 *  sales, not procurement). `pending` = unquoted quotable names,
 *  `heldNames` = spec-held names for the badge tooltip. Mirrors backend. */
export function ratesCoverage(e: Pick<Enquiry, "items">): { total: number; rated: number; complete: boolean; pending: string[]; held: number; heldNames: string[] } {
  const items = e.items ?? [];
  const nameOf = (it: any): string => String(it?.name || `Item ${items.indexOf(it) + 1}`);
  const bypassed = (it: any): boolean => !!it?.rateAvailable || !!(it as any)?.notAvailable || openLoops(it, 'not_available').length > 0 || !!it?.internalRates;
  const heldItems = items.filter((it: any) => !bypassed(it) && isOpenSpecFlag(it));
  const loop = items.filter((it: any) => !bypassed(it) && !isOpenSpecFlag(it));
  const pending = loop
    .filter((it: any) => ((it?.rates ?? []).length === 0))
    .map(nameOf);
  const rated = loop.length - pending.length;
  return {
    total: loop.length,
    rated,
    complete: loop.length > 0 && pending.length === 0 && heldItems.length === 0,
    pending,
    held: heldItems.length,
    heldNames: heldItems.map(nameOf),
  };
}

/** Any open loop record: survives concluded/zoho filters until answered.
 *  Answered records linger (audit) but are NOT open. Mirror backend queues.ts. */
export function hasOpenLoop(e: Pick<Enquiry, "items">): boolean {
  return (e.items ?? []).some((it: any) => openLoops(it).length > 0);
}
/** Needs action: the actionable subset of open loops — someone must move:
 *  spec ask (sales must fix), procurement-held ask (procurement must answer),
 *  or not-available ask (management must approve). Answered records are audit
 *  trail, never action. Mirror backend. */
export function needsActionThread(e: Pick<Enquiry, "items">): boolean {
  return (e.items ?? []).some((it: any) => isOpenSpecFlag(it) || hasPendingProcurementLoop({ items: [it] } as any) || openLoops(it, 'not_available').length > 0);
}
/** Procurement needs to answer: any open record held by procurement
 *  (spec asks stay with sales; queries route via holder). */
export function hasPendingProcurementLoop(e: Pick<Enquiry, "items">): boolean {
  return (e.items ?? []).some((it: any) => openLoops(it).some((l) => l.holder === 'procurement'));
}
/** Sales-originated open loops (asks sales opened and not yet answered). */
export function hasOpenSalesLoop(e: Pick<Enquiry, "items">): boolean {
  return (e.items ?? []).some((it: any) => openLoops(it).some((l) => l.openedBy === 'sales'));
}

export function isManagementHistoryEnquiry(e: Pick<Enquiry, "items" | "rateStatus">): boolean {
  const items = e.items ?? [];
  if (isManagementPendingEnquiry(e as any)) return false;
  // Terminal Zoho/sent rows are concluded even with undecided items — the
  // estimate already left draft (sent/accepted/declined…), so there is no
  // decision left to make. Mirrors the sales/procurement auto-conclude
  // (maybePromoteEnquiriesSent in worker/routes/enquiries.ts): flags and
  // unquoted items never block it. Open sent-revisions stay exempt.
  // Zero-item rows are included too: a non-draft estimate with nothing logged
  // has nothing to quote or decide — it belongs in History, not Empty.
  // Mirror: backend/.../queues.ts — change both together.
  if (!isSentReopened(e as any)) {
    const sent = String((e as any)?.rateStatus ?? '') === 'sent';
    const zs = String((e as any)?.zohoStatus ?? '').trim().toLowerCase();
    if (sent || (zs && zs !== 'draft')) return true;
  }
  if (items.length === 0) return false;
  const relevant = items.filter((it) => openLoops(it, 'spec').length === 0 && openLoops(it, 'not_available').length === 0);
  if (relevant.length === 0) return false;
  // Every non-held item must be accounted for — either rate-available / not-available (skip the
  // loop) or decided (finalRate set). Otherwise finalized/sent enquiries that
  // were marked rateAvailable vanish (Enquiry No 4 - 16 SEP TL D1 2026-09-17).
  // Pure rateAvailable/notAvailable rows (no finalRate at all) only belong here after
  // management has committed — otherwise they'd appear as history before any
  // decision.
  const allBypass = relevant.every((it) => (it as any)?.rateAvailable || (it as any)?.notAvailable);
  if (allBypass) return String((e as any)?.rateStatus ?? "") === "finalized" || String((e as any)?.rateStatus ?? "") === "sent";
  return relevant.every((it) => (it as any)?.rateAvailable || (it as any)?.notAvailable || (it.finalRate !== undefined && it.finalRate !== null));
}
