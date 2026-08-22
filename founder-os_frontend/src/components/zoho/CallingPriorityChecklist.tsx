"use client";

import React from "react";
import EstimateCard from "./EstimateCard";
import type { Estimate } from "./types";

interface Props {
 isLoading: boolean;
 priorityList: Estimate[];
 showClosed: boolean;
 currentPage: number;
 expandedCards: Record<string, boolean>;
 onToggleShowClosed: () => void;
 onToggleComments: (estimateId: string) => void;
 onPageChange: (page: number) => void;
}

export default function CallingPriorityChecklist({
 isLoading,
 priorityList,
 showClosed,
 currentPage,
 expandedCards,
 onToggleShowClosed,
 onToggleComments,
 onPageChange,
}: Props) {
 const totalPages = Math.ceil(priorityList.length / 100);
 const pagedItems = showClosed
 ? priorityList.slice((currentPage - 1) * 100, currentPage * 100)
 : priorityList;

 return (
 <section className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl p-6 shadow-md">
 <div className="border-b border-[var(--border-card)] pb-4 mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
 <div>
 <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
 <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500/20 to-orange-500/20 border border-rose-500/30 text-sm">🚨</span>
 Calling Priority Checklist
 </h3>
 <p className="text-xs text-[var(--text-tertiary)] mt-1">Estimates requiring urgent calls or action items, ordered by Intent Score</p>
 </div>
 <div className="flex items-center gap-3">
 <label className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] bg-black/5 dark:bg-black/25 px-3 py-1.5 rounded-lg border border-[var(--border-card)] cursor-pointer hover:border-zinc-750 transition-colors">
 <input
 type="checkbox"
 checked={showClosed}
 onChange={onToggleShowClosed}
 className="rounded bg-[var(--bg-card)] border-[var(--border-card)] text-indigo-650 focus:ring-indigo-650"
 />
 <span>Show Closed Estimates</span>
 </label>
 </div>
 </div>

 {isLoading ? (
 <div className="space-y-6">
 {[0, 1, 2].map((i) => (
 <div key={i} className="p-6 md:p-8 bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl animate-pulse space-y-4">
 <div className="flex justify-between items-center gap-4">
 <div className="space-y-2 flex-1">
 <div className="h-4 w-48 bg-black/5 dark:bg-white/10 rounded-md" />
 <div className="h-3 w-64 bg-black/5 dark:bg-white/10 rounded-md" />
 </div>
 <div className="h-6 w-24 bg-black/5 dark:bg-white/10 rounded-full" />
 </div>
 <div className="h-3 w-full bg-black/5 dark:bg-white/10 rounded-md" />
 <div className="h-3 w-4/5 bg-black/5 dark:bg-white/10 rounded-md" />
 <div className="h-20 w-full bg-black/5 dark:bg-white/10 rounded-xl" />
 </div>
 ))}
 </div>
 ) : priorityList.length === 0 ? (
 <div className="text-center py-8 text-[var(--text-tertiary)] text-sm">No priority calls flagged.</div>
 ) : (
 <div className="space-y-6 max-h-[900px] overflow-y-auto pr-2 scrollbar-thin">
 {pagedItems.map((e) => (
 <EstimateCard
 key={e.estimateId}
 est={e}
 expanded={!!expandedCards[e.estimateId]}
 onToggleComments={onToggleComments}
 />
 ))}

 {showClosed && priorityList.length > 100 && (
 <div className="flex items-center justify-between border-t border-[var(--border-card)] pt-5 mt-4">
 <div className="text-xs text-[var(--text-tertiary)]">
 Showing <strong>{(currentPage - 1) * 100 + 1}-{Math.min(currentPage * 100, priorityList.length)}</strong> of <strong>{priorityList.length}</strong> estimates
 </div>
 <div className="flex items-center gap-2">
 <button
 onClick={() => onPageChange(Math.max(1, currentPage - 1))}
 disabled={currentPage === 1}
 className="px-3 py-1.5 text-xs bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-black/5 dark:disabled:hover:bg-white/10 text-[var(--text-secondary)] font-semibold rounded border border-black/15 dark:border-white/15 transition-colors cursor-pointer"
 >
 ◀ Previous
 </button>
 <span className="text-xs font-mono text-[var(--text-tertiary)]">
 Page {currentPage} of {totalPages}
 </span>
 <button
 onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
 disabled={currentPage === totalPages}
 className="px-3 py-1.5 text-xs bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-black/5 dark:disabled:hover:bg-white/10 text-[var(--text-secondary)] font-semibold rounded border border-black/15 dark:border-white/15 transition-colors cursor-pointer"
 >
 Next ▶
 </button>
 </div>
 </div>
 )}
 </div>
 )}
 </section>
 );
}