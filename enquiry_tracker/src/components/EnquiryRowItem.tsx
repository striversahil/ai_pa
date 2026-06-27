import React from "react";
import { Agent, Enquiry } from "../mockData";

interface EnquiryRowItemProps {
  enq: Enquiry;
  agent: Agent | undefined;
  onViewDetail: (id: string) => void;
}

export default function EnquiryRowItem({ enq, agent, onViewDetail }: EnquiryRowItemProps) {
  return (
    <div 
      className="p-4 border border-[var(--border-card)] rounded-lg hover:bg-[var(--bg-input)]/40 hover:border-brand-indigo/50 flex flex-col md:grid md:grid-cols-[2fr_1fr_1fr_1fr_auto] items-start md:items-center gap-3 md:gap-6 cursor-pointer transition-all duration-150 bg-[var(--bg-card)] shadow-xs" 
      onClick={() => onViewDetail(enq.id)}
    >
      <div className="min-w-0">
        <span className="block font-bold text-sm md:text-base truncate">{enq.title}</span>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-[var(--text-secondary)] font-semibold">{enq.clientCompany}</span>
          <span className="text-[var(--text-tertiary)] text-[10px]">•</span>
          <span className="text-[10px] text-[var(--text-tertiary)]">{new Date(enq.createdAt).toDateString()}</span>
        </div>
      </div>

      <div>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider
          ${enq.status === "new" ? "bg-[var(--bg-input)] text-[var(--text-secondary)]" : ""}
          ${enq.status === "contacted" ? "bg-indigo-500/10 text-brand-indigo" : ""}
          ${enq.status === "qualified" ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" : ""}
          ${enq.status === "proposal" ? "bg-purple-500/10 text-purple-600 dark:text-purple-400" : ""}
          ${enq.status === "negotiation" ? "bg-brand-amber/10 text-brand-amber" : ""}
          ${enq.status === "won" ? "bg-brand-emerald/10 text-brand-emerald" : ""}
          ${enq.status === "lost" ? "bg-brand-rose/10 text-brand-rose" : ""}
        `}>
          {enq.status}
        </span>
      </div>

      <div className="flex items-center gap-1 text-xs">
        <span className={`w-2 h-2 rounded-full 
          ${enq.priority === "high" ? "bg-brand-rose" : ""}
          ${enq.priority === "medium" ? "bg-brand-amber" : ""}
          ${enq.priority === "low" ? "bg-brand-emerald" : ""}
        `}></span>
        <span className="capitalize font-medium">{enq.priority}</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] text-white flex-shrink-0" style={{ backgroundColor: agent?.color }}>
          {agent?.initials || "UN"}
        </div>
        <span className="text-xs font-semibold">{agent?.name.split(" ")[0]}</span>
      </div>

      <div className="w-full md:w-auto text-left md:text-right font-heading font-extrabold text-sm md:text-base text-brand-indigo mt-1 md:mt-0">
        ₹{enq.estimatedValue.toLocaleString()}
      </div>
    </div>
  );
}
