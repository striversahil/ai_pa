"use client";

// Extracted verbatim from WhatsAppMarketingDashboard.tsx by scripts/refactor/split-module.mjs.
// WhatsAppMarketingDashboard.tsx re-exports everything public here, so existing imports keep working.


export function Kpi({ label, value, accent = "text-zinc-900 dark:text-zinc-100" }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 p-4">
      <div className={`text-2xl font-semibold ${accent}`}>{value}</div>
      <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">{label}</div>
    </div>
  );
}
