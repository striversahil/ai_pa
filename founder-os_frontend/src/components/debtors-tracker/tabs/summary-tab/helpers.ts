// Extracted verbatim from SummaryTab.tsx by scripts/refactor/split-module.mjs.
// SummaryTab.tsx re-exports everything public here, so existing imports keep working.
import type { LiveCollection } from "@/debtors-tracker/types";
import type { AdvanceBucketKey } from "./types";

export const ACCENTS = {
  zinc: { bar: "bg-zinc-700 dark:bg-zinc-300", dot: "bg-zinc-300 dark:bg-zinc-600", icon: "text-zinc-500 dark:text-zinc-400" },
  sky: { bar: "bg-sky-500", dot: "bg-sky-400", icon: "text-sky-600 dark:text-sky-400" },
  rose: { bar: "bg-rose-500", dot: "bg-rose-400", icon: "text-rose-600 dark:text-rose-400" },
  emerald: { bar: "bg-emerald-500", dot: "bg-emerald-400", icon: "text-emerald-600 dark:text-emerald-400" },
  amber: { bar: "bg-amber-500", dot: "bg-amber-400", icon: "text-amber-600 dark:text-amber-400" },
} as const;

export function dayOffset(asOf: string, daysAgo: number): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export function dayLabel(day: string): string {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

/** Monday of the week containing an ISO date (IST date-only). */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function sumAmounts(rows: LiveCollection[]): number {
  return rows.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
}

export const ADVANCE_TONES: Record<AdvanceBucketKey, { surface: string; label: string; dot: string; chip: string }> = {
  previousWeek: {
    surface: "bg-gradient-to-br from-sky-50/90 via-white to-white dark:from-sky-950/30 dark:via-zinc-900/30 dark:to-zinc-900/10",
    label: "text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
    chip: "bg-sky-500/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300",
  },
  previousMonth: {
    surface: "bg-gradient-to-br from-emerald-50/90 via-white to-white dark:from-emerald-950/30 dark:via-zinc-900/30 dark:to-zinc-900/10",
    label: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
  },
  advanceWeek: {
    surface: "bg-gradient-to-br from-amber-50/90 via-white to-white dark:from-amber-950/25 dark:via-zinc-900/30 dark:to-zinc-900/10",
    label: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
  },
  advanceMonth: {
    surface: "bg-gradient-to-br from-violet-50/90 via-white to-white dark:from-violet-950/30 dark:via-zinc-900/30 dark:to-zinc-900/10",
    label: "text-violet-700 dark:text-violet-300",
    dot: "bg-violet-500",
    chip: "bg-violet-500/10 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300",
  },
};

export const REGION_TILE_TONES: Record<string, string> = {
  R1: "ring-indigo-500/60 bg-indigo-50/60 dark:bg-indigo-500/10",
  R2: "ring-sky-500/60 bg-sky-50/60 dark:bg-sky-500/10",
  R3: "ring-amber-500/60 bg-amber-50/60 dark:bg-amber-500/10",
  R4: "ring-emerald-500/60 bg-emerald-50/60 dark:bg-emerald-500/10",
};
