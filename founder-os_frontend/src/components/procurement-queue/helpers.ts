// Extracted verbatim from ProcurementQueue.tsx by scripts/refactor/split-module.mjs.
// ProcurementQueue.tsx re-exports everything public here, so existing imports keep working.
import type { Enquiry } from "@/types";
import { isProcurementPendingEnquiry } from "@/enquiry/queue";

/** Pending = items still needing rates. Empty enquiries (no items yet) wait
 *  on sales, not procurement — they render in their own section below. */
export function isProcurementPending(e: Enquiry): boolean {
  return isProcurementPendingEnquiry(e);
}

export const byNewest = (a: Enquiry, b: Enquiry): number =>
  String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));

export const fmtDate = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
