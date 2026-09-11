"use client";

import React, { useMemo, useState } from "react";
import { Agent, Enquiry } from "../mockData";

interface EnquiryKanbanProps {
  enquiries: Enquiry[];
  agents: Agent[];
  redacted?: boolean;
  onViewDetail: (enquiryId: string) => void;
  onUpdateStatus: (id: string, status: Enquiry["status"]) => void;
}

const SALES_COLUMNS: Array<{ key: Enquiry["status"]; label: string }> = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "qualified", label: "Qualified" },
  { key: "proposal", label: "Proposal" },
  { key: "negotiation", label: "Negotiation" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

const PROC_COLUMNS: Array<{ key: string; label: string }> = [
  { key: "high", label: "High priority" },
  { key: "medium", label: "Medium priority" },
  { key: "low", label: "Low priority" },
];

const PRIORITY_STYLE: Record<string, string> = {
  high: "bg-red-500/10 text-red-600 dark:text-red-400",
  medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  low: "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400",
};

function ageDays(createdAt: string): number | null {
  if (!createdAt) return null;
  const ms = Date.now() - new Date(createdAt).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function ageStyle(days: number | null): string {
  if (days === null) return "bg-zinc-500/10 text-zinc-500";
  if (days > 14) return "bg-red-500/10 text-red-600 dark:text-red-400";
  if (days > 7) return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400";
}

// Pipeline board. Sales groups by status with HTML5 drag-and-drop between
// columns; procurement (status hidden by the API) groups by priority,
// read-only. Cards open the detail view on click.
export default function EnquiryKanban({ enquiries, agents, redacted = false, onViewDetail, onUpdateStatus }: EnquiryKanbanProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<string | null>(null);

  const agentName = useMemo(() => {
    const map = new Map(agents.map((a) => [String(a.id), a.name]));
    return (id: string) => map.get(String(id)) || "";
  }, [agents]);

  const columns = useMemo(() => {
    if (redacted) {
      return PROC_COLUMNS.map((c) => ({
        key: c.key,
        label: c.label,
        cards: enquiries.filter((e) => (e.priority || "medium") === c.key),
      }));
    }
    return SALES_COLUMNS.map((c) => ({
      key: c.key,
      label: c.label,
      cards: enquiries.filter((e) => (e.status || "new") === c.key),
    }));
  }, [enquiries, redacted]);

  const handleDrop = (colKey: string) => {
    setDropCol(null);
    if (redacted || !dragId) {
      setDragId(null);
      return;
    }
    const card = enquiries.find((e) => e.id === dragId);
    setDragId(null);
    if (!card || card.status === colKey) return;
    onUpdateStatus(card.id, colKey as Enquiry["status"]);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 items-start">
      {columns.map((col) => (
        <div
          key={col.key}
          onDragOver={redacted ? undefined : (e) => { e.preventDefault(); setDropCol(col.key); }}
          onDragLeave={() => setDropCol(null)}
          onDrop={redacted ? undefined : (e) => { e.preventDefault(); handleDrop(col.key); }}
          className={`w-64 flex-shrink-0 rounded-2xl border p-2.5 transition-colors ${
            dropCol === col.key
              ? "border-brand-indigo bg-brand-indigo/5"
              : "border-[var(--border-card)] bg-[var(--bg-card)]"
          }`}
        >
          <div className="flex items-center justify-between px-1.5 pb-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-secondary)]">{col.label}</span>
            <span className="text-[11px] font-bold text-[var(--text-tertiary)] bg-[var(--bg-input)] rounded-full px-2 py-0.5">{col.cards.length}</span>
          </div>
          <div className="space-y-2 max-h-[65vh] overflow-y-auto">
            {col.cards.map((e) => {
              const days = ageDays(e.createdAt);
              const items = Array.isArray(e.items) ? e.items.length : 0;
              return (
                <div
                  key={e.id}
                  draggable={!redacted}
                  onDragStart={() => setDragId(e.id)}
                  onDragEnd={() => { setDragId(null); setDropCol(null); }}
                  onClick={() => onViewDetail(e.id)}
                  className={`rounded-xl border border-[var(--border-card)] bg-[var(--bg-input)]/30 p-3 cursor-pointer hover:border-brand-indigo/50 transition-all ${
                    dragId === e.id ? "opacity-40" : ""
                  }`}
                >
                  {!redacted && e.estNumber && (
                    <div className="text-[10px] font-mono font-bold text-[var(--text-tertiary)]">{e.estNumber}</div>
                  )}
                  <div className="text-sm font-bold text-[var(--text-primary)] leading-snug line-clamp-2">
                    {e.title || "(untitled enquiry)"}
                  </div>
                  {!redacted && e.clientCompany && (
                    <div className="text-[11px] font-semibold text-[var(--text-secondary)] truncate mt-0.5">{e.clientCompany}</div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${PRIORITY_STYLE[e.priority] || PRIORITY_STYLE.medium}`}>
                      {(e.priority || "medium").toUpperCase()}
                    </span>
                    {items > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                        {items} item{items === 1 ? "" : "s"}
                      </span>
                    )}
                    {days !== null && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${ageStyle(days)}`}>
                        {days === 0 ? "today" : `${days}d`}
                      </span>
                    )}
                  </div>
                  {!redacted && agentName(e.assignedAgentId) && (
                    <div className="text-[10px] font-semibold text-[var(--text-tertiary)] mt-1.5 truncate">
                      {agentName(e.assignedAgentId)}
                    </div>
                  )}
                </div>
              );
            })}
            {col.cards.length === 0 && (
              <p className="text-[11px] text-[var(--text-tertiary)] text-center py-4">
                {redacted ? "Nothing here" : "Drag cards here"}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
