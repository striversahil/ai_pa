"use client";

import React from "react";
import {
  FileText,
  Copy,
  BarChart2,
  Download,
  Settings,
  FileSpreadsheet,
  Check,
  RotateCcw,
  X,
  Sparkles,
} from "lucide-react";

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
    <div className="relative z-40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-5">
      <div className="flex items-start gap-3">
        <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/30 text-indigo-400 shadow-lg shadow-indigo-500/10">
          <FileText className="w-5 h-5 stroke-[2]" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white flex items-center gap-2">
            <span>Zoho Sent Estimates</span>
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              AI Analytics
            </span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            AI classification of customer intent &amp; follow-up efficiency from comment history
          </p>
          {lastSyncTimeStr && (
            <p className="text-[11px] text-zinc-400 mt-1.5 flex items-center gap-1.5 font-medium">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Last synced: <span className="font-semibold text-zinc-300">{lastSyncTimeStr}</span>
            </p>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onCopyEstimates}
          disabled={!hasPriority}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-200 transition-all active:scale-95 disabled:opacity-40"
        >
          {copiedEstimates ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-indigo-400" />}
          <span>{copiedEstimates ? "Copied Estimates!" : "Copy Category Estimates"}</span>
        </button>

        <button
          onClick={onCopyAnalytics}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-200 transition-all active:scale-95"
        >
          {copiedAnalytics ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <BarChart2 className="w-3.5 h-3.5 text-indigo-400" />}
          <span>{copiedAnalytics ? "Analytics Copied!" : "Copy Analytics"}</span>
        </button>

        <button
          onClick={onDownloadTXT}
          disabled={!hasPriority}
          className="flex items-center justify-center p-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-zinc-300 transition-all disabled:opacity-40"
          title="Download Estimates as TXT"
        >
          <Download className="w-4 h-4" />
        </button>

        {/* Copy Prompt & Settings */}
        <div className="relative inline-flex items-center rounded-xl border border-white/10 bg-white/5 backdrop-blur-md">
          <button
            onClick={onCopyPrompt}
            disabled={!hasPriority}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10 rounded-l-xl transition-all disabled:opacity-40"
          >
            {copiedPrompt ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Sparkles className="w-3.5 h-3.5 text-indigo-400" />}
            <span>{copiedPrompt ? "Copied Prompt!" : "Copy Prompt"}</span>
          </button>
          <button
            onClick={onTogglePrompt}
            disabled={!hasPriority}
            className={`p-2 rounded-r-xl border-l border-white/10 transition-all ${
              isPromptOpen ? "text-indigo-400 bg-white/15" : "text-zinc-400 hover:text-white hover:bg-white/10"
            }`}
            title="Edit AI Prompt Template"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          {isPromptOpen && (
            <div className="absolute right-0 top-full mt-2 w-[90vw] max-w-lg sm:w-96 rounded-3xl border border-white/10 bg-[#111726]/95 p-4 shadow-2xl backdrop-blur-2xl animate-scale-up z-50 space-y-3">
              <div className="flex justify-between items-center border-b border-white/10 pb-2.5">
                <span className="font-bold text-xs text-white uppercase tracking-wider">
                  Edit AI Prompt Template
                </span>
                <button
                  onClick={onResetPrompt}
                  className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-bold transition-all"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Default</span>
                </button>
              </div>
              <textarea
                rows={9}
                value={customPrompt}
                onChange={(e) => onPromptChange(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 font-mono leading-relaxed resize-y"
                placeholder="Customize the prompt rules here..."
              />
              <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  onClick={onClosePrompt}
                  className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-all"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    onCopyPrompt();
                    onClosePrompt();
                  }}
                  className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-all"
                >
                  Save &amp; Copy
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={onCopyTSV}
          disabled={!hasEstimates}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-200 transition-all active:scale-95 disabled:opacity-40"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
          <span>Copy TSV</span>
        </button>
      </div>
    </div>
  );
}