"use client";

// Extracted verbatim from TelecallingDashboard.tsx by scripts/refactor/split-module.mjs.
// TelecallingDashboard.tsx re-exports everything public here, so existing imports keep working.


export function QueryErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5">
      <span className="text-xs font-semibold text-rose-600 dark:text-rose-300">⚠ Couldn’t load live data — {message}</span>
      <button
        onClick={onRetry}
        className="text-xs font-bold rounded-lg px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white transition-colors"
      >
        Retry
      </button>
    </div>
  );
}
