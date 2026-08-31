import React from "react";
import { Agent, Enquiry } from "../mockData";
import { StatusBadge, PriorityBadge } from "./ui";

interface EnquiryRowItemProps {
  enq: Enquiry;
  agent: Agent | undefined;
  onViewDetail: (id: string) => void;
}

export default function EnquiryRowItem({ enq, agent, onViewDetail }: EnquiryRowItemProps) {
  return (
    <div
      className="flex cursor-pointer flex-col items-start gap-3 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4 shadow-[var(--shadow-card)] transition-all duration-150 hover:border-[var(--color-brand-indigo)]/50 hover:bg-[var(--bg-input)]/40 md:grid md:grid-cols-[2fr_1fr_1fr_1fr_auto] md:items-center md:gap-6"
      onClick={() => onViewDetail(enq.id)}
    >
      <div className="min-w-0">
        <span className="block truncate font-bold text-sm md:text-base text-[var(--text-primary)]">{enq.title}</span>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--text-secondary)]">{enq.clientCompany}</span>
          <span className="text-[10px] text-[var(--text-tertiary)]">•</span>
          <span className="text-[10px] font-mono text-[var(--color-brand-indigo)]">{enq.estNumber || "—"}</span>
          <span className="text-[10px] text-[var(--text-tertiary)]">•</span>
          <span className="text-[10px] text-[var(--text-tertiary)]">{new Date(enq.createdAt).toDateString()}</span>
        </div>
      </div>

      <div>
        <StatusBadge status={enq.status} />
      </div>

      <div>
        <PriorityBadge priority={enq.priority} />
      </div>

      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: agent?.color }}>
          {agent?.initials || "UN"}
        </div>
        <span className="text-xs font-semibold text-[var(--text-secondary)]">{agent?.name.split(" ")[0]}</span>
      </div>
    </div>
  );
}
