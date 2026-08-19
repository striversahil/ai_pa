"use client";

import React from "react";
import CommentsTimeline from "./CommentsTimeline";
import type { Estimate } from "./types";
import { getEstimateAccentClass, getInitials, getIntentScoreBadgeClass, getStatusBadgeClass, getTodayDateString, getCommentCountForDate } from "./utils";

interface Props {
  est: Estimate;
  expanded: boolean;
  onToggleComments: (estimateId: string) => void;
}

export default function EstimateCard({ est, expanded, onToggleComments }: Props) {
  const c = est.classification || {};
  const accentClass = getEstimateAccentClass(est);
  const initials = getInitials(est.customerName);
  const todayCount = getCommentCountForDate(est, getTodayDateString());

  return (
    <div
      className="relative overflow-hidden p-6 md:p-8 bg-zinc-900/30 border border-zinc-800 rounded-2xl hover:border-zinc-700/80 hover:bg-zinc-900/50 hover:shadow-lg hover:shadow-black/20 transition-all space-y-4 shadow-sm"
    >
      <div className={`absolute left-0 top-6 bottom-6 w-1 rounded-r-full bg-gradient-to-b ${accentClass}`} />
      <div className="flex flex-wrap justify-between items-center gap-4 border-b border-zinc-800/60 pb-4 pl-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500/30 to-violet-500/30 border border-indigo-500/30 flex items-center justify-center text-sm font-bold text-indigo-200">
            {initials}
          </div>
          <div className="min-w-0">
            <span className="font-extrabold text-lg text-zinc-100 block tracking-tight truncate">{est.customerName}</span>
            <div className="text-xs text-zinc-400 mt-1 flex flex-wrap items-center gap-2">
              <span>Estimate No: <strong>{est.estimateNumber}</strong></span>
              <span>•</span>
              <span>Value: <strong className="text-indigo-400">₹{est.total.toLocaleString()}</strong></span>
              <span>•</span>
              <span>Date: <strong>{est.date}</strong></span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-md border ${getStatusBadgeClass(est.status)}`}>
            {est.status}
          </span>
          <span className={`text-xs font-bold px-3 py-1 rounded-full ${getIntentScoreBadgeClass(c.intentScore || 0)}`}>
            Intent Score: {c.intentScore}/10
          </span>
          <span
            className="text-xs font-bold px-3 py-1 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700"
            title="Comments received on this estimate today"
          >
            💬 {todayCount} today
          </span>
        </div>
      </div>

      {/* Chip warnings row */}
      <div className="flex flex-wrap gap-2 pt-1">
        {c.meaningfulUpdate ? (
          <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md">
            Meaningful Update
          </span>
        ) : (
          <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md">
            No Meaningful Update
          </span>
        )}
        {c.notAnswering === "Yes" && (
          <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md">
            Not Answering
          </span>
        )}
        {c.movingSlow === "Yes" && (
          <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md">
            Moving Slow (&gt;5d)
          </span>
        )}
        {c.underDiscussion === "Yes" && (
          <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md">
            Under Discussion
          </span>
        )}
        {c.confirm === "Yes" && (
          <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md animate-pulse">
            Confirmed
          </span>
        )}
      </div>

      {/* AI Timeline Summary */}
      {c.summary && (
        <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-800/80 text-sm leading-relaxed text-zinc-300">
          <strong className="text-zinc-200">AI Timeline Summary:</strong> {c.summary}
        </div>
      )}

      {/* LLM Assessment card block */}
      <div className={`p-4 rounded-xl border text-sm leading-relaxed ${!c.meaningfulUpdate ? 'bg-rose-500/10 border-rose-500/20 text-rose-300' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'}`}>
        <strong>LLM Audit Assessment:</strong> {c.reasoning || "No details provided."}
      </div>

      {/* Comments History / Timeline section */}
      <CommentsTimeline
        comments={est.comments || []}
        expanded={expanded}
        onToggle={() => onToggleComments(est.estimateId)}
      />
    </div>
  );
}