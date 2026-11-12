// lib/format.ts — the ONE home for money/date display formatters.
//
// Each export is a byte-for-byte copy of a behavior that previously existed as
// several local copies; variants are kept separate on purpose because they
// differ in visible output (dash vs ₹0 for empty, rounding, year shown, …).
// Legacy local names re-export from here (e.g. `export { inrWhole as inr }`).
// Guard: scripts/guards/format-canonical.test.mjs runs the frozen legacy
// implementations against these on edge-case inputs.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ₹ with Indian grouping; "—" for null/undefined/non-finite. (accounts, field-staff) */
export const inr = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `₹${Number(n).toLocaleString("en-IN")}`;

/** ₹ whole rupees; empty → ₹0. (CRM, dispatch, order panel) */
export const inrWhole = (n: number | null | undefined) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/** ₹ rounded; "—" for null/undefined. (digital-marketing ads) */
export const inrRounded = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;

/** ₹ rounded; anything non-numeric → ₹0. (stock) */
export const inrRoundedOrZero = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

/**
 * Compact rupee notation for tight surfaces (top tab bar badges): 46,099 → ₹46K,
 * 1,00,000 → ₹1L, 2,50,00,000 → ₹2.5Cr. Full figures stay in the tooltip.
 * Indian grouping: 1 lakh = 1e5, 1 crore = 1e7.
 */
export function inrShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const v = Number(n);
  if (v === 0) return "₹0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  const trim = (x: number) => (x >= 10 ? String(Math.round(x)) : String(Math.round(x * 10) / 10));
  let scaled = abs;
  let unit = "";
  if (abs >= 1e7) { scaled = abs / 1e7; unit = "Cr"; }
  else if (abs >= 1e5) { scaled = abs / 1e5; unit = "L"; }
  else if (abs >= 1e3) { scaled = abs / 1e3; unit = "K"; }
  else return `${sign}₹${Math.round(abs)}`;
  // Promote when rounding carries into the next unit (99,999 → ₹1L, not ₹100K).
  if (unit === "K" && Math.round(scaled) >= 100) { scaled /= 100; unit = "L"; }
  if (unit === "L" && Math.round(scaled) >= 100) { scaled /= 100; unit = "Cr"; }
  return `${sign}₹${trim(scaled)}${unit}`;
}

/** "2026-11-05" → "5 Nov"; unparseable input returned as-is. (accounts, field-staff) */
export function fmtDay(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

/** "2026-11-05" → "5 Nov"; bad month → the raw month digits. (telecalling) */
export function fmtDayMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, , mo, d] = m;
  return `${Number(d)} ${MONTHS[Number(mo) - 1] ?? mo}`;
}

/** "2026-11-05" → "5 Nov 2026"; empty → "—". (digital marketing) */
export function fmtDayYear(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return String(iso || "—");
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** Any parseable date → "5 Nov" (en-IN locale); empty/invalid → "". (attachments, procurement) */
export const fmtShortDate = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
