"use client";

// Extracted verbatim from DigitalMarketingAds.tsx by scripts/refactor/split-module.mjs.
// DigitalMarketingAds.tsx re-exports everything public here, so existing imports keep working.
import type { AdStatus } from "./types";

export function StatusPill({ status }: { status: AdStatus }) {
  const cls = status === 'live'
    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
    : status === 'planned'
      ? 'bg-indigo-500/15 text-indigo-500 border-indigo-500/30'
      : 'bg-zinc-500/15 text-zinc-500 border-zinc-500/30';
  const dot = status === 'live' ? '●' : status === 'planned' ? '○' : '✓';
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-extrabold ${cls}`}>
      {dot} {status}
    </span>
  );
}
