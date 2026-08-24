"use client";

import React from "react";
import type { FilterRule } from "./types";

interface Props {
  filters: FilterRule[];
  resultCount: number;
  onAdd: () => void;
  onUpdate: (id: number, patch: Partial<FilterRule>) => void;
  onRemove: (id: number) => void;
  onClear: () => void;
}

export default function ActiveFilters({ filters, resultCount, onAdd, onUpdate, onRemove, onClear }: Props) {
  return (
    <div className="mb-6 space-y-3 bg-zinc-50/40 dark:bg-zinc-950/40 p-4 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Active Filters</span>
        <button
          onClick={onAdd}
          className="px-2.5 py-1 text-xs bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 font-bold rounded-lg border border-indigo-500/20 cursor-pointer"
        >
          ➕ Add Filter
        </button>
      </div>

      {filters.length === 0 ? (
        <div className="text-xs text-zinc-600 dark:text-zinc-500 italic">
          Showing all estimates: <strong>{resultCount} estimates</strong>. Set filter rules to customize view.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Filtered queue</span>
            <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-extrabold text-sm tabular-nums">
              {resultCount} estimates
            </span>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-600">matching active KPI filters</span>
          </div>
          {filters.map((rule, idx) => (
            <div key={rule.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-zinc-600 dark:text-zinc-500 w-12 font-medium">
                {idx === 0 ? "Where" : "And"}
              </span>
              <select
                value={rule.field}
                onChange={(e) => onUpdate(rule.id, { field: e.target.value })}
                className="bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800 px-2 py-1 rounded-lg cursor-pointer"
              >
                <option value="satisfactory">Satisfactory (Qualified)</option>
                <option value="notAnswering">Not Answering</option>
                <option value="high_value">High Value (&gt; ₹80k)</option>
                <option value="movingSlow">Moving Slow</option>
                <option value="underDiscussion">Under Discussion</option>
                <option value="confirm">Confirm Expected</option>
                <option value="last_comment_within_5h">Last Comment within 5 Hours</option>
                <option value="last_comment_within_10h">Last Comment within 10 Hours</option>
                <option value="last_comment_older_5h">Last Comment older than 5 Hours</option>
              </select>

              <select
                value={rule.operator}
                onChange={(e) => onUpdate(rule.id, { operator: e.target.value as "is" | "is_not" })}
                className="bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800 px-2 py-1 rounded-lg cursor-pointer"
              >
                <option value="is">is</option>
                <option value="is_not">is not</option>
              </select>

              <span className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 px-2.5 py-1 rounded-lg font-medium">
                {rule.field === "satisfactory" ? "Satisfactory" : rule.field === "high_value" ? "High Value" : "Yes"}
              </span>

              <button
                onClick={() => onRemove(rule.id)}
                className="p-1 hover:text-rose-400 text-zinc-600 dark:text-zinc-500 transition-colors ml-auto bg-transparent border-0 cursor-pointer"
                title="Remove rule"
              >
                ❌
              </button>
            </div>
          ))}

          <button
            onClick={onClear}
            className="text-[11px] text-zinc-600 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-medium transition-colors text-left w-fit cursor-pointer bg-transparent border-0 mt-1"
          >
            Clear all filters (show default)
          </button>
        </div>
      )}
    </div>
  );
}