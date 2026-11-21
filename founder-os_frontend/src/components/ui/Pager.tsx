"use client";

// Shared list footer + live-change banner (founder paging standard 2026-11-21).
// Props-only: the data hook (`usePagedQuery`) owns fetching.
import { RefreshCw } from "lucide-react";
import { pageWindow } from "@/lib/paging";

const btn = "px-2.5 py-1 rounded-lg border border-[var(--border-card)] text-xs font-bold cursor-pointer bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]";
const btnSel = "px-2.5 py-1 rounded-lg border-0 text-xs font-extrabold cursor-pointer bg-[var(--color-brand-indigo)] text-white";

/** ‹ Prev · 1 2 … 5 6 7 … 19 20 · Next › (hidden when there is one page). */
export function PageJumper({ page, totalPages, onJump }: { page: number; totalPages: number; onJump: (n: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <button type="button" disabled={page <= 1} onClick={() => onJump(page - 1)} className={`${btn} disabled:opacity-40`}>‹ Prev</button>
      {pageWindow(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-xs text-[var(--text-tertiary)]">…</span>
        ) : (
          <button key={p} type="button" onClick={() => onJump(p)}
            className={p === page ? btnSel : btn} aria-current={p === page ? "page" : undefined}>{p}</button>
        ),
      )}
      <button type="button" disabled={page >= totalPages} onClick={() => onJump(page + 1)} className={`${btn} disabled:opacity-40`}>Next ›</button>
    </div>
  );
}

/** "Showing 51–100 of 6,978" + page numbers. `noun` names the rows. */
export function Pager({ page, limit, total, totalPages, onPage, noun = "rows" }: {
  page: number; limit: number; total: number; totalPages: number; onPage: (n: number) => void; noun?: string;
}) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div className="flex flex-wrap items-center gap-3 px-1 py-2">
      <span className="text-xs tabular-nums text-[var(--text-tertiary)]">
        Showing {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")} {noun}
      </span>
      <span className="flex-1" />
      <PageJumper page={page} totalPages={totalPages} onJump={onPage} />
    </div>
  );
}

/** "3 new changes — click to refresh". Renders nothing at 0. */
export function ChangesBanner({ count, onRefresh }: { count: number; onRefresh: () => void }) {
  if (count <= 0) return null;
  return (
    <button type="button" onClick={onRefresh}
      className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-brand-indigo)]/40 bg-[var(--color-brand-indigo)]/10 px-3 py-2 text-xs font-bold text-[var(--color-brand-indigo)] cursor-pointer">
      <RefreshCw size={13} /> {count === 1 ? "1 new change" : `${count} new changes`} — click to refresh
    </button>
  );
}
