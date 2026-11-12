"use client";

// Extracted verbatim from SummaryTab.tsx by scripts/refactor/split-module.mjs.
// SummaryTab.tsx re-exports everything public here, so existing imports keep working.
import { topSituationLabel } from "@/debtors-tracker/regions";
import type { DebtorRegionSummary, DebtorRegionFilter } from "@/debtors-tracker/regions";
import { formatINR } from "@/debtors-tracker/types";
import { REGION_TILE_TONES } from "./helpers";

/**
 * Always-visible per-region comparison: one clickable tile per R1–R4 +
 * Unmapped. Clicking a tile scopes the receivables section below to it.
 */
export function RegionStrip({
  rows, active, onPick,
}: {
  rows: DebtorRegionSummary[];
  active: DebtorRegionFilter;
  onPick: (f: DebtorRegionFilter) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
      <button
        onClick={() => onPick("ALL")}
        title="Show all regions"
        className={`rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
          active === "ALL"
            ? "border-zinc-900/30 bg-zinc-900/[0.04] ring-1 ring-zinc-900/30 dark:border-zinc-100/30 dark:bg-white/[0.06] dark:ring-zinc-100/30"
            : "border-zinc-200/70 bg-white dark:border-zinc-800/80 dark:bg-zinc-900/40"
        }`}
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">All regions</div>
        <div className="mt-1.5 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
          {formatINR(rows.reduce((a, r) => a + r.grossDue, 0), false)}
        </div>
        <div className="mt-0.5 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
          gross · {rows.reduce((a, r) => a + r.customers, 0)} customers
        </div>
      </button>
      {rows.map((r) => {
        const isActive = active === r.key;
        const tone = r.region ? (REGION_TILE_TONES[r.region] ?? "") : "";
        return (
          <button
            key={r.key}
            onClick={() => onPick(r.key)}
            title={`${r.label} — gross ${formatINR(r.grossDue, false)} · net ${formatINR(r.netDue, false)} · top situation ${topSituationLabel(r)}`}
            className={`rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
              isActive
                ? `border-transparent ring-1 ${tone}`
                : "border-zinc-200/70 bg-white dark:border-zinc-800/80 dark:bg-zinc-900/40"
            }`}
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
              {r.region || "Unmapped"}
            </div>
            <div className="mt-1.5 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatINR(r.grossDue, false)}
            </div>
            <div className="mt-0.5 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
              net {formatINR(r.netDue, false)} · {r.customers} customer{r.customers === 1 ? "" : "s"}
            </div>
          </button>
        );
      })}
    </div>
  );
}
