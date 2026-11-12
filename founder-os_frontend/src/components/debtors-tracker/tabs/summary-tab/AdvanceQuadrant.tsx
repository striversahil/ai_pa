"use client";

// Extracted verbatim from SummaryTab.tsx by scripts/refactor/split-module.mjs.
// SummaryTab.tsx re-exports everything public here, so existing imports keep working.
import { formatINR } from "@/debtors-tracker/types";
import type { AdvanceBucketKey } from "./types";
import { ADVANCE_TONES } from "./helpers";

export function AdvanceQuadrant({
  bucket, category, period, value, count, className = "",
}: {
  bucket: AdvanceBucketKey;
  category: string;
  period: string;
  value: number;
  count: number;
  className?: string;
}) {
  const tone = ADVANCE_TONES[bucket];
  return (
    <div className={`flex min-h-[118px] flex-col p-3.5 ${tone.surface} ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div className={`text-[9px] font-semibold uppercase leading-tight tracking-[0.13em] ${tone.label}`}>{category}</div>
        <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
      </div>
      <div className="mt-auto pt-4 text-[20px] font-semibold leading-none tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
        {formatINR(value)}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
        <span className="text-zinc-500 dark:text-zinc-400">{period}</span>
        <span className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 font-medium ${tone.chip}`}>
          {count} receipt{count === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
