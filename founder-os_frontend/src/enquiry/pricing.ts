// enquiry/pricing.ts — pure pricing math for the Management review panel.
//
// Extracted from ManagementRatesPanel.tsx (no behavior change). Everything
// here is pure (no React): final-rate computation, bulk-split, share keys.
// The panel component keeps ONLY staged-input state + rendering.
export const RATE_STATUS_LABEL: Record<string, string> = {
  "": "Rate Pending",
  rate_pending: "Rate Pending",
  rates_received: "Rates Received",
  finalized: "Finalized",
  sent: "Sent to Client",
};

export const fmtINR = (n: number | null | undefined): string =>
  `₹${Number(n || 0).toLocaleString("en-IN")}`;

/** Round UP to the next multiple of 5 (exact multiples stay). The 1e-6
 *  epsilon keeps float dust (e.g. 1050.0000001) from jumping a bracket. */
export const ceil5 = (x: number): number => Math.ceil((x - 1e-6) / 5) * 5;

/** Final customer rate: vendor rate → vendor discount → management margin →
 *  ceil5. Mirrors the backend decision math (same order, same rounding). */
export function finalFromMargin(vendorRate: number, discountPercent: number | undefined, marginPercent: number): number {
  const d = discountPercent !== undefined && Number.isFinite(discountPercent) ? discountPercent : 0;
  const discounted = vendorRate * (1 - d / 100);
  return ceil5(discounted * (1 + marginPercent / 100));
}

/** Margin % implied by a direct final-₹ entry (for display/validation). */
export function marginFromFinal(vendorRate: number, discountPercent: number | undefined, finalRate: number): number | null {
  const d = discountPercent !== undefined && Number.isFinite(discountPercent) ? discountPercent : 0;
  const base = vendorRate * (1 - d / 100);
  if (!(base > 0) || !(finalRate >= 0)) return null;
  return ((finalRate - base) / base) * 100;
}

/** Share-toggle key: vendor+rate identity so appended/dropped rows can't
 *  shift staged toggles (keyed by content, never by row index). */
export function shareKey(itemIndex: number, r: { vendor?: string; rate?: number }): string {
  return `${itemIndex}|${String(r?.vendor ?? "")}|${Number(r?.rate)}`;
}

/** Bulk combined-final split: one total ₹ across N vendor bases, proportional
 *  to each base, each ceil5 (last line absorbs rounding drift). */
export function splitBulkTotal(bases: number[], total: number): number[] {
  const sum = bases.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || !(total >= 0) || bases.length === 0) return bases.map(() => 0);
  const out = bases.map((b) => ceil5((b / sum) * total));
  const drift = Math.round(total - out.reduce((a, b) => a + b, 0));
  out[out.length - 1] += drift;
  return out;
}
