"use client";

// Extracted verbatim from AccountsDashboard.tsx by scripts/refactor/split-module.mjs.
// AccountsDashboard.tsx re-exports everything public here, so existing imports keep working.


export function StatusChip({ status, overdue, incomplete }: { status: string; overdue: boolean; incomplete?: boolean }) {
  const base = "inline-flex items-center gap-1 shrink-0 rounded-full border font-semibold px-2 py-0.5 text-[11px]";
  if (status === "done")
    return <span className={`${base} bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30`}>✓ Done</span>;
  if (status === "skipped")
    return <span className={`${base} bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-400/40`}>⏭ Skipped</span>;
  if (status === "not_done")
    return <span className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>✕ Not Done</span>;
  // Per-day model: anything not done by EOD reads "Not Done" (legacy
  // `overdue` / `inprogress` rows included) and lives in the Incomplete tab.
  if (incomplete || overdue || status === "overdue" || status === "inprogress")
    return <span className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>✕ Not Done</span>;
  return <span className={`${base} bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/30`}>● Pending</span>;
}
