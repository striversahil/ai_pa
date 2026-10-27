"use client";

// ClosedEstimates — the actual accepted estimates behind a region's `Won` number.
//
// Answers "what exactly did this team close?" without leaving the leaderboard.
// Every row is the payload's own accepted-estimate record (`regions[].acceptedItems`,
// built server-side in accepted.ts), so the list always sums to `region.won.value`
// — no client-side re-derivation, no double counting.
//
// Deliberately a scroll box with a sticky header: a region can close 60+ deals in
// a year, and the drawer must never push the rest of the board off screen.

import React from "react";
import { CircleCheck } from "lucide-react";
import type { BoardClosedItem } from "@/telecalling/view-types";
import { fmtDate, fmtLakh, fmtNum, initials } from "@/telecalling/format";
import { LABEL, PILL, WELL } from "./surface";

export interface ClosedEstimatesProps {
  items: BoardClosedItem[];
  /** Region `won.count` — may exceed `items.length` when the list is capped. */
  totalCount: number;
  /** Region `won.value` — the full period total, cap included. */
  totalValue: number;
  regionName?: string;
}

export function ClosedEstimates({ items, totalCount, totalValue, regionName }: ClosedEstimatesProps) {
  const shown = items.length;
  const hidden = Math.max(0, totalCount - shown);
  const value = items.reduce((s, it) => s + Number(it.total ?? 0), 0);
  const capped = hidden > 0;

  return (
    <div className={`${WELL} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-card)] px-2.5 py-1.5">
        <div className="min-w-0">
          <span className={LABEL}>Closed estimates</span>
          <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
            {regionName ? `${regionName} · ` : ""}newest acceptance first
            {capped && ` · showing the latest ${shown} of ${totalCount}`}
          </p>
        </div>
        <span className={`${PILL} py-0 text-[9px] border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300`}>
          <CircleCheck className="h-2.5 w-2.5" aria-hidden="true" />
          {fmtNum(totalCount)} closed · {fmtLakh(totalValue)}
        </span>
      </div>

      {shown === 0 ? (
        <p className="px-2.5 py-2 text-[11px] text-[var(--text-tertiary)]">
          No accepted estimates in this period.
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-[var(--surface-sunken)]">
              <tr className="text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                <th className="px-2.5 py-1 text-left font-bold">Estimate</th>
                <th className="hidden px-2 py-1 text-left font-bold sm:table-cell">Customer</th>
                <th className="px-2 py-1 text-left font-bold">Closed by</th>
                <th className="hidden px-2 py-1 text-right font-bold md:table-cell">Accepted</th>
                <th className="px-2.5 py-1 text-right font-bold">Value</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.estimateId}
                  className="border-t border-[var(--border-card)] transition-colors hover:bg-[var(--bg-card)]"
                >
                  <td className="whitespace-nowrap px-2.5 py-1 font-mono font-semibold text-[var(--text-secondary)]">
                    {it.estimateNumber || it.estimateId}
                  </td>
                  <td className="hidden max-w-[14rem] truncate px-2 py-1 text-[var(--text-primary)] sm:table-cell" title={it.customerName ?? undefined}>
                    {it.customerName || "—"}
                  </td>
                  <td className="px-2 py-1">
                    {it.createdByName ? (
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-[var(--border-card)] bg-[var(--bg-card)] text-[7px] font-extrabold text-indigo-600 dark:text-indigo-300"
                          aria-hidden="true"
                        >
                          {initials(it.createdByName)}
                        </span>
                        <span className="max-w-[9rem] truncate text-[var(--text-secondary)]" title={it.createdByName}>
                          {it.createdByName}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[var(--text-tertiary)]">—</span>
                    )}
                  </td>
                  <td className="hidden whitespace-nowrap px-2 py-1 text-right font-mono text-[var(--text-tertiary)] md:table-cell">
                    {it.acceptedAt ? fmtDate(it.acceptedAt) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    {fmtLakh(Number(it.total ?? 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {capped && (
        <p className="border-t border-[var(--border-card)] px-2.5 py-1 text-[10px] text-[var(--text-tertiary)]">
          Showing the latest {shown} closes (₹{fmtNum(Math.round(value))}). All {fmtNum(totalCount)} —
          ₹{fmtNum(Math.round(totalValue))} — are counted in the region total.
        </p>
      )}
    </div>
  );
}

export default ClosedEstimates;
