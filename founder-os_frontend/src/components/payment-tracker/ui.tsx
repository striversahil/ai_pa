"use client";

import type { ReactNode } from "react";
import type { LiveInvoice } from "@/payment-tracker/types";

/** Shared presentational primitives for the Payment Tracker dashboard. */

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40 ${className}`}>
      {children}
    </div>
  );
}

export function SectionCard({
  title, description, actions, children, className = "",
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800/70 px-4 py-3">
        <div>
          <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

export function StatCard({
  label, value, tone, hint, big,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
  big?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`mt-1.5 font-semibold tabular-nums ${big ? "text-2xl" : "text-lg"} ${tone ?? "text-zinc-900 dark:text-zinc-100"}`}>
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{hint}</div>}
    </div>
  );
}

export function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{label}</span>
      <span className="text-sm font-medium tabular-nums text-zinc-800 dark:text-zinc-200">{value}</span>
    </div>
  );
}

export function EmptyState({
  title, hint, action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{title}</p>
      {hint && <p className="max-w-md text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Chip({
  active, onClick, children, count,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-indigo-500/10 text-indigo-600 ring-1 ring-indigo-500/40 dark:text-indigo-400"
          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
      }`}
    >
      {children}
      {count != null && (
        <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${active ? "bg-indigo-500/15" : "bg-zinc-200/70 dark:bg-zinc-800"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

export function SearchInput({
  value, onChange, placeholder, className = "w-full sm:w-80",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      />
    </div>
  );
}

export function bucketBadge(b: LiveInvoice["bucket"]): string {
  switch (b) {
    case "NOT_DUE": return "bg-sky-500/10 text-sky-600 dark:text-sky-400";
    case "D0": return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "D31": return "bg-lime-500/10 text-lime-700 dark:text-lime-400";
    case "D61": return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "D91": return "bg-orange-500/10 text-orange-700 dark:text-orange-400";
    case "D181": return "bg-rose-500/10 text-rose-600 dark:text-rose-400";
    default: return "bg-zinc-400/10 text-zinc-500 dark:text-zinc-400";
  }
}

export function matchBadge(status: string): string {
  switch (status) {
    case "invoice": return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "customer": return "bg-sky-500/10 text-sky-600 dark:text-sky-400";
    case "advance": return "bg-violet-500/10 text-violet-600 dark:text-violet-400";
    default: return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
  }
}

export function matchLabel(status: string): string {
  return status === "invoice" ? "By invoice"
    : status === "customer" ? "By customer (oldest open)"
    : status === "advance" ? "Customer advance"
    : "Unmatched";
}

/** Table shell with sticky header + horizontal scroll. `dense` = Excel-like. */
export function TableShell({
  minWidth, dense = false, children,
}: {
  minWidth: number;
  dense?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-2xl border border-zinc-200/80 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
      <table className={`w-full ${dense ? "text-[11px] leading-4" : "text-xs"}`} style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export const TH = "sticky top-0 z-10 whitespace-nowrap border-b border-zinc-200 bg-zinc-50/95 px-3 py-2 text-left font-medium text-zinc-500 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95 dark:text-zinc-400";
export const THR = "sticky top-0 z-10 whitespace-nowrap border-b border-zinc-200 bg-zinc-50/95 px-3 py-2 text-right font-medium text-zinc-500 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95 dark:text-zinc-400";
export const TD = "border-b border-zinc-100 px-3 py-2 text-zinc-600 dark:border-zinc-800/50 dark:text-zinc-400";
export const TDR = "whitespace-nowrap border-b border-zinc-100 px-3 py-2 text-right tabular-nums text-zinc-600 dark:border-zinc-800/50 dark:text-zinc-400";

/** Excel-dense cell tokens for Invoices + Collections (11px, 10px headers). */
export const THC = "sticky top-0 z-10 whitespace-nowrap border-b border-r border-zinc-200 bg-zinc-50/95 px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-500 backdrop-blur last:border-r-0 dark:border-zinc-800 dark:bg-zinc-900/95 dark:text-zinc-400";
export const THCR = "sticky top-0 z-10 whitespace-nowrap border-b border-r border-zinc-200 bg-zinc-50/95 px-2 py-1 text-right text-[10px] font-medium uppercase tracking-wide text-zinc-500 backdrop-blur last:border-r-0 dark:border-zinc-800 dark:bg-zinc-900/95 dark:text-zinc-400";
export const TDC = "border-b border-r border-zinc-100 px-2 py-1 align-middle text-zinc-600 last:border-r-0 dark:border-zinc-800/50 dark:text-zinc-400";
export const TDCR = "whitespace-nowrap border-b border-r border-zinc-100 px-2 py-1 text-right align-middle tabular-nums text-zinc-600 last:border-r-0 dark:border-zinc-800/50 dark:text-zinc-400";
