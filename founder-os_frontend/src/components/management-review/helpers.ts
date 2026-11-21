// Extracted verbatim from ManagementReview.tsx by scripts/refactor/split-module.mjs.
// ManagementReview.tsx re-exports everything public here, so existing imports keep working.
import type { Enquiry } from "@/types";
import { isManagementPendingEnquiry } from "@/enquiry/queue";

/** Only correct-spec, rate-UNAVAILABLE, rated-but-unfinalized items need a
 *  decision — flagged items stay with Sales until the spec is fixed, then
 *  flow back here. Rate-available items skip the loop entirely. */
export function isManagementPending(e: Enquiry): boolean {
  return isManagementPendingEnquiry(e);
}

// Numbered page window moved to the shared paging module (one home).
export { pageWindow } from "@/lib/paging";
