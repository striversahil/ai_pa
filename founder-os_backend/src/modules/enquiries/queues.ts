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

type ItemRateShape = Pick<EnquiryItem, "rateAvailable" | "internalRates" | "rates" | "ratesRequested"> & { notAvailable?: boolean };
type ItemDecisionShape = Pick<EnquiryItem, "rateAvailable" | "internalRates" | "rates" | "finalRate" | "specIssue"> & { notAvailable?: boolean };
type EnquiryShape = Pick<Enquiry, "items"> & { procurementSubmittedAt?: string };

/** Loop-eligible for Procurement: unavailable, not internal, unquoted or re-requested. */
export function itemNeedsRates(it: ItemRateShape): boolean {
  return !it?.rateAvailable && !(it as any)?.notAvailable && !(it as any)?.notAvailableRequested && !it?.internalRates && (((it?.rates ?? []).length === 0) || !!(it as any)?.ratesRequested);
}

/** Loop-eligible for Management: quoted/internal, undecided — specIssue intimates, rates-available normal flow not blocked. */
export function itemNeedsDecision(it: ItemDecisionShape): boolean {
  return !it?.rateAvailable && !(it as any)?.notAvailable
    && ((((it as any)?.rates ?? []).length > 0) || (it as any)?.internalRates === true)
    && ((it as any)?.finalRate === undefined || (it as any)?.finalRate === null);
}

/** Sent-revision marker: management reopened a `sent` enquiry for additional
 *  scope (revise flow). While set, the row loops procurement → management →
 *  sent again — Zoho non-draft does NOT hold it terminal. Cleared on the next
 *  mark-as-sent. Mirrors `frontend/src/enquiry/queue.ts` — keep in sync. */
export function isSentReopened(e: { sentRevisionAt?: string }): boolean {
  return !!String((e as any)?.sentRevisionAt ?? "").trim();
}

/** Explicit procurement handoff ("Enquiry Concluded"). */
export function isSubmitted(e: { procurementSubmittedAt?: string }): boolean {
  return !!String(e?.procurementSubmittedAt ?? "").trim();
}

/** Fresh unquoted work reopens procurement Active even on concluded rows. */
export function hasFreshUnquotedWork(e: Pick<Enquiry, "items">): boolean {
  return ((e as any).items ?? []).some((it: any) => !it?.rateAvailable && !(it as any)?.notAvailable && !(it as any)?.notAvailableRequested && !it?.internalRates && !it?.specIssue
    && ((it?.rates ?? []).length === 0) && (it?.finalRate === undefined || it?.finalRate === null));
}

/** Pending sales alternate request: sales asked for a different make/option
 *  (`variationRequest`) and procurement hasn't quoted it yet. Reopens the
 *  procurement Active queue even on concluded rows. */
export function hasPendingVariationWork(e: Pick<Enquiry, "items">): boolean {
  return ((e as any).items ?? []).some((it: any) => String(it?.variationRequest ?? "").trim().length > 0);
}

/** Pending not-available request: procurement says material not available, awaiting management approval. */
export function hasPendingNotAvailableWork(e: Pick<Enquiry, "items">): boolean {
  return ((e as any).items ?? []).some((it: any) => String(it?.notAvailableRequested ?? "").trim().length > 0);
}

/** New vendor quotes since the decision: a decided item (finalRate set) with
 *  quotes logged AFTER it was finalized that management hasn't shared yet.
 *  Surfaces the item back in the management queue. Rows lacking timestamps
 *  fall back to not-pending (never false-positive on legacy rows).
 *  Rate-available / not-available items skip the loop entirely — never unreviewed. */
export function itemHasUnreviewedQuotes(it: any): boolean {
  if ((it as any)?.rateAvailable || (it as any)?.notAvailable) return false;
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
  return !(it as any)?.rateAvailable && !(it as any)?.notAvailable && !(it as any)?.notAvailableRequested && !(it as any)?.internalRates && !(it as any)?.specIssue
    && (((it as any)?.rates ?? []).length === 0) && ((it as any)?.finalRate === undefined || (it as any)?.finalRate === null);
}

