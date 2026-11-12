"use client";

// Extracted verbatim from OrderPanel.tsx by scripts/refactor/split-module.mjs.
// OrderPanel.tsx re-exports everything public here, so existing imports keep working.
import React from "react";

/** One label/value line of the order details — muted label left, value right. */
export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3.5 py-2">
      <dt className="shrink-0 pt-px text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="min-w-0 text-right text-xs text-zinc-700 dark:text-zinc-200">{children}</dd>
    </div>
  );
}
