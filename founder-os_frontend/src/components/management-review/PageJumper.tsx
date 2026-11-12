"use client";

// Extracted verbatim from ManagementReview.tsx by scripts/refactor/split-module.mjs.
// ManagementReview.tsx re-exports everything public here, so existing imports keep working.
import { pageWindow } from "./helpers";

export function PageJumper({ page, totalPages, onJump }: { page: number; totalPages: number; onJump: (n: number) => void }) {
  if (totalPages <= 1) return null;
  const btn = "px-2.5 py-1 rounded-lg border border-[var(--border-card)] text-xs font-bold cursor-pointer bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]";
  const btnSel = "px-2.5 py-1 rounded-lg border-0 text-xs font-extrabold cursor-pointer bg-[var(--color-brand-indigo)] text-white";
  return (
    <div className="flex items-center gap-1">
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
