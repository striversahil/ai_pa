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

// Numbered page jumper (History footer): ‹ Prev · 1 … 4 5 6 … 12 · Next ›.
// Windowed to 7 slots so it stays compact at hundreds of pages. Pages over
// the COMPLETE local history set — every row, however old, no 100-row cap.
export function pageWindow(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set<number>([1, 2, current - 1, current, current + 1, total - 1, total]);
  const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  for (let i = 0; i < nums.length; i++) {
    if (i > 0 && nums[i] - nums[i - 1] > 1) out.push("…");
    out.push(nums[i]);
  }
  return out;
}
