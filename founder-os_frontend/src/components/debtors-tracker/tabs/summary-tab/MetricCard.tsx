"use client";

// Extracted verbatim from SummaryTab.tsx by scripts/refactor/split-module.mjs.
// SummaryTab.tsx re-exports everything public here, so existing imports keep working.
import type { Accent } from "./types";
import { ACCENTS } from "./helpers";

export function MetricCard({
  label, value, hint, accent = "zinc", emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: Accent;
  emphasis?: boolean;
}) {
  const a = ACCENTS[accent];
  return (
    <div className={`group relative overflow-hidden rounded-2xl border p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${
      emphasis
        ? "border-zinc-200/80 bg-gradient-to-br from-white to-zinc-50/80 dark:border-zinc-800 dark:from-zinc-900/70 dark:to-zinc-950/40"
        : "border-zinc-200/70 bg-white dark:border-zinc-800/80 dark:bg-zinc-900/40"
    }`}>
      <div className={`absolute inset-x-0 top-0 h-[2px] ${a.bar}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">{label}</div>
        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${a.dot}`} />
      </div>
      <div className={`mt-2 text-[22px] font-semibold leading-none tabular-nums tracking-tight ${accent === "zinc" ? "text-zinc-900 dark:text-zinc-100" : a.icon}`}>
        {value}
      </div>
      {hint && <div className="mt-2 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{hint}</div>}
    </div>
  );
}
