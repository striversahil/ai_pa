"use client";

import React from "react";
import type { FilterRule } from "./types";

interface Props {
 filters: FilterRule[];
 counts: Record<string, number>;
 resultCount: number;
 onAdd: () => void;
 onUpdate: (id: number, patch: Partial<FilterRule>) => void;
 onRemove: (id: number) => void;
 onClear: () => void;
}

export default function ActiveFilters({ filters, counts, resultCount, onAdd, onUpdate, onRemove, onClear }: Props) {
 return (
 <div className="mb-6 space-y-3 bg-black/5 dark:bg-black/25 p-4 border border-[var(--border-card)] rounded-xl">
 <div className="flex items-center justify-between">
 <span className="text-xs font-semibold text-[var(--text-tertiary)]">Active Filters</span>
 <button
 onClick={onAdd}
 className="px-2.5 py-1 text-xs bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 font-bold rounded-lg border border-indigo-500/20 cursor-pointer"
 >
 ➕ Add Filter
 </button>
 </div>

 {filters.length === 0 ? (
 <div className="text-xs text-[var(--text-tertiary)] italic">
 Showing all estimates: <strong>{resultCount} estimates</strong>. Set filter rules to customize view.
 </div>
 ) : (
 <div className="flex flex-col gap-2">
 <div className="text-xs text-[var(--text-tertiary)] mb-1">
 Showing filtered queue: <strong>{resultCount} estimates</strong>
 </div>
 {filters.map((rule, idx) => (
 <div key={rule.id} className="flex flex-wrap items-center gap-2 text-xs">
 <span className="text-[var(--text-tertiary)] w-12 font-medium">
 {idx === 0 ? "Where" : "And"}
 </span>
 <select
 value={rule.field}
 onChange={(e) => onUpdate(rule.id, { field: e.target.value })}
 className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-card)] px-2 py-1 rounded-lg cursor-pointer"
 >
 <option value="satisfactory">Satisfactory (Qualified) ({counts.satisfactory})</option>
 <option value="notAnswering">Not Answering ({counts.notAnswering})</option>
 <option value="high_value">High Value (&gt; ₹80k) ({counts.high_value})</option>
 <option value="movingSlow">Moving Slow ({counts.movingSlow})</option>
 <option value="underDiscussion">Under Discussion ({counts.underDiscussion})</option>
 <option value="confirm">Confirm Expected ({counts.confirm})</option>
 <option value="last_comment_within_5h">Last Comment within 5 Hours ({counts.last_comment_within_5h})</option>
 <option value="last_comment_within_10h">Last Comment within 10 Hours ({counts.last_comment_within_10h})</option>
 <option value="last_comment_older_5h">Last Comment older than 5 Hours ({counts.last_comment_older_5h})</option>
 </select>

 <select
 value={rule.operator}
 onChange={(e) => onUpdate(rule.id, { operator: e.target.value as "is" | "is_not" })}
 className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-card)] px-2 py-1 rounded-lg cursor-pointer"
 >
 <option value="is">is</option>
 <option value="is_not">is not</option>
 </select>

 <span className="bg-[var(--bg-card)] border border-[var(--border-card)] text-[var(--text-secondary)] px-2.5 py-1 rounded-lg font-medium">
 {rule.field === "satisfactory" ? "Satisfactory" : rule.field === "high_value" ? "High Value" : "Yes"}
 </span>

 <button
 onClick={() => onRemove(rule.id)}
 className="p-1 hover:text-rose-600 dark:hover:text-rose-rose400 text-[var(--text-tertiary)] transition-colors ml-auto bg-transparent border-0 cursor-pointer"
 title="Remove rule"
 >
 ❌
 </button>
 </div>
 ))}

 <button
 onClick={onClear}
 className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] font-medium transition-colors text-left w-fit cursor-pointer bg-transparent border-0 mt-1"
 >
 Clear all filters (show default)
 </button>
 </div>
 )}
 </div>
 );
}