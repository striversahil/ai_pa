// format.ts — pure display formatters for the telecalling dashboards.
//
// Extracted verbatim from `components/TelecallingDashboard.tsx` (which keeps
// re-exporting them) so the presentational components can import them without
// pulling the whole page module in. No business logic: these only turn numbers
// and dates into strings.

/** Talk time: seconds → "1h 12m" / "42m" / "—". */
export function fmtTalk(sec: number): string {
  if (!sec) return "—";
  const totalMin = Math.round(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Plain grouped integer: 1234 → "1,234". */
export function fmtNum(n: number): string {
  return n === 0 ? "0" : n.toLocaleString();
}

/** "500000" → "₹5.0L", "10000000" → "₹1.0Cr" (compact target labels). */
export function fmtLakh(n: number): string {
  if (!n) return "₹0";
  if (n >= 10000000) {
    const v = n / 10000000;
    return `₹${Number.isInteger(v) ? v : v.toFixed(1)}Cr`;
  }
  if (n >= 100000) {
    const v = n / 100000;
    return `₹${Number.isInteger(v) ? v : v.toFixed(1)}L`;
  }
  return `₹${Math.round(n).toLocaleString()}`;
}

/** "2026-09-07" → "7 Sep" (short, human-friendly). Tolerates a missing/partial
 *  date by returning the raw string unchanged. */
export function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, , mo, d] = m;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${MONTHS[Number(mo) - 1] ?? mo}`;
}

/** "Samarjeet Kaur" → "SK" (avatar initials; "?" when the name is empty). */
export function initials(name: string | null | undefined): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}
