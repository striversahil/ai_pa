"use client";

// Extracted verbatim from DigitalMarketingDashboard.tsx by scripts/refactor/split-module.mjs.
// DigitalMarketingDashboard.tsx re-exports everything public here, so existing imports keep working.


export function FreqChip({ f }: { f: string }) {
  const icon = f === "daily" ? "📅" : f === "weekly" ? "🗓" : f === "monthly" ? "📆" : f === "yearly" ? "🎯" : "📊";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
      {icon} {f}
    </span>
  );
}
