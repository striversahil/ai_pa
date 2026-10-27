import React from "react";
import type { ReactNode } from "react";

export function Table({
  children,
  className = "",
  stickyFirst = false,
}: {
  children: ReactNode;
  className?: string;
  stickyFirst?: boolean;
}) {
  return (
    <div className="scrollbar-thin overflow-x-auto rounded-[var(--radius-control)] border border-[var(--border-card)]">
      <table className={`w-full border-collapse text-sm ${stickyFirst ? "min-w-[640px]" : ""} ${className}`}>
        {children}
      </table>
    </div>
  );
}

export const thClass =
  "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] bg-[var(--surface-soft)] border-b border-[var(--border-card)] whitespace-nowrap";

export const tdClass = "px-4 py-3 border-b border-[var(--border-card)] text-[var(--text-secondary)] whitespace-nowrap";

export const stickyCol =
  "sticky left-0 z-10 bg-[var(--bg-card)]";
