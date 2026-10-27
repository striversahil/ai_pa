"use client";

// BoardHeader — slim page header for the telecalling dashboard: title, the
// live period window, the chase-window switcher and the game rules.
//
// Replaces the old gradient banner + separate table toolbar (the toolbars
// duplicated the period switcher and split the page into two visual languages).

import React from "react";
import {
  CalendarDays, Info, PhoneCall, RotateCcw, Sparkles, Target, Trophy, TriangleAlert, Users,
} from "lucide-react";
import type { BoardMeta } from "@/telecalling/view-types";
import { fmtDate } from "@/telecalling/format";
import { BTN, CARD, FOCUS, LABEL, PILL } from "./surface";

export interface BoardHeaderProps {
  meta?: BoardMeta;
  period: string;
  periods: { key: string; label: string }[];
  onPeriod: (key: string) => void;
  loading?: boolean;
  /** The chase-window switcher only drives the dashboard tab. */
  showControls?: boolean;
}

const RULES = [
  { icon: Target, value: "₹1,00,000", label: "Per region · working day", note: "accepted estimate value" },
  { icon: RotateCcw, value: "↩ carry", label: "Missed weeks roll on", note: "shortfall is never forgiven" },
  { icon: Sparkles, value: "+15", label: "New lead", note: "per enquiry created" },
  { icon: PhoneCall, value: "+0.5", label: "Connected call", note: "per NeoDove connect" },
];

export function BoardHeader({ meta, period, periods, onPeriod, loading = false, showControls = true }: BoardHeaderProps) {
  const specialists = Number(meta?.activeCount ?? 0);
  const totalStaff = Number(meta?.telecallerCount ?? 0);
  const unattributed = Number(meta?.unattributedLeads ?? 0);

  return (
    <header className={`${CARD} fos-board`}>
      {/* Decorative aurora — one soft accent behind the title only. */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-indigo-500/10 blur-3xl animate-aurora dark:bg-indigo-500/20" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-28 -left-16 h-48 w-48 rounded-full bg-emerald-500/[0.07] blur-3xl animate-aurora-slow dark:bg-emerald-500/10" aria-hidden="true" />

      {/* Thin indeterminate bar while a refetch is in flight (no layout shift). */}
      {loading && (
        <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden" aria-hidden="true">
          <div className="fos-loading-bar h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-indigo-500 to-transparent" />
        </div>
      )}

      <div className="relative flex flex-col gap-3 p-3.5 md:flex-row md:items-start md:justify-between md:gap-6 md:p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/25">
            <Trophy className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-xl font-bold tracking-tight text-[var(--text-primary)] md:text-2xl">
                Sales leaderboard
              </h1>
              {meta?.periodLabel && (
                <span className={`${PILL} border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300`}>
                  {meta.periodLabel}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Regions ranked by target attainment · accepted estimate value drives every number
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {meta?.periodFrom && meta?.periodTo && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-card)] bg-[var(--surface-sunken)] px-2 py-1 text-[11px] font-semibold text-[var(--text-secondary)]"
                  title={`${meta.periodFrom} → ${meta.periodTo}`}
                >
                  <CalendarDays className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                  <span className="font-mono">{fmtDate(meta.periodFrom)} → {fmtDate(meta.periodTo)}</span>
                  {meta.workingDays ? (
                    <span className="rounded-full bg-indigo-500/10 px-1.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                      {meta.workingDays} days
                    </span>
                  ) : null}
                </span>
              )}
              <span
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                title="Roster staff marked active"
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                {specialists} specialists
                {totalStaff > specialists ? <span className="font-normal opacity-80">/ {totalStaff}</span> : null}
              </span>
              {unattributed > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
                  title="Enquiries with no roster match — MIS should fix attribution"
                >
                  <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  {unattributed} unattributed
                </span>
              )}
            </div>
          </div>
        </div>

        {showControls && (
        <div className="flex flex-col items-stretch gap-2 md:items-end">
          <div
            role="group"
            aria-label="Chase window"
            className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-1"
          >
            {periods.map((p) => {
              const active = period === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => onPeriod(p.key)}
                  aria-pressed={active}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all active:scale-[0.98] ${FOCUS} ${
                    active
                      ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/25"
                      : "text-[var(--text-tertiary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden="true" />
            <span className={LABEL}>Ranked on accepted ₹</span>

            {/* Rules — hover/focus opens a plain-English card. */}
            <div className="group relative">
              <button
                type="button"
                title="Game rules"
                aria-describedby="fos-rules"
                className={`grid h-7 w-7 place-items-center rounded-full border border-indigo-400/40 bg-indigo-500/10 text-indigo-600 transition-colors hover:bg-indigo-500/20 dark:text-indigo-300 ${FOCUS}`}
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Game rules</span>
              </button>
              <div
                id="fos-rules"
                role="tooltip"
                className="pointer-events-none invisible absolute right-0 top-9 z-40 w-80 translate-y-1 opacity-0 transition-all duration-200 group-hover:pointer-events-auto group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 md:w-96"
              >
                <div className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4 text-left shadow-[var(--shadow-pop)]">
                  <div className="mb-2 font-heading text-sm font-bold text-[var(--text-primary)]">How the goal works</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {RULES.map((r) => (
                      <div key={r.label} className="rounded-lg border border-[var(--border-card)] bg-[var(--surface-sunken)] px-2 py-1.5 text-center">
                        <r.icon className="mx-auto mb-0.5 h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                        <div className="font-mono text-sm font-extrabold text-[var(--text-primary)]">{r.value}</div>
                        <div className="text-[10px] font-bold text-[var(--text-secondary)]">{r.label}</div>
                        <div className="text-[9px] text-[var(--text-tertiary)]">{r.note}</div>
                      </div>
                    ))}
                  </div>
                  <ul className="mt-2 space-y-0.5 rounded-lg bg-[var(--surface-sunken)] px-2.5 py-2 text-[10px] font-medium text-[var(--text-secondary)]">
                    <li>6 working days (Mon–Sat) → ₹6L per region per week</li>
                    <li>A surplus clears backlog first and is never banked</li>
                    <li>Close slabs: ₹0–1L +50 · ₹1–2.5L +75 · ₹2.5–5L +100 · ₹5L+ +200</li>
                    <li>Rank = accepted ÷ owed since the ledger start (ties break on accepted ₹)</li>
                    <li>Sales Head / HQ closes and unlinked deals never count against a region</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}
      </div>
    </header>
  );
}

export default BoardHeader;
