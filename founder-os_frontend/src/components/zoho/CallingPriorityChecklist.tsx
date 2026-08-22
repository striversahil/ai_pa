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
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-md">
      <div className="border-b border-zinc-200 dark:border-zinc-800 pb-4 mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500/20 to-orange-500/20 border border-rose-500/30 text-sm">🚨</span>
            Calling Priority Checklist
          </h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-500 mt-1">Estimates requiring urgent calls or action items, ordered by Intent Score</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50/40 dark:bg-zinc-950/40 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 cursor-pointer hover:border-zinc-750 transition-colors">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={onToggleShowClosed}
              className="rounded bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-indigo-650 focus:ring-indigo-650"
            />
            <span>Show Closed Estimates</span>
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="p-6 md:p-8 bg-zinc-50/30 dark:bg-zinc-900/30 border border-zinc-200 dark:border-zinc-800 rounded-2xl animate-pulse space-y-4">
              <div className="flex justify-between items-center gap-4">
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-48 bg-zinc-100 dark:bg-zinc-800 rounded-md" />
                  <div className="h-3 w-64 bg-zinc-100/70 dark:bg-zinc-800/70 rounded-md" />
                </div>
                <div className="h-6 w-24 bg-zinc-100 dark:bg-zinc-800 rounded-full" />
              </div>
              <div className="h-3 w-full bg-zinc-100/50 dark:bg-zinc-800/50 rounded-md" />
              <div className="h-3 w-4/5 bg-zinc-100/50 dark:bg-zinc-800/50 rounded-md" />
              <div className="h-20 w-full bg-zinc-100/30 dark:bg-zinc-800/30 rounded-xl" />
            </div>
          ))}
        </div>
      ) : priorityList.length === 0 ? (
        <div className="text-center py-8 text-zinc-600 dark:text-zinc-500 text-sm">No priority calls flagged.</div>
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
            <div className="flex items-center justify-between border-t border-zinc-200 dark:border-zinc-800 pt-5 mt-4">
              <div className="text-xs text-zinc-600 dark:text-zinc-500">
                Showing <strong>{(currentPage - 1) * 100 + 1}-{Math.min(currentPage * 100, priorityList.length)}</strong> of <strong>{priorityList.length}</strong> estimates
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-100 dark:disabled:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-semibold rounded border border-zinc-300 dark:border-zinc-700 transition-colors cursor-pointer"
                >
                  ◀ Previous
                </button>
                <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-100 dark:disabled:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-semibold rounded border border-zinc-300 dark:border-zinc-700 transition-colors cursor-pointer"
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