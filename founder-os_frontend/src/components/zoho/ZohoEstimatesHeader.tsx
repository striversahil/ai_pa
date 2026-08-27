"use client";

import React from "react";

interface Props {
  lastSyncTimeStr: string | null;
  hasEstimates: boolean;
  hasPriority: boolean;
  copiedEstimates: boolean;
  copiedAnalytics: boolean;
  copiedPrompt: boolean;
  isPromptOpen: boolean;
  customPrompt: string;
  onCopyEstimates: () => void;
  onCopyAnalytics: () => void;
  onDownloadTXT: () => void;
  onCopyTSV: () => void;
  onCopyPrompt: () => void;
  onTogglePrompt: () => void;
  onResetPrompt: () => void;
  onPromptChange: (value: string) => void;
  onClosePrompt: () => void;
}

export default function ZohoEstimatesHeader({
  lastSyncTimeStr,
  hasEstimates,
  hasPriority,
  copiedEstimates,
  copiedAnalytics,
  copiedPrompt,
  isPromptOpen,
  customPrompt,
  onCopyEstimates,
  onCopyAnalytics,
  onDownloadTXT,
  onCopyTSV,
  onCopyPrompt,
  onTogglePrompt,
  onResetPrompt,
  onPromptChange,
  onClosePrompt,
}: Props) {
  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5">
      <div className="flex items-start gap-3">
        <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/30 shadow-lg shadow-indigo-500/10">
          <svg className="w-5 h-5 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17h6m-6-4h6m-6-4h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm0 8V5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2v-8z" /></svg>
        </div>
        <div>
          <h1 className="text-3xl font-bold font-heading tracking-tight">
            <span className="bg-gradient-to-r from-white via-indigo-100 to-indigo-400 bg-clip-text text-transparent">Zoho Sent Estimates</span>
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">AI classification of customer intent & follow-up efficiency from comment history</p>
          {lastSyncTimeStr && (
            <p className="text-xs text-zinc-600 dark:text-zinc-500 mt-1.5 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Last synced: <span className="font-semibold text-zinc-500 dark:text-zinc-400">{lastSyncTimeStr}</span>
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onCopyEstimates}
          disabled={!hasPriority}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 font-medium text-sm transition-all duration-200 cursor-pointer disabled:opacity-50"
        >
          <span>📄</span> {copiedEstimates ? "Copied Estimates!" : "Copy Category Estimates"}
        </button>
        <button
          onClick={onCopyAnalytics}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 font-medium text-sm transition-all duration-200 cursor-pointer"
        >
          <span>📊</span> {copiedAnalytics ? "Analytics Copied!" : "Copy Analytics"}
        </button>
        <button
          onClick={onDownloadTXT}
          disabled={!hasPriority}
          className="flex items-center justify-center px-3.5 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 font-medium text-sm transition-all duration-200 cursor-pointer disabled:opacity-50 border-0"
          title="Download Estimates as TXT"
        >
          <span>📥</span>
        </button>

        {/* Copy Prompt & Popover */}
        <div className="relative inline-flex items-center rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-750/90 transition-all duration-200 divide-x divide-zinc-300 dark:divide-zinc-700">
          <button
            onClick={onCopyPrompt}
            disabled={!hasPriority}
            className="flex items-center gap-2 px-4 py-2 rounded-l-lg text-zinc-900 dark:text-white font-medium text-sm border-0 bg-transparent cursor-pointer disabled:opacity-50"
          >
            <span>📝</span> {copiedPrompt ? "Copied Prompt!" : "Copy Prompt"}
          </button>
          <button
            onClick={onTogglePrompt}
            disabled={!hasPriority}
            className={`flex items-center justify-center px-3 py-2 rounded-r-lg text-sm border-0 bg-transparent cursor-pointer disabled:opacity-50 ${
              isPromptOpen ? "text-indigo-400 bg-zinc-200/50 dark:bg-zinc-700/50" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/30 dark:hover:bg-zinc-700/30"
            }`}
            title="Edit AI Prompt Template"
          >
            <span>⚙️</span>
          </button>

          {isPromptOpen && (
            <div className="absolute right-0 top-full mt-2 w-[90vw] max-w-lg sm:w-96 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl z-50 p-4 space-y-3">
              <div className="flex justify-between items-center border-b border-zinc-200 dark:border-zinc-800 pb-2">
                <span className="font-bold text-xs text-zinc-900 dark:text-white uppercase tracking-wider">Edit AI Prompt Template</span>
                <button
                  onClick={onResetPrompt}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 font-extrabold transition-all border-0 bg-transparent cursor-pointer"
                >
                  Reset to Default
                </button>
              </div>
              <textarea
                rows={10}
                value={customPrompt}
                onChange={(e) => onPromptChange(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-zinc-950 border border-[var(--border-card)] dark:border-zinc-700 rounded-lg p-2.5 text-xs text-zinc-700 dark:text-zinc-300 focus:outline-none focus:border-indigo-500 font-mono leading-relaxed resize-y"
                placeholder="Customize the prompt rules here..."
              />
              <div className="flex justify-end gap-2 pt-1 border-t border-[var(--border-card)] dark:border-zinc-700">
                <button
                  onClick={onClosePrompt}
                  className="px-3 py-1.5 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-[var(--bg-input)] dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-bold transition-all cursor-pointer border-0"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    onCopyPrompt();
                    onClosePrompt();
                  }}
                  className="text-white px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-bold transition-all cursor-pointer border-0"
                >
                  Save & Copy
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={onCopyTSV}
          disabled={!hasEstimates}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 font-medium text-sm transition-all duration-200 cursor-pointer disabled:opacity-50"
        >
          <span>📋</span> Copy TSV for Sheets
        </button>
      </div>
    </div>
  );
}