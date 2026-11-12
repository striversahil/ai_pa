"use client";

// Extracted verbatim from AgeingTab.tsx by scripts/refactor/split-module.mjs.
// AgeingTab.tsx re-exports everything public here, so existing imports keep working.
import { situationLabel } from "@/debtors-tracker/types";
import { SITUATION_BADGE } from "./helpers";

export function SituationBadge({ situation }: { situation: string }) {
  if (!situation) return <span className="text-zinc-400 dark:text-zinc-500">Unset</span>;
  const cls = SITUATION_BADGE[situation] ?? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300";
  return (
    <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {situationLabel(situation) || situation}
    </span>
  );
}
