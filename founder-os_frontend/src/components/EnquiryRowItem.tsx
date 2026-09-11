import React from "react";
import { Agent, Enquiry, enquiryLabel } from "../mockData";
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
  const flagged = items.some((it) => it.specIssue);
  return (
    <div
      className="flex cursor-pointer flex-col items-start gap-3 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4 shadow-[var(--shadow-card)] transition-all duration-150 hover:border-[var(--color-brand-indigo)]/50 hover:bg-[var(--bg-input)]/40 md:grid md:grid-cols-[2fr_1fr_1fr_1fr_auto] md:items-center md:gap-6"
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
          {!hideIdentity && (
            <span className={`px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap ${
              flagged
                ? "bg-red-500/10 text-red-500 border-red-500/30"
                : finalized
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                : hasRates
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                  : "bg-zinc-500/10 text-zinc-500 border-zinc-500/30"
            }`}>
              {flagged ? "Fix Spec" : finalized ? "Rates Ready" : hasRates ? "Rating…" : "Awaiting rates"}
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
