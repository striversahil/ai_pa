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
 const salesAgent = (c.salesAgent as string) || "Unassigned";
 const isAssigned = salesAgent !== "Unassigned";

 return (
 <div
 className="relative overflow-hidden p-6 md:p-8 bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl hover:border-black/15 dark:hover:border-white/15 hover:bg-black/[0.03] dark:hover:bg-white/5 hover:shadow-lg hover:shadow-black/20 transition-all space-y-4 shadow-sm"
 >
 <div className={`absolute left-0 top-6 bottom-6 w-1 rounded-r-full bg-gradient-to-b ${accentClass}`} />
 <div className="flex flex-wrap justify-between items-center gap-4 border-b border-[var(--border-card)] pb-4 pl-3">
 <div className="flex items-center gap-3 min-w-0">
 <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500/30 to-violet-500/30 border border-indigo-500/30 flex items-center justify-center text-sm font-bold text-indigo-200">
 {initials}
 </div>
 <div className="min-w-0">
 <span className="font-extrabold text-lg text-[var(--text-primary)] block tracking-tight truncate">{est.customerName}</span>
 <div className="text-xs text-[var(--text-tertiary)] mt-1 flex flex-wrap items-center gap-2">
 <span>Estimate No: <strong>{est.estimateNumber}</strong></span>
 <span>•</span>
 <span>Value: <strong className="text-indigo-600 dark:text-indigo-400">₹{est.total.toLocaleString()}</strong></span>
 <span>•</span>
 <span>Date: <strong>{est.date}</strong></span>
 </div>
 </div>
 </div>
 <div className="flex items-center gap-2">
 <span
 className={`text-xs font-bold px-3 py-1 rounded-full border ${isAssigned ? "bg-violet-500/10 text-violet-600 dark:text-violet-violet300 border-violet-500/30" : "bg-black/5 dark:bg-white/10 text-[var(--text-tertiary)] border-black/15 dark:border-white/15"}`}
 title="Sales agent identified from the latest Zoho comment"
 >
 👤 {salesAgent}
 </span>
 <span className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-md border ${getStatusBadgeClass(est.status)}`}>
 {est.status}
 </span>
 <span className={`text-xs font-bold px-3 py-1 rounded-full ${getIntentScoreBadgeClass(c.intentScore || 0)}`}>
 Intent Score: {c.intentScore}/10
 </span>
 <span
 className="text-xs font-bold px-3 py-1 rounded-full bg-black/5 dark:bg-white/10 text-[var(--text-secondary)] border border-black/15 dark:border-white/15"
 title="Comments received on this estimate today"
 >
 💬 {todayCount} today
 </span>
 </div>
 </div>

 {/* Chip warnings row */}
 <div className="flex flex-wrap gap-2 pt-1">
 {c.meaningfulUpdate ? (
 <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-emerald400 border border-emerald-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md">
 Meaningful Update
 </span>
 ) : (
 <span className="bg-rose-500/10 text-rose-600 dark:text-rose-rose400 border border-rose-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md">
 No Meaningful Update
 </span>
 )}
 {c.notAnswering === "Yes" && (
 <span className="bg-rose-500/10 text-rose-600 dark:text-rose-rose400 border border-rose-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md">
 Not Answering
 </span>
 )}
 {c.movingSlow === "Yes" && (
 <span className="bg-rose-500/10 text-rose-600 dark:text-rose-rose400 border border-rose-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md">
 Moving Slow (&gt;5d)
 </span>
 )}
 {c.underDiscussion === "Yes" && (
 <span className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md">
 Under Discussion
 </span>
 )}
 {c.confirm === "Yes" && (
 <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-emerald400 border border-emerald-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md animate-pulse">
 Confirmed
 </span>
 )}
 </div>

 {/* AI Timeline Summary */}
 {c.summary && (
 <div className="p-4 rounded-xl bg-black/5 dark:bg-black/25 border border-[var(--border-card)] text-sm leading-relaxed text-[var(--text-secondary)]">
 <strong className="text-[var(--text-primary)]">AI Timeline Summary:</strong> {c.summary}
 </div>
 )}

 {/* LLM Assessment card block */}
 <div className={`p-4 rounded-xl border text-sm leading-relaxed ${!c.meaningfulUpdate ? 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-rose300' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-emerald300'}`}>
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