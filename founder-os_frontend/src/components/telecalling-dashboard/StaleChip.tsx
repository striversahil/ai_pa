"use client";

// Extracted verbatim from TelecallingDashboard.tsx by scripts/refactor/split-module.mjs.
// TelecallingDashboard.tsx re-exports everything public here, so existing imports keep working.


/** Time-since-last-comment chip — the "clock is ticking" signal for agents. */
export function StaleChip({ staleHours, compact = false }: { staleHours: number | null | undefined; compact?: boolean }) {
  const base = `inline-flex items-center gap-1 shrink-0 rounded-full border font-semibold ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`;
  if (staleHours === null || staleHours === undefined)
    return (
      <span title="No sales comment synced from Zoho yet" className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ∅{compact ? "" : " No comments"}
      </span>
    );
  const days = Math.floor(staleHours / 24);
  if (days >= 3)
    return (
      <span title={`Last comment ${days} days ago — zombie territory (silent > 3 days = reassigned)`} className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ⏰{compact ? "" : ` ${days}d stale`}
      </span>
    );
  if (staleHours >= 24)
    return (
      <span title="Last comment was more than a day ago" className={`${base} bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/30`}>
        ⏰{compact ? "" : " 1d+"}
      </span>
    );
  return (
    <span title="Commented within the last 24 hours" className={`${base} bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30`}>
      ●{compact ? "" : " Fresh"}
    </span>
  );
}
