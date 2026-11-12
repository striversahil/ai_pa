"use client";

// Extracted verbatim from OrderPanel.tsx by scripts/refactor/split-module.mjs.
// OrderPanel.tsx re-exports everything public here, so existing imports keep working.
import type { CrmItem } from "../types";
import { AlertTriangle, Clock } from "lucide-react";

export function ItemStateChip({ item, overdue, due }: { item: CrmItem; overdue: boolean; due: boolean }) {  if (item.dispatchState === "dispatched") {
    return <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Dispatched</span>;
  }
  if (item.dispatchState === "scheduled") {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-semibold ${
          overdue ? "text-rose-600 dark:text-rose-400" : due ? "text-indigo-600 dark:text-indigo-400" : "text-sky-600 dark:text-sky-400"
        }`}
      >
        {overdue ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
        {overdue ? "Overdue" : due ? "Out today" : "Scheduled"}
      </span>
    );
  }
  return <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">{item.delayReason ? "Blocked" : "Unscheduled"}</span>;
}
