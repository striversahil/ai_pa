"use client";

// Extracted verbatim from CustomerDrawer.tsx by scripts/refactor/split-module.mjs.
// CustomerDrawer.tsx re-exports everything public here, so existing imports keep working.


export function Pill({ tone, label }: { tone: "rose" | "amber" | "zinc" | "indigo" | "emerald"; label: string }) {
  const tones = {
    rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    zinc: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
    indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  } as const;
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>{label}</span>;
}
