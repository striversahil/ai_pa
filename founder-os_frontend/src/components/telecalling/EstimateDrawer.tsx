"use client";

// EstimateDrawer — the actual estimates behind a region-row figure.
//
// Two variants, one table:
//   • won      — the accepted/confirmed rows behind the `Won` stat.
//   • declined — the declined rows behind the `Declined` stat.
//
// Every row comes from the payload's own server-built list
// (`regions[].acceptedItems` / `regions[].declinedItems`) so the drawer always
// reconciles with the stat that opened it — no client-side re-derivation, no
// double counting.
//
// Deliberately a scroll box with a sticky header: a region can close or lose
// 60+ deals in a year, and the drawer must never push the rest of the board
// off screen.

import React from "react";
import { CircleCheck, CircleX } from "lucide-react";
import type { BoardClosedItem } from "@/telecalling/view-types";
import { fmtDate, fmtLakh, fmtNum, initials } from "@/telecalling/format";
import { LABEL, PILL, WELL } from "./surface";

export type EstimateDrawerVariant = "won" | "declined";

export interface EstimateDrawerProps {
  items: BoardClosedItem[];
  /** The stat's own count — may exceed `items.length` when the list is capped. */
  totalCount: number;
  /** The stat's own period total, cap included. */
  totalValue: number;
  regionName?: string;
  variant?: EstimateDrawerVariant;
}

interface VariantConfig {
  title: string;
  orderCaption: string;
  noun: string;
  plural: string;
  byLabel: string;
  dateLabel: string;
  empty: string;
  /** Where the full (uncapped) number lives. */
  countedIn: string;
  pillTone: string;
  valueTone: string;
  avatarTone: string;
  Icon: typeof CircleCheck;
  dateOf: (it: BoardClosedItem) => string | null | undefined;
}

const VARIANTS: Record<EstimateDrawerVariant, VariantConfig> = {
  won: {
    title: "Closed estimates",
    orderCaption: "newest acceptance first",
    noun: "closed",
    plural: "closes",
    byLabel: "Closed by",
    dateLabel: "Accepted",
    empty: "No accepted estimates in this period.",
    countedIn: "the region total",
    pillTone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    valueTone: "text-emerald-600 dark:text-emerald-400",
    avatarTone: "text-indigo-600 dark:text-indigo-300",
    Icon: CircleCheck,
    dateOf: (it) => it.acceptedAt,
  },
  declined: {
    title: "Declined estimates",
    orderCaption: "newest decline first",
    noun: "declined",
    plural: "declines",
    byLabel: "Sent by",
    dateLabel: "Declined",
    empty: "No declined estimates in this period.",
    countedIn: "the Declined stat",
    pillTone: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    valueTone: "text-rose-600 dark:text-rose-400",
    avatarTone: "text-rose-600 dark:text-rose-300",
    Icon: CircleX,
    dateOf: (it) => it.declinedAt,
  },
};

export function EstimateDrawer({
  items, totalCount, totalValue, regionName, variant = "won",
}: EstimateDrawerProps) {
  const cfg = VARIANTS[variant];
  const { Icon } = cfg;
  const shown = items.length;
  const hidden = Math.max(0, totalCount - shown);
  const value = items.reduce((s, it) => s + Number(it.total ?? 0), 0);
  const capped = hidden > 0;

  return (
    <div className={`${WELL} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-card)] px-2.5 py-1.5">
        <div className="min-w-0">
          <span className={LABEL}>{cfg.title}</span>
          <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
            {regionName ? `${regionName} · ` : ""}{cfg.orderCaption}
            {capped && ` · showing the latest ${shown} of ${totalCount}`}
          </p>
        </div>
        <span className={`${PILL} py-0 text-[9px] ${cfg.pillTone}`}>
          <Icon className="h-2.5 w-2.5" aria-hidden="true" />
          {fmtNum(totalCount)} {cfg.noun} · {fmtLakh(totalValue)}
        </span>
      </div>

      {shown === 0 ? (
        <p className="px-2.5 py-2 text-[11px] text-[var(--text-tertiary)]">{cfg.empty}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-[var(--surface-sunken)]">
              <tr className="text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                <th className="px-2.5 py-1 text-left font-bold">Estimate</th>
                <th className="hidden px-2 py-1 text-left font-bold sm:table-cell">Customer</th>
                <th className="px-2 py-1 text-left font-bold">{cfg.byLabel}</th>
                <th className="hidden px-2 py-1 text-right font-bold md:table-cell">{cfg.dateLabel}</th>
                <th className="px-2.5 py-1 text-right font-bold">Value</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const day = cfg.dateOf(it);
                return (
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
                            className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border border-[var(--border-card)] bg-[var(--bg-card)] text-[7px] font-extrabold ${cfg.avatarTone}`}
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
                      {day ? fmtDate(day) : "—"}
                    </td>
                    <td className={`whitespace-nowrap px-2.5 py-1 text-right font-mono font-bold ${cfg.valueTone}`}>
                      {fmtLakh(Number(it.total ?? 0))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {capped && (
        <p className="border-t border-[var(--border-card)] px-2.5 py-1 text-[10px] text-[var(--text-tertiary)]">
          Showing the latest {shown} {cfg.plural} (₹{fmtNum(Math.round(value))}). All {fmtNum(totalCount)} —
          ₹{fmtNum(Math.round(totalValue))} — are counted in {cfg.countedIn}.
        </p>
      )}
    </div>
  );
}

export default EstimateDrawer;
