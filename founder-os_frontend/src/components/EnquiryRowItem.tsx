import React from "react";
import { Agent, Enquiry, enquiryLabel } from "../types";
import { StatusBadge, PriorityBadge } from "./ui";

interface EnquiryRowItemProps {
  enq: Enquiry;
  agent: Agent | undefined;
  hideIdentity?: boolean;
  onViewDetail: (id: string) => void;
}

export default function EnquiryRowItem({ enq, agent, hideIdentity = false, onViewDetail }: EnquiryRowItemProps) {
  const items = enq.items ?? [];
  const hasRates = items.some((it) => (it.rates ?? []).length > 0);
  const finalized = (enq.rateStatus ?? "") === "finalized";
  const sent = (enq.rateStatus ?? "") === "sent";
  const flagged = items.some((it) => it.specIssue);
  // Management-decided items on an open enquiry = partial rates received
  // (per-enquiry tag; the per-item rates live in the detail view).
  const hasPartialRates = !finalized && !sent && items.some((it) => it.finalRate !== undefined && it.finalRate !== null);
  // Overdue: not sent and older than 24h → red, darkening with hours overdue
  const createdMs = enq.createdAt ? new Date(enq.createdAt).getTime() : 0;
  const hoursOverdue = !sent && createdMs ? Math.floor((Date.now() - createdMs) / 3600000) : 0;
  const isOverdue = !sent && hoursOverdue >= 24;
  const overdueLevel = isOverdue ? Math.min(3, Math.floor((hoursOverdue - 24) / 24)) : -1; // 0:24-48,1:48-72,2:72-96,3:96+
  const overdueLabel = isOverdue ? (hoursOverdue >= 48 ? `${Math.floor(hoursOverdue/24)}d overdue` : `${hoursOverdue}h overdue`) : null;
  const overdueCardClass = overdueLevel === -1 ? "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
    : overdueLevel === 0 ? "border-red-200 dark:border-red-900/50 bg-red-50/70 dark:bg-red-950/20"
    : overdueLevel === 1 ? "border-red-300 dark:border-red-800/60 bg-red-50 dark:bg-red-900/30"
    : overdueLevel === 2 ? "border-red-400 dark:border-red-700 bg-red-100/80 dark:bg-red-900/40"
    : "border-red-600 dark:border-red-700 bg-red-100 dark:bg-red-900/50";
  const overdueAccent = overdueLevel === -1 ? "" 
    : overdueLevel === 0 ? "border-l-red-400" 
    : overdueLevel === 1 ? "border-l-red-500" 
    : overdueLevel === 2 ? "border-l-red-600" 
    : "border-l-red-700";
  return (
    <div
      className={`group flex cursor-pointer flex-col items-start gap-3 rounded-2xl border p-4 shadow-sm hover:shadow-md transition-all duration-150 hover:border-indigo-200 dark:hover:border-indigo-800 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/40 md:grid md:grid-cols-[2fr_1fr_1fr_1fr_auto] md:items-center md:gap-6 border-l-4 ${overdueCardClass} ${overdueAccent || "border-l-zinc-200 dark:border-l-zinc-800"}`}
      onClick={() => onViewDetail(enq.id)}
    >
      <div className="min-w-0">
        <span className="block truncate font-bold text-sm md:text-base text-[var(--text-primary)]">{enq.title || enq.estNumber || "—"}</span>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onViewDetail(enq.id); }}
            className="text-[10px] font-extrabold text-[var(--color-brand-indigo)] hover:underline cursor-pointer bg-transparent border-0 p-0"
          >
            {enquiryLabel(enq)}
          </button>
          <span className="text-[10px] text-[var(--text-tertiary)]">•</span>
          {!hideIdentity && (
            <>
              <span className="text-xs font-semibold text-[var(--text-secondary)]">{enq.clientCompany}</span>
              <span className="text-[10px] text-[var(--text-tertiary)]">•</span>
              <span className="text-[10px] font-mono text-[var(--color-brand-indigo)]">{enq.estNumber || "—"}</span>
              <span className="text-[10px] text-[var(--text-tertiary)]">•</span>
            </>
          )}
          <span className="text-[10px] text-[var(--text-tertiary)]">{enq.createdAt ? new Date(enq.createdAt).toDateString() : ""}</span>
          {isOverdue && overdueLabel && (
            <span className={`px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap ${
              overdueLevel === 3 ? "bg-red-700 text-white border-red-700" : overdueLevel === 2 ? "bg-red-600 text-white border-red-600" : overdueLevel === 1 ? "bg-red-500 text-white border-red-500" : "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40"
            }`}>{overdueLabel}</span>
          )}
          {!hideIdentity && (
            <span className={`px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap ${
              flagged
                ? "bg-red-500/10 text-red-500 border-red-500/30"
                : sent
                ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30"
                : finalized
                 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                : hasPartialRates || hasRates
                   ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                   : "bg-zinc-500/10 text-zinc-500 border-zinc-500/30"
             }`}>
              {flagged ? "Fix Spec" : sent ? "Marked as Sent" : finalized ? "Rates Ready" : hasPartialRates ? "Partial rates" : hasRates ? "Rating…" : "Awaiting rates"}
            </span>
          )}
        </div>
      </div>

      {!hideIdentity && (
        <div>
          <StatusBadge status={enq.status} />
        </div>
      )}

      <div>
        <PriorityBadge priority={enq.priority} />
      </div>

      {!hideIdentity && (
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: agent?.color }}>
            {agent?.initials || "UN"}
          </div>
          <span className="text-xs font-semibold text-[var(--text-secondary)]">{agent?.name.split(" ")[0]}</span>
        </div>
      )}
    </div>
  );
}
