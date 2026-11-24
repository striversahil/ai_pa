"use client";

// DashboardHeader — Debtors Tracker title + the two header actions (overdue
// CSV export, live/snapshot pill). Extracted from DebtorsTrackerDashboard so
// that file stays under the 400-line split threshold (AGENTS.md). The parent
// still owns the export flow, the row count and the historical lock.

export default function DashboardHeader({
  hasData,
  overdueCount,
  exporting,
  onExport,
  asOfIST,
  historical,
}: {
  hasData: boolean;
  overdueCount: number;
  exporting: boolean;
  onExport: () => void;
  asOfIST: string;
  historical: boolean;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Debtors Tracker</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Debtors, ageing, live collections and reminder previews for the accounts desk and sales follow-up.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onExport}
          disabled={!hasData || overdueCount === 0 || exporting}
          title={
            !hasData
              ? "Loading receivables…"
              : overdueCount === 0
                ? "No clients with overdue, unpaid bills"
                : `Download ${overdueCount} client${overdueCount === 1 ? "" : "s"} with overdue bills as CSV`
          }
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
          </svg>
          {exporting ? "Preparing…" : "Download as CSV"}
          {!exporting && overdueCount > 0 && (
            <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
              {overdueCount}
            </span>
          )}
        </button>
        {hasData && (
          <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            {historical ? "Snapshot" : "Live"} · as of {asOfIST}
          </div>
        )}
      </div>
    </header>
  );
}
