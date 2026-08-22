"use client";

import React from "react";
import type { Movement } from "./types";

interface Props {
 baselineCount: number;
 baselineValue: number;
 baselineDate: string;
 movement: Movement;
}

export default function DailyMovementTracker({ baselineCount, baselineValue, baselineDate, movement }: Props) {
 return (
 <div className="bg-black/5 dark:bg-black/25 border border-[var(--border-card)] rounded-xl p-4 space-y-4 mb-6">
 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-[var(--border-card)] pb-3">
 <div>
 <h4 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
 <span>📈</span> Daily Status Movement Tracker
 </h4>
 <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
 Baseline captured: <span className="font-semibold text-[var(--text-tertiary)]">{baselineDate}</span> ({baselineCount} open, value: ₹{baselineValue.toLocaleString()}) — auto-frozen at 9:00 AM IST
 </p>
 </div>
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 <div className="bg-[var(--bg-card)] border border-[var(--border-card)] p-2.5 rounded-lg text-center">
 <span className="text-[9px] text-[var(--text-tertiary)] font-bold uppercase tracking-wider block">Baseline Open</span>
 <span className="text-base font-bold text-[var(--text-secondary)] font-mono mt-0.5 block">{baselineCount}</span>
 </div>
 <div className="bg-emerald-950/10 border border-emerald-900/20 p-2.5 rounded-lg text-center">
 <span className="text-[9px] text-emerald-600 dark:text-emerald-emerald500 font-bold uppercase tracking-wider block">Accepted Today</span>
 <span className="text-base font-bold text-emerald-600 dark:text-emerald-emerald400 font-mono mt-0.5 block">
 {movement.accepted.length} <span className="text-[10px] text-[var(--text-tertiary)]">(₹{movement.accepted.reduce((sum: number, x: any) => sum + x.total, 0).toLocaleString()})</span>
 </span>
 </div>
 <div className="bg-rose-950/10 border border-rose-900/20 p-2.5 rounded-lg text-center">
 <span className="text-[9px] text-rose-600 dark:text-rose-rose500 font-bold uppercase tracking-wider block">Declined Today</span>
 <span className="text-base font-bold text-rose-600 dark:text-rose-rose400 font-mono mt-0.5 block">
 {movement.declined.length} <span className="text-[10px] text-[var(--text-tertiary)]">(₹{movement.declined.reduce((sum: number, x: any) => sum + x.total, 0).toLocaleString()})</span>
 </span>
 </div>
 <div className="bg-indigo-950/10 border border-indigo-900/20 p-2.5 rounded-lg text-center">
 <span className="text-[9px] text-indigo-600 dark:text-indigo-indigo500 font-bold uppercase tracking-wider block">New Estimates</span>
 <span className="text-base font-bold text-indigo-600 dark:text-indigo-400 font-mono mt-0.5 block">
 {movement.newCreated.length} <span className="text-[10px] text-[var(--text-tertiary)]">(₹{movement.newCreated.reduce((sum: number, x: any) => sum + x.total, 0).toLocaleString()})</span>
 </span>
 </div>
 </div>

 <div className="bg-black/5 dark:bg-black/25 border border-[var(--border-card)] p-3 rounded-xl">
 <span className="text-[9px] text-[var(--text-tertiary)] font-bold uppercase tracking-wider block mb-1.5">Today's Timeline Feed</span>

 {movement.accepted.length === 0 && movement.declined.length === 0 && movement.newCreated.length === 0 ? (
 <div className="text-xs text-[var(--text-tertiary)] italic py-2 text-center">
 No status transitions or new estimates detected today. Estimates auto-sync every 15 minutes.
 </div>
 ) : (
 <div className="space-y-2 max-h-36 overflow-y-auto divide-y divide-[var(--border-card)] pr-1 scrollbar-thin">
 {[...movement.accepted.map((est) => ({ est, kind: "accepted" as const })), ...movement.declined.map((est) => ({ est, kind: "declined" as const })), ...movement.newCreated.map((est) => ({ est, kind: "new" as const }))].map(({ est, kind }) => {
 const c = est.classification || {};
 const badge =
 kind === "accepted"
 ? { text: "Accepted", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-emerald400 border-emerald-500/20" }
 : kind === "declined"
 ? { text: "Declined", cls: "bg-rose-500/10 text-rose-600 dark:text-rose-rose400 border-rose-500/20" }
 : { text: "New Created", cls: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20" };
 return (
 <div key={est.estimateId} className="py-2 border-b border-[var(--border-card)] text-[11px] space-y-1 text-left">
 <div className="flex items-center gap-2">
 <span className={`px-1.5 py-0.5 text-[8px] rounded font-extrabold uppercase tracking-wide border ${badge.cls}`}>{badge.text}</span>
 <span className="text-[var(--text-tertiary)] font-mono font-bold">{est.estimateNumber}</span>
 <span className="text-[var(--text-primary)] font-semibold truncate max-w-[180px]">{est.customerName}</span>
 <span className="text-[var(--text-tertiary)] font-mono ml-auto">₹{est.total.toLocaleString()}</span>
 </div>
 {c.summary && (
 <div className="text-[10px] text-[var(--text-tertiary)] pl-4 italic leading-relaxed">
 <strong>AI Summary:</strong> {c.summary}
 </div>
 )}
 {c.reasoning && (
 <div className="text-[10px] text-[var(--text-tertiary)] pl-4 leading-relaxed">
 <strong>LLM Analysis:</strong> {c.reasoning}
 </div>
 )}
 </div>
 );
 })}
 </div>
 )}
 </div>
 </div>
 );
}