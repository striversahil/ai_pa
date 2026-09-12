"use client";

import React, { useState } from "react";

// Shared queue chrome: collapsible enquiry groups + closed dropdown + pager.
// Both queues club items under their enquiry (expand to see individual item
// rows); decided/finalized items live under one collapsed "Closed" dropdown.

export function GroupCard({ title, subtitle, count, defaultOpen = true, children }: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 cursor-pointer bg-transparent border-0 text-left hover:bg-[var(--bg-input)]/30">
        <svg className={`w-4 h-4 text-[var(--text-tertiary)] transition-transform flex-shrink-0 ${open ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-extrabold text-[var(--text-primary)]">{title}</span>
          {subtitle && <span className="block truncate text-[11px] text-[var(--text-secondary)]">{subtitle}</span>}
        </span>
        {count !== undefined && (
          <span className="text-[11px] font-bold text-[var(--text-tertiary)] bg-[var(--bg-input)] rounded-full px-2 py-0.5 flex-shrink-0">{count}</span>
        )}
      </button>
      {open && <div className="border-t border-[var(--border-card)]/60">{children}</div>}
    </div>
  );
}

export function ClosedDropdown({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)]/60 overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 cursor-pointer bg-transparent border-0 text-left hover:bg-[var(--bg-input)]/30">
        <svg className={`w-4 h-4 text-[var(--text-tertiary)] transition-transform flex-shrink-0 ${open ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
          Closed — decision made ({count})
        </span>
      </button>
      {open && <div className="border-t border-[var(--border-card)]/60 p-3 space-y-2">{children}</div>}
    </div>
  );
}

export function QueuePager({ page, total, pageSize, setPage, setPageSize }: {
  page: number;
  total: number | null;
  pageSize: number;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
}) {
  if (pageSize <= 0 || total === null) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
      <span>Page {Math.min(page, pages)} of {pages} · {total} enquiries</span>
      <span className="flex gap-1">
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}
          className="px-2.5 py-1 rounded-lg border border-[var(--border-card)] disabled:opacity-40 cursor-pointer bg-transparent text-[var(--text-primary)]">‹ Prev</button>
        <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}
          className="px-2.5 py-1 rounded-lg border border-[var(--border-card)] disabled:opacity-40 cursor-pointer bg-transparent text-[var(--text-primary)]">Next ›</button>
      </span>
      <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
        className="px-2 py-1 rounded-lg bg-[var(--bg-input)] border border-[var(--border-card)] text-xs cursor-pointer text-[var(--text-primary)]">
        <option value={10}>10 / page</option>
        <option value={50}>50 / page</option>
      </select>
    </div>
  );
}
