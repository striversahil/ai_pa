// queues.ts — queue predicates: THE single backend source of truth for which
// enquiry sits in which dashboard queue.
//
// Mirrors `founder-os_frontend/src/enquiry/queue.ts` (frontend copy for
// instant client-side filtering). Keep them in sync: both files carry the
// same function names + semantics. If the rule changes, change it here AND
// there together.
//
// Pipeline recap:
//   Sales creates (rate_pending) → Procurement quotes (rates_received) →
//   Management decides (finalized) → Sales marks sent. `procurementSubmittedAt`
//   is the explicit "Enquiry Concluded" handoff; `rateAvailable` /
//   `internalRates` / `specIssue` are per-item bypasses/holds.
import type { Enquiry, EnquiryItem } from "./types";

type ItemRateShape = Pick<EnquiryItem, "rateAvailable" | "internalRates" | "rates" | "ratesRequested">;
type ItemDecisionShape = Pick<EnquiryItem, "rateAvailable" | "internalRates" | "rates" | "finalRate" | "specIssue">;
type EnquiryShape = Pick<Enquiry, "items"> & { procurementSubmittedAt?: string };

/** Loop-eligible for Procurement: unavailable, not internal, unquoted or re-requested. */
export function itemNeedsRates(it: ItemRateShape): boolean {
  return !it?.rateAvailable && !it?.internalRates && (((it?.rates ?? []).length === 0) || !!(it as any)?.ratesRequested);
}

/** Loop-eligible for Management: unavailable, undisputed, quoted/internal, undecided. */
export function itemNeedsDecision(it: ItemDecisionShape): boolean {
  return !it?.rateAvailable
    && ((((it as any)?.rates ?? []).length > 0) || (it as any)?.internalRates === true)
    && ((it as any)?.finalRate === undefined || (it as any)?.finalRate === null)
    && !(it as any)?.specIssue;
}

/** Explicit procurement handoff ("Enquiry Concluded"). */
export function isSubmitted(e: { procurementSubmittedAt?: string }): boolean {
  return !!String(e?.procurementSubmittedAt ?? "").trim();
}

/** Fresh unquoted work reopens procurement Active even on concluded rows. */
export function hasFreshUnquotedWork(e: Pick<Enquiry, "items">): boolean {
  return ((e as any).items ?? []).some((it: any) => !it?.rateAvailable && !it?.internalRates && !it?.specIssue
    && ((it?.rates ?? []).length === 0) && (it?.finalRate === undefined || it?.finalRate === null));
}

/** Pending sales alternate request: sales asked for a different make/option
 *  (`variationRequest`) and procurement hasn't quoted it yet. Reopens the
 *  procurement Active queue even on concluded rows. */
export function hasPendingVariationWork(e: Pick<Enquiry, "items">): boolean {
  return ((e as any).items ?? []).some((it: any) => String(it?.variationRequest ?? "").trim().length > 0);
}

/** New vendor quotes since the decision: a decided item (finalRate set) with
 *  quotes logged AFTER it was finalized that management hasn't shared yet.
 *  Surfaces the item back in the management queue. Rows lacking timestamps
 *  fall back to not-pending (never false-positive on legacy rows).
 *  Rate-available items skip the loop entirely — never unreviewed. */
export function itemHasUnreviewedQuotes(it: any): boolean {
  if ((it as any)?.rateAvailable) return false;
  if (it?.finalRate === undefined || it?.finalRate === null) return false;
  const fin = Date.parse(String(it?.finalizedAt ?? ""));
  if (!Number.isFinite(fin)) return false;
  return ((it?.rates ?? []) as any[]).some((r: any) => {
    const q = Date.parse(String(r?.quotedAt ?? ""));
    if (!Number.isFinite(q) || q <= fin) return false;
    if (r?.sharedWithSales === true) return false;
    return true;
  });
}

/** One fresh line is quotable even on a concluded row (card stays editable). */
export function isFreshQuotableItem(it: ItemDecisionShape): boolean {
  return !(it as any)?.rateAvailable && !(it as any)?.internalRates && !(it as any)?.specIssue
    && (((it as any)?.rates ?? []).length === 0) && ((it as any)?.finalRate === undefined || (it as any)?.finalRate === null);
}

export function isProcurementPendingEnquiry(e: EnquiryShape): boolean {
  const items = (e as any).items ?? [];
  if (items.length === 0) return false;
  // Fresh work (new unquoted lines, pending alternate requests) reopens the
  // queue even on concluded rows — the client keeps asking.
  if (hasFreshUnquotedWork(e as any) || hasPendingVariationWork(e as any)) return true;
  if (isSubmitted(e)) return false;
  return items.some((it: any) => !it?.rateAvailable && !it?.internalRates);
}

export function isProcurementHistoryEnquiry(e: EnquiryShape): boolean {
  const items = (e as any).items ?? [];
  if (!isSubmitted(e)) return false;
  if (hasFreshUnquotedWork(e as any) || hasPendingVariationWork(e as any)) return false;
  return items.some((it: any) => (it.rates ?? []).length > 0 && !it.ratesRequested);
}

export function isManagementPendingEnquiry(e: EnquiryShape): boolean {
  const items = (e as any).items ?? [];
  // Decided items with new unshared vendor quotes since the decision
  // (variation answers, late quotes) come back for review/share.
  return items.some((it: any) => itemNeedsDecision(it) || itemHasUnreviewedQuotes(it));
}

/** Submit readiness: every quotable loop item carries ≥1 vendor rate. */
export function procurementSubmittable(e: Pick<Enquiry, "items">): { ok: boolean; reason: string } {
  const loop = ((e as any).items ?? []).filter((it: any) => !it?.specIssue && !it?.rateAvailable && !it?.internalRates);
  if (loop.length === 0) return { ok: false, reason: "No quotable items yet" };
  const unrated = loop.filter((it: any) => (it?.rates ?? []).length === 0).length;
  if (unrated > 0) return { ok: false, reason: `${unrated} item${unrated === 1 ? "" : "s"} still need${unrated === 1 ? "s" : ""} vendor rates` };
  const flagged = ((e as any).items ?? []).filter((it: any) => it?.specIssue).length;
  if (flagged > 0) return { ok: false, reason: `${flagged} item${flagged === 1 ? "" : "s"} awaiting sales spec fix` };
  return { ok: true, reason: "" };
}

export function isManagementHistoryEnquiry(e: Pick<Enquiry, "items" | "rateStatus">): boolean {
  const items = (e as any).items ?? [];
  if (items.length === 0) return false;
  if (isManagementPendingEnquiry(e as any)) return false;
  const relevant = items.filter((it: any) => !it?.specIssue);
  if (relevant.length === 0) return false;
  // Every non-held item must be accounted for — either rate-available or
  // decided. Pure rateAvailable rows only belong here after commit, otherwise
  // they'd appear as history before any decision (loop empty → false fix).
  const allRateAvailable = relevant.every((it: any) => it?.rateAvailable);
  if (allRateAvailable) {
    const s = String((e as any)?.rateStatus ?? "");
    return s === "finalized" || s === "sent";
  }
  return relevant.every((it: any) => it?.rateAvailable || (it.finalRate !== undefined && it.finalRate !== null));
}
