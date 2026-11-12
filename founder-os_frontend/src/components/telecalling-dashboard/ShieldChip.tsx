"use client";

// Extracted verbatim from TelecallingDashboard.tsx by scripts/refactor/split-module.mjs.
// TelecallingDashboard.tsx re-exports everything public here, so existing imports keep working.


/** Effort-shield chip — the agent's visible proof of protection. Shown on
 *  red/zombie follow-ups the holder earned (3+ calls, 2h+ spread): the
 *  estimate stays with them today despite the unsatisfactory flag. */
export function ShieldChip({ shield, compact = false }: {
  shield?: { status: string; reason: string; n: number; spanH: number; streak: number } | null;
  compact?: boolean;
}) {
  if (!shield) return null;
  const base = `inline-flex items-center gap-1 shrink-0 rounded-full border font-semibold ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`;
  if (shield.status === "expiring")
    return (
      <span title={`${shield.reason} — call and close it today`} className={`${base} bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30`}>
        ⏳{compact ? "" : " Shield ends today"}
      </span>
    );
  return (
    <span title={`${shield.reason} — stays with you, no re-poaching`} className={`${base} bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30`}>
      🛡{compact ? "" : ` Shield day ${(shield.streak ?? 0) + 1}/2 · ${shield.n} calls`}
    </span>
  );
}