/** Zoho-cancelled requirement (client side): declined / void / cancelled /
 *  rejected. Dead rows never sit in Active — they conclude automatically
 *  (see the auto-stamp in worker/routes/enquiries.ts). Mirrors
 *  `founder-os_frontend/src/enquiry/queue.ts` — keep in sync. */
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
  const items = (e as any).items ?? [];
  if (items.length === 0) return false;
  // Sales ask (flag/request) reactivates even when terminal — check before terminal gate
  if (hasPendingProcurementThread(e as any)) return true;
  // Open sent-revision: the row loops again — Zoho non-draft does NOT hold it terminal.
  const reopened = isSentReopened(e as any);
  const isTerminal = !reopened && (String((e as any).rateStatus ?? '') === 'sent' || (String((e as any).zohoStatus ?? '').trim() && String((e as any).zohoStatus ?? '').trim().toLowerCase() !== 'draft'));
  // Zoho sent thread (any sales remark) reactivates terminal for visibility — e.g. 10-23 "sent"
  if (isTerminal && hasAnySalesThread(e as any)) return true;
  // Zoho not draft (sent/accepted/declined etc.) — procurement done even with pending rates
  if (!reopened && String((e as any).rateStatus ?? '') === 'sent') return false;
  const zs = String((e as any).zohoStatus ?? '').trim().toLowerCase();
  if (!reopened && zs && zs !== 'draft') return false;
  // Fresh work (new unquoted lines, pending alternate requests) reopens the
  // queue even on concluded rows — the client keeps asking.
  if (hasFreshUnquotedWork(e as any) || hasPendingVariationWork(e as any)) return true;
  if (isSubmitted(e)) return false;
  return items.some((it: any) => !it?.rateAvailable && !(it as any)?.notAvailable && !(it as any)?.notAvailableRequested && !it?.internalRates);
}

export function isProcurementHistoryEnquiry(e: EnquiryShape): boolean {
  const items = (e as any).items ?? [];
  if (hasPendingProcurementThread(e as any)) return false;
  const reopened = isSentReopened(e as any);
  const isTerminal = !reopened && (String((e as any).rateStatus ?? '') === 'sent' || (String((e as any).zohoStatus ?? '').trim() && String((e as any).zohoStatus ?? '').trim().toLowerCase() !== 'draft'));
  if (isTerminal && hasAnySalesThread(e as any)) return false;
  // Zoho not draft (sent/accepted/declined etc.) — always History
  if (!reopened && String((e as any).rateStatus ?? '') === 'sent') return items.length > 0;
  const zs = String((e as any).zohoStatus ?? '').trim().toLowerCase();
  if (!reopened && zs && zs !== 'draft') return items.length > 0;
  // Closed requirement: concluded automatically — visible in History even
  // before/without the explicit handoff stamp.
  if (!isSubmitted(e)) return false;
  if (hasFreshUnquotedWork(e as any) || hasPendingVariationWork(e as any)) return false;
  if (hasPendingNotAvailableWork(e as any)) return false;
  return items.some((it: any) => ((it.rates ?? []).length > 0 && !it.ratesRequested) || (it as any).notAvailable || (it as any).notAvailableRequested || it.rateAvailable);
}

export function isManagementPendingEnquiry(e: EnquiryShape): boolean {
  const items = (e as any).items ?? [];
  // Open sent-revision loops again — Zoho non-draft does NOT hold it terminal.
  const reopened = isSentReopened(e as any);
  if (!reopened && String((e as any).rateStatus ?? '') === 'sent') return false;
  const zs = String((e as any).zohoStatus ?? '').trim().toLowerCase();
  if (!reopened && zs && zs !== 'draft') return false;
  // Decided items with new unshared vendor quotes since the decision
  // (variation answers, late quotes) come back for review/share — plus
  // procurement's not-available requests awaiting approval.
  return items.some((it: any) => itemNeedsDecision(it) || itemHasUnreviewedQuotes(it) || !!(it as any).notAvailableRequested);
}

