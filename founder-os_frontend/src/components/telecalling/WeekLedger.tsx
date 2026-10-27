"use client";

// WeekLedger — "why is the backlog this size?" in one glance.
//
// Renders the server-computed carry ledger verbatim (Mon–Sat weeks): target,
// accepted, what was carried in, what is due, what rolls out. Pure display —
// no rupee figure is re-derived, so the browser can never drift from the worker.

import React from "react";
import { ArrowRight, CircleCheck } from "lucide-react";
import type { RegionTarget } from "@/telecalling/targets";
import { fmtDate, fmtLakh } from "@/telecalling/format";
import { TARGET_TONE } from "@/telecalling/tone";
import { LABEL, PILL, WELL } from "./surface";

export interface WeekLedgerProps {
  target: RegionTarget;
  regionName?: string;
}

export function WeekLedger({ target, regionName }: WeekLedgerProps) {
  const tone = TARGET_TONE[target.status];
  const currentStart = target.current?.weekStart;

  return (
    <div className={`${WELL} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-card)] px-2.5 py-1.5">
        <div className="min-w-0">
          <span className={LABEL}>Week-by-week carry ledger</span>
          <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
            {regionName ? `${regionName} · ` : ""}a surplus clears backlog first and is never banked
          </p>
        </div>
        <span className={`${PILL} ${tone.chip}`}>
          {fmtLakh(target.sinceStart.accepted)} / {fmtLakh(target.sinceStart.target)} since start
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-[11px]">
          <thead>
            <tr className="text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              <th className="px-2.5 py-1 text-left font-bold">Week</th>
              <th className="px-2 py-1.5 text-right font-bold">Days</th>
              <th className="px-2 py-1.5 text-right font-bold">Target</th>
              <th className="px-2 py-1.5 text-right font-bold">Accepted</th>
              <th className="px-2 py-1.5 text-right font-bold">Carried in</th>
              <th className="px-2 py-1.5 text-right font-bold">Due</th>
              <th className="px-2.5 py-1 text-right font-bold">Rolls out</th>
            </tr>
          </thead>
          <tbody>
            {target.weeks.map((w) => {
              const isCurrent = w.weekStart === currentStart;
              const closed = w.gap <= 0;
              const pct = w.due > 0 ? Math.min(100, Math.round((w.accepted / w.due) * 100)) : 0;
              return (
                <tr
                  key={w.weekStart}
                  className={`border-t border-[var(--border-card)] ${isCurrent ? "bg-indigo-500/[0.06]" : ""}`}
                >
                  <td className="whitespace-nowrap px-2.5 py-1">
                    <span className="font-semibold text-[var(--text-secondary)]">
                      {fmtDate(w.weekStart)} → {fmtDate(w.weekEnd)}
                    </span>
                    {isCurrent && (
                      <span className="ml-1.5 rounded-full bg-indigo-500/15 px-1.5 text-[9px] font-bold text-indigo-700 dark:text-indigo-300">
                        now
                      </span>
                    )}
                    {w.cleared && (
                      <CircleCheck className="ml-1 inline h-3 w-3 text-emerald-600 dark:text-emerald-400" aria-label="cleared" />
                    )}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-[var(--text-tertiary)]">{w.days}</td>
                  <td className="px-2 py-1 text-right font-mono text-[var(--text-secondary)]">{fmtLakh(w.target)}</td>
                  <td className="px-2 py-1 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="hidden h-[3px] w-10 overflow-hidden rounded-full bg-[var(--border-card)] sm:block" aria-hidden="true">
                        <span
                          className={`block h-full rounded-full ${closed ? "bg-emerald-500" : "bg-amber-500"} transition-[width] duration-700 ease-out`}
                          style={{ width: `${Math.max(0, pct)}%` }}
                        />
                      </span>
                      <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{fmtLakh(w.accepted)}</span>
                    </div>
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-amber-600 dark:text-amber-400">{fmtLakh(w.carryIn)}</td>
                  <td className="px-2 py-1 text-right font-mono text-[var(--text-secondary)]">{fmtLakh(w.due)}</td>
                  <td className="px-2.5 py-1 text-right">
                    {w.gap > 0 ? (
                      <span className="inline-flex items-center gap-0.5 font-mono font-semibold text-rose-600 dark:text-rose-400">
                        <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        {fmtLakh(w.gap)}
                      </span>
                    ) : (
                      <span className="font-mono text-[var(--text-tertiary)]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="border-t border-[var(--border-card)] px-2.5 py-1 text-[10px] text-[var(--text-tertiary)]">
        Rolls out = target that went unpaid and carries into the following week. Full weeks are Mon–Sat; the current week accrues day by day.
      </p>
    </div>
  );
}

export default WeekLedger;
