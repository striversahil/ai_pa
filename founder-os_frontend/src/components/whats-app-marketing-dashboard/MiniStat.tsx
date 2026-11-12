"use client";

// Extracted verbatim from WhatsAppMarketingDashboard.tsx by scripts/refactor/split-module.mjs.
// WhatsAppMarketingDashboard.tsx re-exports everything public here, so existing imports keep working.


export function MiniStat({ label, value, cls = "text-zinc-700 dark:text-zinc-300" }: { label: string; value: number; cls?: string }) {
  return (
    <div className="rounded-lg bg-zinc-50/40 dark:bg-zinc-900/40 px-2 py-1.5">
      <div className={`text-sm font-medium ${cls}`}>{value}</div>
      <div className="text-[10px] text-zinc-600 dark:text-zinc-500">{label}</div>
    </div>
  );
}
