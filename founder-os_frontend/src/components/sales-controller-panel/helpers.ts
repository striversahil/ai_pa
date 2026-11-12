// Extracted verbatim from SalesControllerPanel.tsx by scripts/refactor/split-module.mjs.
// SalesControllerPanel.tsx re-exports everything public here, so existing imports keep working.


/** Live events that refresh controller data (same set as the leaderboard). */
export const TELECALLING_EVENTS = ["automation", "telecalling", "estimates", "baseline"];

/** Root/sales-head authority — same check the leaderboard inner tab used (scope or role). */
export function hasSalesManagerAccess(me: { isAdmin?: boolean; scopes?: string[]; roles?: string[] } | null): boolean {
  if (!me) return false;
  return !!(
    me.isAdmin ||
    me.scopes?.includes("sales-head") ||
    me.roles?.includes("sales-head")
  );
}

// Exports the FULL live telecalling payload as one CSV download — performance
// (leaderboard), assignments (conversion summary) and risk (open pipeline)
// stacked as sections. Filters: period + telecaller sub-set (all / follow-up
// specialists / lead-gen only / a specific agent). Generated in the browser
// from the same endpoint the dashboards use — no new backend needed.

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Formula-injection guard: a cell starting with = + - @ (after optional
    // whitespace/quote) executes on open in Excel/Sheets — prefix with a tab.
    const safe = /^[ \t]*[=+\-@]/.test(s) ? `\t${s}` : s;
    return /[",\n\t]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const EXPORT_PERIODS: { key: string; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "lastweek", label: "Last Week" },
  { key: "month", label: "This Month" },
  { key: "lastmonth", label: "Last Month" },
  { key: "year", label: "This Year" },
  { key: "lastyear", label: "Last Year" },
];