/** Submit readiness: every quotable loop item carries ≥1 vendor rate. */
export function procurementSubmittable(e: Pick<Enquiry, "items">): { ok: boolean; reason: string } {
  const items = ((e as any).items ?? []) as any[];
  const flagged = items.filter((it: any) => it?.specIssue && !(it as any)?.notAvailable && !(it as any)?.notAvailableRequested).length;
  if (flagged > 0) return { ok: false, reason: `${flagged} item${flagged === 1 ? "" : "s"} awaiting sales spec fix` };
  const loop = items.filter((it: any) => !it?.specIssue && !it?.rateAvailable && !(it as any)?.notAvailable && !(it as any)?.notAvailableRequested && !it?.internalRates);
  if (loop.length === 0) {
    const hasBypass = items.some((it: any) => it?.rateAvailable || (it as any)?.notAvailable || (it as any)?.notAvailableRequested || it?.internalRates);
    if (hasBypass) return { ok: true, reason: "" };
    return { ok: false, reason: "No quotable items yet" };
  }
  const unrated = loop.filter((it: any) => (it?.rates ?? []).length === 0).length;
  if (unrated > 0) return { ok: false, reason: `${unrated} item${unrated === 1 ? "" : "s"} still need${unrated === 1 ? "s" : ""} vendor rates (or mark rate available / not available)` };
  return { ok: true, reason: "" };
}

/** Needs action: the actionable subset of open threads — someone must move:
 *  spec fix (sales), pending ask (procurement must answer), or not-available
 *  request (management must approve). Mirrors frontend queue.ts. */
export function needsActionThread(e: Pick<Enquiry, "items">): boolean {
  return ((e as any).items ?? []).some((it: any) => !!it?.specIssue || hasPendingProcurementThread({ items: [it] } as any) || !!String((it as any)?.notAvailableRequested ?? "").trim());
}

/** Open thread from either side: survives concluded/zoho filters until resolved (bilateral). */
export function hasOpenThread(e: Pick<Enquiry, "items">): boolean {
  return ((e as any).items ?? []).some((it: any) =>
    !!it?.specIssue ||
    !!String(it?.variationRequest ?? "").trim() ||
    !!String(it?.notAvailableRequested ?? "").trim() ||
    !!String(it?.ratesRequested ?? "").trim() ||
    (Array.isArray(it?.thread) && it.thread.length > 0 && !it?.threadResolved)
  );
}
export function isOpenThreadEnquiry(e: Pick<Enquiry, "items">): boolean {
  return hasOpenThread(e);
}
/** Procurement needs to answer: only sales ask (variation/request/flag), not generic remark/fix. */
export function hasPendingProcurementThread(e: Pick<Enquiry, "items">): boolean {
  return ((e as any).items ?? []).some((it: any) => {
    if (String(it?.variationRequest ?? "").trim()) return true;
    if (String((it as any)?.ratesRequested ?? "").trim()) return true;
    if (Array.isArray(it?.thread) && it.thread.length > 0 && !it?.threadResolved) {
      const last = it.thread[it.thread.length - 1];
      if (String((last as any)?.by ?? "") === "sales" && (String((last as any)?.kind ?? "") === "flag" || String((last as any)?.kind ?? "") === "request")) return true;
    }
    return false;
  });
}
export function hasAnySalesThread(e: Pick<Enquiry, "items">): boolean {
  return ((e as any).items ?? []).some((it: any) => {
    if (Array.isArray(it?.thread) && it.thread.length > 0 && !it?.threadResolved) {
      const last = it.thread[it.thread.length - 1];
      if (String((last as any)?.by ?? "") === "sales" && String((last as any)?.kind ?? "") !== "fix") return true;
    }
    return false;
  });
}

export function isManagementHistoryEnquiry(e: Pick<Enquiry, "items" | "rateStatus">): boolean {
  const items = (e as any).items ?? [];
  if (items.length === 0) return false;
  if (isManagementPendingEnquiry(e as any)) return false;
  const relevant = items.filter((it: any) => !it?.specIssue && !(it as any)?.notAvailableRequested);
  if (relevant.length === 0) return false;
  // Every non-held item must be accounted for — either rate-available / not-available or
  // decided. Pure bypass rows only belong here after commit, otherwise
  // they'd appear as history before any decision (loop empty → false fix).
  const allBypass = relevant.every((it: any) => it?.rateAvailable || (it as any)?.notAvailable);
  if (allBypass) {
    const s = String((e as any)?.rateStatus ?? "");
    return s === "finalized" || s === "sent";
  }
  return relevant.every((it: any) => it?.rateAvailable || (it as any)?.notAvailable || (it.finalRate !== undefined && it.finalRate !== null));
}
