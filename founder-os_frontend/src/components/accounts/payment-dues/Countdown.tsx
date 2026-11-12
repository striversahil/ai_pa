"use client";

// Extracted verbatim from PaymentDues.tsx by scripts/refactor/split-module.mjs.
// PaymentDues.tsx re-exports everything public here, so existing imports keep working.
import type { PaymentDueRow } from "./types";

export function Countdown({ r }: { r: PaymentDueRow }) {
  if (r.bucket === "paid") return null;
  if (r.bucket === "overdue") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-600 dark:text-rose-400">
        ⚠ Overdue {r.daysOverdue}d
      </span>
    );
  }
  if (r.bucket === "week") {
    const label = r.daysUntil <= 0 ? "Due today" : r.daysUntil === 1 ? "Due tomorrow" : `Due in ${r.daysUntil}d`;
    return (
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
          {label}
        </span>
        {r.remind && (
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-bold text-indigo-600 dark:text-indigo-300" title={`Reminder day (${r.remindDays.join(", ")} days before)`}>
            🔔 Reminder
          </span>
        )}
      </span>
    );
  }
  return <span className="text-[11px] font-semibold text-zinc-500">in {r.daysUntil}d</span>;
}
