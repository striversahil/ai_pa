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
//   `internalRates` / `specIssue` are per-item bypasses/holds.
import type { Enquiry, EnquiryItem } from "@/types";

type ItemRateShape = Pick<EnquiryItem, "rateAvailable" | "notAvailable" | "internalRates" | "rates" | "ratesRequested">;
type ItemDecisionShape = Pick<EnquiryItem, "rateAvailable" | "notAvailable" | "internalRates" | "rates" | "finalRate" | "specIssue">;
type EnquiryShape = Pick<Enquiry, "items"> & { procurementSubmittedAt?: string };

/** Loop-eligible for Procurement: unavailable, not internal, unquoted or re-requested. */
export function itemNeedsRates(it: ItemRateShape): boolean {
  return !it?.rateAvailable && !(it as any)?.notAvailable && !(it as any)?.notAvailableRequested && !it?.internalRates && (((it?.rates ?? []).length === 0) || !!it?.ratesRequested);
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

/** Loop-eligible for Management: quoted/internal, undecided — specIssue intimates, rates-available normal flow not blocked. */
export function itemNeedsDecision(it: ItemDecisionShape): boolean {
  return !it?.rateAvailable && !(it as any)?.notAvailable
    && (((it?.rates ?? []).length > 0) || it?.internalRates === true)
    && (it?.finalRate === undefined || it?.finalRate === null);
}

/** Fresh unquoted work reopens procurement Active even on concluded rows. */
export function hasFreshUnquotedWork(e: Pick<Enquiry, "items">): boolean {
  return (e.items ?? []).some((it) => !it?.rateAvailable && !(it as any)?.notAvailable && !(it as any)?.notAvailableRequested && !it?.internalRates && !it?.specIssue
    && ((it?.rates ?? []).length === 0) && (it?.finalRate === undefined || it?.finalRate === null));
}

/** One fresh line is quotable even on a concluded row (card stays editable). */
export function isFreshQuotableItem(it: ItemDecisionShape): boolean {
  return !it?.rateAvailable && !(it as any)?.notAvailable && !(it as any)?.notAvailableRequested && !it?.internalRates && !it?.specIssue
    && (((it as any)?.rates ?? []).length === 0) && ((it as any)?.finalRate === undefined || (it as any)?.finalRate === null);
}

/** Pending sales alternate request: sales asked for a different make/option
 *  (`variationRequest`) and procurement hasn't quoted it yet. Reopens the
 *  procurement Active queue even on concluded rows — otherwise the request
 *  would sit invisible in History. */
export function hasPendingVariationWork(e: Pick<Enquiry, "items">): boolean {
  return (e.items ?? []).some((it) => String((it as any)?.variationRequest ?? "").trim().length > 0);
}

/** Pending not-available request: procurement says material not available, awaiting management approval. */
export function hasPendingNotAvailableWork(e: Pick<Enquiry, "items">): boolean {
  return (e.items ?? []).some((it) => String((it as any)?.notAvailableRequested ?? "").trim().length > 0);
}

/** New vendor quotes since the decision: a decided item (finalRate set)
 *  with quotes logged AFTER it was finalized that management hasn't shared
 *  yet. Surfaces the item back in the management queue so the new quote can
 *  be reviewed/shared (Revise → share). Rows lacking timestamps fall back to
 *  the old behavior (not pending) — never false-positive on legacy rows. */
export function itemHasUnreviewedQuotes(it: Pick<EnquiryItem, "rates" | "finalRate"> & { finalizedAt?: string }): boolean {
  if ((it as any)?.rateAvailable || (it as any)?.notAvailable) return false;
  if ((it as any)?.finalRate === undefined || (it as any)?.finalRate === null) return false;
  const fin = Date.parse(String((it as any)?.finalizedAt ?? ""));
  if (!Number.isFinite(fin)) return false;
  return ((it as any)?.rates ?? []).some((r: any) => {
    const q = Date.parse(String(r?.quotedAt ?? ""));
    if (!Number.isFinite(q) || q <= fin) return false;
    if (r?.sharedWithSales === true) return false;
    return true;
  });
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
  if (hasPendingProcurementThread(e as any)) return true;
  const reopened = isSentReopened(e as any);
  const isTerminal = !reopened && (String((e as any).rateStatus ?? '') === 'sent' || (String((e as any).zohoStatus ?? '').trim() && String((e as any).zohoStatus ?? '').trim().toLowerCase() !== 'draft'));
  if (isTerminal && hasAnySalesThread(e as any)) return true;
  const zs = String((e as any).zohoStatus ?? '').trim().toLowerCase();
  if (!reopened && String((e as any).rateStatus ?? '') === 'sent') return false;
  if (!reopened && zs && zs !== 'draft') return false;
  // Fresh work (new unquoted lines, pending alternate requests) reopens the
  // queue even on concluded rows — the client keeps asking.
  if (hasFreshUnquotedWork(e) || hasPendingVariationWork(e)) return true;
  if (isSubmitted(e)) return false;
  return items.some((it) => !it?.rateAvailable && !(it as any)?.notAvailable && !(it as any)?.notAvailableRequested && !it?.internalRates);
}

export function isProcurementHistoryEnquiry(e: EnquiryShape): boolean {
  const items = e.items ?? [];
  if (hasPendingProcurementThread(e as any)) return false;
  const reopened = isSentReopened(e as any);
  const isTerminal = !reopened && (String((e as any).rateStatus ?? '') === 'sent' || (String((e as any).zohoStatus ?? '').trim() && String((e as any).zohoStatus ?? '').trim().toLowerCase() !== 'draft'));
  if (isTerminal && hasAnySalesThread(e as any)) return false;
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
  return items.some((it) => ((it.rates ?? []).length > 0 && !it.ratesRequested) || (it as any).notAvailable || (it as any).notAvailableRequested || it.rateAvailable);
}

export function isManagementPendingEnquiry(e: EnquiryShape): boolean {
  void isSubmitted; // live visibility — submitted flag no longer gates management
  const items = e.items ?? [];
  const reopened = isSentReopened(e as any);
  if (!reopened && String((e as any).rateStatus ?? '') === 'sent') return false;
  const zs = String((e as any).zohoStatus ?? '').trim().toLowerCase();
  if (!reopened && zs && zs !== 'draft') return false;
  // Any item needing a decision appears here instantly (correct spec, quoted
  // or internal, not yet finalized) — plus decided items with new unshared
  // vendor quotes since the decision (variation answers, late quotes) — plus
  // procurement's not-available requests awaiting approval.
  return items.some((it) => itemNeedsDecision(it) || itemHasUnreviewedQuotes(it as any) || !!(it as any)?.notAvailableRequested);
}

/** Submit readiness: every quotable loop item carries ≥1 vendor rate. */
export function procurementSubmittable(e: Pick<Enquiry, "items">): { ok: boolean; reason: string } {
  const items = e.items ?? [];
  const flagged = items.filter((it) => it?.specIssue && !(it as any)?.notAvailable && !(it as any)?.notAvailableRequested).length;
  if (flagged > 0) return { ok: false, reason: `${flagged} item${flagged === 1 ? "" : "s"} awaiting sales spec fix` };
  const loop = items.filter((it) => !it?.specIssue && !it?.rateAvailable && !(it as any)?.notAvailable && !(it as any)?.notAvailableRequested && !it?.internalRates);
  if (loop.length === 0) {
    const hasBypass = items.some((it) => it?.rateAvailable || (it as any)?.notAvailable || (it as any)?.notAvailableRequested || it?.internalRates);
    if (hasBypass) return { ok: true, reason: "" };
    return { ok: false, reason: "No quotable items yet" };
  }
  const unrated = loop.filter((it) => (it?.rates ?? []).length === 0).length;
  if (unrated > 0) return { ok: false, reason: `${unrated} item${unrated === 1 ? "" : "s"} still need${unrated === 1 ? "s" : ""} vendor rates (or mark rate available / not available)` };
  return { ok: true, reason: "" };
}

/** Open thread from either side: survives concluded/zoho filters until resolved (bilateral). Mirror backend queues.ts */
export function hasOpenThread(e: Pick<Enquiry, "items">): boolean {
  return (e.items ?? []).some((it: any) => !!it?.specIssue || !!String(it?.variationRequest ?? "").trim() || !!String((it as any)?.notAvailableRequested ?? "").trim() || !!String((it as any)?.ratesRequested ?? "").trim() || (Array.isArray(it?.thread) && it.thread.length > 0 && !it?.threadResolved));
}
/** Needs action: the actionable subset of open threads — someone must move:
 *  spec fix (sales), pending ask (procurement must answer), or not-available
 *  request (management must approve). Mirror backend queues.ts. */
export function needsActionThread(e: Pick<Enquiry, "items">): boolean {
  return (e.items ?? []).some((it: any) => !!it?.specIssue || hasPendingProcurementThread({ items: [it] } as any) || !!String((it as any)?.notAvailableRequested ?? "").trim());
}
export function isOpenThreadEnquiry(e: Pick<Enquiry, "items">): boolean { return hasOpenThread(e); }
/** Procurement needs to answer: only sales ask (variation/request/flag), not generic remark/fix. */
export function hasPendingProcurementThread(e: Pick<Enquiry, "items">): boolean {
  return (e.items ?? []).some((it: any) => {
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
  return (e.items ?? []).some((it: any) => {
    if (Array.isArray(it?.thread) && it.thread.length > 0 && !it?.threadResolved) {
      const last = it.thread[it.thread.length - 1];
      if (String((last as any)?.by ?? "") === "sales" && String((last as any)?.kind ?? "") !== "fix") return true;
    }
    return false;
  });
}

export function isManagementHistoryEnquiry(e: Pick<Enquiry, "items" | "rateStatus">): boolean {
  const items = e.items ?? [];
  if (items.length === 0) return false;
  if (isManagementPendingEnquiry(e as any)) return false;
  const relevant = items.filter((it) => !it?.specIssue && !(it as any)?.notAvailableRequested);
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
