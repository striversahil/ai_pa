"use client";

// Extracted verbatim from TelecallingDashboard.tsx by scripts/refactor/split-module.mjs.
// TelecallingDashboard.tsx re-exports everything public here, so existing imports keep working.


/** Attention chip (region model): red = stale/unactioned, zombie = silent 3d+.
 *  Informational only — estimates stay in the region, nothing is re-poached. */
export function SnatchChip({ risk, snatchInHours, compact = false }: { risk?: string | null; snatchInHours?: number | null; compact?: boolean }) {
  const base = `inline-flex items-center gap-1 shrink-0 rounded-full border font-semibold ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`;
  if (risk === "zombie")
    return (
      <span title="Silent for over 3 days — dead weight on the board" className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ☠{compact ? "" : " Zombie"}
      </span>
    );
  if (risk === "red")
    return (
      <span title="Unsatisfactory remark, or last update older than 24h — needs a call" className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ⚠{compact ? "" : " Needs update"}
      </span>
    );
  if (risk === "pending")
    return (
      <span title="Awaiting the AI verdict" className={`${base} bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/30`}>
        ⏳{compact ? "" : " Analyzing"}
      </span>
    );
  return (
    <span title="Meaningful update logged" className={`${base} bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30`}>
      ✓{compact ? "" : " Updated"}
    </span>
  );
}
