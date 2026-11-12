"use client";

// Extracted verbatim from MasterDataView.tsx by scripts/refactor/split-module.mjs.
// MasterDataView.tsx re-exports everything public here, so existing imports keep working.
import type { LucideIcon } from "lucide-react";

export function Kpi({ label, value, accent, icon: Icon, sub }: {
  label: string;
  value: number | string;
  accent: string;
  icon: LucideIcon;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</span>
        <Icon className={`h-3.5 w-3.5 ${accent}`} />
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${accent}`}>{typeof value === "number" ? value.toLocaleString("en-IN") : value}</div>
      <div className="mt-0.5 truncate text-[11px] text-zinc-500" title={sub}>{sub}</div>
    </div>
  );
}
