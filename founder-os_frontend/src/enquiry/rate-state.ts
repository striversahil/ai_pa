// Pure sales-side status derivation for one enquiry (list row + detail
// header read the same answer). Sync, no fetch. Extracted verbatim from
// EnquiryRowItem so both surfaces stop re-deriving it inline.
import type { Enquiry } from "@/types";
import type { Tone } from "@/components/ui";
import { isOpenSpecFlag } from "@/enquiry/queue";
import { companiesDiffer } from "@/enquiry/company";

export interface EnquiryRateState {
  label: string;
  tone: Tone;
  title?: string;
  /** Terminal "sent" (internal or any non-draft Zoho status), never while revising. */
  sent: boolean;
  revising: boolean;
  isZohoSent: boolean;
  /** Raw Zoho status, lower-cased ('' when not linked). */
  zohoStatus: string;
  finalized: boolean;
  notAvailableCount: number;
  notAvailableTitle: string;
  noItems: boolean;
  /** Not sent and ≥24h old. level 0 = 24–48h … 3 = 96h+. */
  overdue: { label: string; level: number } | null;
  /** Zoho customer name when it loosely differs from the enquiry client. */
  zohoNameMismatch: string | null;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Heading for one enquiry: the "Enquiry No …" label is ALWAYS the heading
 *  (founder ask 2026-11-20); the item title is a small subtitle, dropped when
 *  empty or just a repeat of the label — never the same number twice. */
export function enquiryHeading(enq: Enquiry, label: string): { heading: string; subtitle: string | null } {
  const title = String(enq.title ?? "").trim();
  const dup = !title || (squash(label) !== "" && squash(title).includes(squash(label)));
  return { heading: label, subtitle: dup ? null : title };
}

const ZOHO_TONE: Record<string, Tone> = { sent: "sky", accepted: "success", declined: "danger" };
export const zohoTone = (status: string): Tone => ZOHO_TONE[status] ?? "neutral";

export function enquiryRateState(enq: Enquiry, now = Date.now()): EnquiryRateState {
  const items = enq.items ?? [];
  const rateStatus = enq.rateStatus ?? "";
  const hasRates = items.some((it) => (it.rates ?? []).length > 0);
  const finalized = rateStatus === "finalized";
  // Zoho is source of truth: sent/accepted/declined/etc. (non-draft) auto-means internal `sent`.
  const zohoStatus = String((enq as any)?.zohoStatus ?? "").toLowerCase();
  const isZohoSent = !!zohoStatus && zohoStatus !== "draft";
  // Open sent-revision: the row loops again (not terminal) — chip reads revision, not sent.
  const revising = !!String((enq as any)?.sentRevisionAt ?? "").trim();
  const sent = !revising && (rateStatus === "sent" || isZohoSent);
  // Rate available / not available overrides the hold; resolved flags are audit trail only.
  const flagged = items.some((it) => isOpenSpecFlag(it) && !it.rateAvailable && !(it as any).notAvailable && !(it as any).internalRates);
  const naItems = items.filter((it) => (it as any).notAvailable) as any[];
  const notAvailable = naItems.length > 0;
  const hasPartialRates = !finalized && !sent && items.some((it) => it.finalRate !== undefined && it.finalRate !== null);

  const createdMs = enq.createdAt ? new Date(enq.createdAt).getTime() : 0;
  const hours = !sent && createdMs ? Math.floor((now - createdMs) / 3600000) : 0;
  const overdue = !sent && hours >= 24
    ? { label: hours >= 48 ? `${Math.floor(hours / 24)}d overdue` : `${hours}h overdue`, level: Math.min(3, Math.floor((hours - 24) / 24)) }
    : null;

  const [label, tone]: [string, Tone] = revising ? ["Under revision", "brand"]
    : sent ? ["Marked as Sent", "sky"]
    : notAvailable ? ["Not Available", "neutral"]
    : flagged ? ["Fix Spec", "danger"]
    : finalized ? ["Rates Ready", "success"]
    : hasPartialRates ? ["Partial rates", "warning"]
    : hasRates ? ["Rating…", "warning"]
    : ["Awaiting rates", "neutral"];

  const zohoName = String((enq as any)?.zohoCustomerName ?? "");
  return {
    label, tone,
    title: revising ? "Management reopened this sent enquiry — new items loop procurement → management again" : undefined,
    sent, revising, isZohoSent, zohoStatus, finalized,
    notAvailableCount: naItems.length,
    notAvailableTitle: naItems.map((it) => `${it.name || "Item"}${it.notAvailableReason ? `: ${it.notAvailableReason}` : ""}`).join(" · "),
    noItems: items.length === 0,
    overdue,
    zohoNameMismatch: enq.estNumber && zohoName && companiesDiffer(enq.clientCompany, zohoName) ? zohoName : null,
  };
}
