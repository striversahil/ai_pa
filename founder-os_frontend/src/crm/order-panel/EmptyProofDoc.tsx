"use client";

// Extracted verbatim from OrderPanel.tsx by scripts/refactor/split-module.mjs.
// OrderPanel.tsx re-exports everything public here, so existing imports keep working.


/** A proof slot that was never uploaded — muted, keeps the row's shape. */
export function EmptyProofDoc({ label }: { label: string }) {
  return (
    <div className="flex w-[68px] flex-col items-center gap-1 opacity-45" title={`No ${label.toLowerCase()} attached`}>
      <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-[11px] text-zinc-400 dark:border-zinc-700">
        —
      </span>
      <span className="w-full truncate text-center text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </span>
    </div>
  );
}
