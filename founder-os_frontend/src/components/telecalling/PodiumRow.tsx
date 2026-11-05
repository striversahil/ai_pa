"use client";

// PodiumRow — one region on the leaderboard: rank medallion, identity, the
// attainable-money rail, this week's carry position and the period stats.
//
// The region is the unit that owns estimates and owes ₹1L/day (founder
// decision), so ALL money lives on this row; its telecallers hang underneath in
// StaffRail as always-open children. Every target/accepted figure is
// server-computed (`region.target`) and rendered as-is.
//
// Layout is deliberately DENSE: from xl up it is a single horizontal row
// (identity | rail | stats | actions) so the card uses the width it is given
// instead of stacking four short blocks down a tall card. Below xl it stacks.

import React from "react";
import {
  BookOpen, ChevronDown, Receipt, Target, Users,
} from "lucide-react";
import type { BoardRegion, BoardStaff } from "@/telecalling/view-types";
import type { TargetStatus } from "@/telecalling/targets";
import { TARGET_STATUS_LABEL } from "@/telecalling/targets";
import { fmtDate, fmtLakh, fmtNum } from "@/telecalling/format";
import { TARGET_TONE } from "@/telecalling/tone";
import { useCountUp } from "@/telecalling/useCountUp";
import { StaffRail } from "./StaffRail";
import { WeekLedger } from "./WeekLedger";
import { ClosedEstimates } from "./ClosedEstimates";
import { DeclinedEstimates } from "./DeclinedEstimates";
import { CARD, FOCUS, PILL } from "./surface";

export interface PodiumRowProps {
  region: BoardRegion;
  index: number;
  staff: BoardStaff[];
  /** TL name(s) covering this region — reseller ₹ here counts to their TL total. */
  tlName?: string;
  weeksOpen: boolean;
  onToggleWeeks: () => void;
  /** Drawer listing the accepted estimates behind `Won`. */
  closedOpen: boolean;
  onToggleClosed: () => void;
  /** Drawer listing the declined estimates behind `Declined`. */
  declinedOpen: boolean;
  onToggleDeclined: () => void;
  /** Drill into this region's conversion pipeline. */
  onOpenRegion: () => void;
  /** Ledger start day (from meta.teamTarget) for the "since" caption. */
  targetStart?: string;
  /** Working days in the selected period (Mon–Sat) — drives the staff avg/day readout. */
  workingDays?: number;
}

/** Metal treatment for the top three ranks; neutral ring below that. */
function medallionClass(rank: number): string {
  if (rank === 1) return "bg-gradient-to-br from-amber-300 to-amber-600 text-amber-950 shadow-md shadow-amber-500/30";
  if (rank === 2) return "bg-gradient-to-br from-zinc-200 to-zinc-400 text-zinc-900 shadow-md shadow-zinc-400/25";
  if (rank === 3) return "bg-gradient-to-br from-orange-300 to-orange-600 text-orange-950 shadow-md shadow-orange-500/25";
  return "border border-[var(--border-card)] bg-[var(--surface-sunken)] text-[var(--text-secondary)]";
}

const ICON_BTN = `grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] text-[var(--text-secondary)] transition-colors hover:border-indigo-400 hover:text-indigo-600 active:scale-95 dark:hover:text-indigo-300 ${FOCUS}`;

/** One compact stat: micro-label, mono value, optional currency hint. */
function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-bold uppercase leading-3 tracking-[0.07em] text-[var(--text-tertiary)]">{label}</div>
      <div className={`truncate font-mono text-[12px] font-bold leading-4 ${tone ?? "text-[var(--text-primary)]"}`} title={hint ? `${value} · ${hint}` : value}>
        {value}
      </div>
      {hint && <div className="truncate text-[9px] font-semibold leading-3 text-[var(--text-tertiary)]">{hint}</div>}
    </div>
  );
}

export function PodiumRow({
  region, index, staff, tlName, weeksOpen, onToggleWeeks, closedOpen, onToggleClosed,
  declinedOpen, onToggleDeclined, onOpenRegion, targetStart, workingDays,
}: PodiumRowProps) {
  const t = region.target;
  const pt = region.periodTarget ?? null;
  const status: TargetStatus = t?.status ?? "critical";
  const tone = TARGET_TONE[status];
  // Headline = FILTER-period consumer attainment (no carry-in, no backlog).
  // Falls back to the since-start ledger only for payloads that predate
  // periodTarget. The ledger status pill + carry badges below keep the backlog
  // visible — the bar itself never mixes October into November.
  const headlinePct = pt ? pt.pct : (t?.attainmentPct ?? 0);
  const animatedPct = useCountUp(headlinePct);
  const headlineAccepted = pt ? pt.accepted : (t?.sinceStart.accepted ?? 0);
  const headlineTarget = pt ? pt.target : (t?.sinceStart.target ?? 0);
  const headlineCaption = pt ? pt.label.toLowerCase() : `since ${startDay0()}`;
  const periodMet = pt ? pt.met : headlinePct >= 100;
  const periodNone = !!pt && pt.target <= 0;
  const periodRail = periodNone
    ? "bg-zinc-400 dark:bg-zinc-600"
    : periodMet ? "bg-emerald-500" : headlinePct >= 60 ? "bg-amber-500" : "bg-rose-500";
  function startDay0(): string {
    const w0 = t?.weeks?.[0]?.weekStart ?? targetStart ?? "";
    return w0 ? fmtDate(w0) : "start";
  }
  const startDay = t?.weeks?.[0]?.weekStart ?? targetStart ?? "";

  return (
    <article
      className={`${CARD} fos-rise ring-1 ring-inset ${tone.ring} transition-shadow duration-200 hover:shadow-[var(--shadow-card-hover)]`}
      style={{ "--i": Math.min(index, 5) } as React.CSSProperties}
      aria-labelledby={`region-${region.id}-name`}
    >
      {/* Rank-1 shimmer band across the top edge. */}
      {region.rank === 1 && (
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden" aria-hidden="true">
          <span className="fos-sweep block h-px w-1/3 bg-gradient-to-r from-transparent via-amber-400/90 to-transparent" />
        </span>
      )}
      {/* Status wash — a soft corner glow instead of a solid fill. */}
      <span className={`pointer-events-none absolute -right-12 -top-12 h-28 w-28 rounded-full blur-2xl ${tone.wash} ${status === "critical" ? "fos-pulse" : ""}`} aria-hidden="true" />

      <div className="relative flex flex-col gap-2 p-2.5 md:p-3 xl:flex-row xl:items-center xl:gap-3.5">
        {/* ── Identity ─────────────────────────────────────────────────── */}
        <div className="flex min-w-0 items-center gap-2.5 xl:w-[15rem] xl:shrink-0">
          <div
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-heading text-[13px] font-extrabold ${medallionClass(region.rank)}`}
            title={`Rank #${region.rank} of the region board`}
          >
            {region.rank}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="rounded border border-indigo-500/30 bg-indigo-500/10 px-1 text-[9px] font-extrabold leading-4 text-indigo-700 dark:text-indigo-300">
                {region.id}
              </span>
              <button
                type="button"
                onClick={onOpenRegion}
                id={`region-${region.id}-name`}
                className={`min-w-0 truncate text-left font-heading text-[14px] font-bold leading-5 text-[var(--text-primary)] transition-colors hover:text-indigo-600 dark:hover:text-indigo-300 ${FOCUS}`}
                title={`${region.name}${region.states.length ? ` · ${region.states.join(", ")}` : ""} — open follow-ups`}
              >
                {region.name}
              </button>
            </div>

            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0 text-[10px] leading-4 text-[var(--text-tertiary)]">
              <span className={`${PILL} py-0 text-[9px] ${tone.chip}`}>
                {status === "critical" && <span className="fos-pulse h-1 w-1 rounded-full bg-rose-500" aria-hidden="true" />}
                {t ? TARGET_STATUS_LABEL[status] : "No ledger"}
              </span>
              {tlName ? (
                <span className="truncate font-semibold text-indigo-600 dark:text-indigo-300" title={`Team Lead covering ${region.id}: ${tlName} — reseller sales here count into their TL total`}>
                  TL · {tlName}
                </span>
              ) : (
                <span className="truncate font-semibold text-[var(--text-secondary)]">{region.tl || "—"}</span>
              )}
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-0.5" title={`${staff.length} roster staff`}>
                <Users className="h-2.5 w-2.5" aria-hidden="true" />
                {staff.length}
              </span>
            </div>
          </div>
        </div>

        {/* ── Filter-period attainment (consumer-only, no carry-in) ──── */}
        <div className="min-w-0 flex-1 border-t border-[var(--border-card)] pt-2 xl:border-l xl:border-t-0 xl:pl-3.5 xl:pt-0">
          <div className="flex items-baseline gap-1.5">
            <span className="font-heading text-base font-bold leading-5 tabular-nums tracking-tight text-[var(--text-primary)]">
              {t || pt ? `${Math.round(animatedPct)}%` : "—"}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
              {pt ? `${pt.prefix} · consumer` : headlineCaption}
            </span>
            <span className="ml-auto whitespace-nowrap font-mono text-[10px] font-semibold text-[var(--text-secondary)]">
              {fmtLakh(headlineAccepted)}
              <span className="text-[var(--text-tertiary)]"> / {fmtLakh(headlineTarget)}</span>
            </span>
          </div>

          {/* Rail: fill = consumer accepted ÷ filter target. Green the moment
              the FILTER target is met — even when the ledger is still red. */}
          <div
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--border-card)]"
            role="progressbar"
            aria-valuenow={Math.round(headlinePct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${region.name} consumer target attainment ${pt ? pt.label.toLowerCase() : headlineCaption}`}
          >
            <span
              className={`block h-full rounded-full ${periodRail} transition-[width] duration-700 ease-out`}
              style={{ width: `${Math.min(100, Math.max(2, headlinePct))}%` }}
            />
          </div>

          {/* Backlog stays visible as badges — never inside the bar. */}
          {t && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-4">
              <span className="whitespace-nowrap font-mono font-semibold text-[var(--text-secondary)]">
                {pt ? `${pt.prefix} ${fmtLakh(pt.accepted)}` : `wk ${fmtLakh(t.weekAccepted)}`}
                <span className="text-[var(--text-tertiary)]"> / {fmtLakh(pt ? pt.target : t.weekDue)} target</span>
              </span>
              {periodNone && (
                <span className={`${PILL} py-0 text-[9px] border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400`}>no working days</span>
              )}
              {!periodNone && periodMet && (
                <span className={`${PILL} py-0 text-[9px] border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300`}>✓ {pt ? pt.label : "week"} met</span>
              )}
              {t.carryIn > 0 && (
                <span className={`${PILL} py-0 text-[9px] border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300`} title="Unmet target carried into this week from earlier weeks">
                  ↩ {fmtLakh(t.carryIn)} backlog
                </span>
              )}
              {t.carryOut > 0 ? (
                <span className={`${PILL} py-0 text-[9px] border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300`} title="Shortfall that carries into next week">
                  → {fmtLakh(t.carryOut)} out
                </span>
              ) : (
                <span className={`${PILL} py-0 text-[9px] border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300`}>✓ ledger cleared</span>
              )}
              {pt && pt.unclassifiedCount > 0 && (
                <span className={`${PILL} py-0 text-[9px] border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300`} title="Accepted ₹ waiting for a consumer/reseller decision — excluded from the bar until reviewed">
                  ? {pt.unclassifiedCount} unclassified · {fmtLakh(pt.unclassifiedValue)}
                </span>
              )}
              <span className="whitespace-nowrap text-[var(--text-tertiary)]" title="Since-start ledger (backlog included)">
                ledger {fmtLakh(t.sinceStart.accepted)} / {fmtLakh(t.sinceStart.target)}
              </span>
            </div>
          )}
        </div>

        {/* ── Period stats (money on the region row, never per agent) ──── */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-[var(--border-card)] pt-2 sm:grid-cols-4 xl:w-[18rem] xl:shrink-0 xl:border-l xl:border-t-0 xl:pl-3.5 xl:pt-0">
          {/* The Won figure IS the door to the closed list — click the number
              that the list explains. */}
          <button
            type="button"
            onClick={onToggleClosed}
            aria-expanded={closedOpen}
            className={`group min-w-0 rounded text-left ${FOCUS}`}
            title={closedOpen ? "Hide the closed estimates" : `Show the ${region.won.count} closed estimates`}
          >
            <div className="flex items-center gap-0.5 text-[9px] font-bold uppercase leading-3 tracking-[0.07em] text-[var(--text-tertiary)]">
              Won
              <ChevronDown className={`h-2.5 w-2.5 transition-transform duration-200 ${closedOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            </div>
            <div className="truncate font-mono text-[12px] font-bold leading-4 text-emerald-600 underline-offset-2 group-hover:underline dark:text-emerald-400">
              {region.won.count}
            </div>
            <div className="truncate text-[9px] font-semibold leading-3 text-[var(--text-tertiary)]">{fmtLakh(region.won.value)}</div>
            {region.wonSplit && (region.wonSplit.reseller.value > 0 || region.wonSplit.unclassified.value > 0) && (
              <div
                className="truncate text-[9px] font-semibold leading-3 text-[var(--text-tertiary)]"
                title={`Consumer ${fmtLakh(region.wonSplit.consumer.value)} · Reseller ${fmtLakh(region.wonSplit.reseller.value)} · Unclassified ${fmtLakh(region.wonSplit.unclassified.value)} — only consumer ₹ counts toward the ₹1L target`}
              >
                cons {fmtLakh(region.wonSplit.consumer.value)}
                {region.wonSplit.reseller.value > 0 && <span> · res {fmtLakh(region.wonSplit.reseller.value)}</span>}
                {region.wonSplit.unclassified.value > 0 && <span> · ? {fmtLakh(region.wonSplit.unclassified.value)}</span>}
              </div>
            )}
          </button>
          {/* Loss side of the same period — same door pattern as Won. */}
          <button
            type="button"
            onClick={onToggleDeclined}
            aria-expanded={declinedOpen}
            className={`group min-w-0 rounded text-left ${FOCUS}`}
            title={declinedOpen ? "Hide the declined estimates" : `Show the ${region.declined.count} declined estimates`}
          >
            <div className="flex items-center gap-0.5 text-[9px] font-bold uppercase leading-3 tracking-[0.07em] text-[var(--text-tertiary)]">
              Declined
              <ChevronDown className={`h-2.5 w-2.5 transition-transform duration-200 ${declinedOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            </div>
            <div className="truncate font-mono text-[12px] font-bold leading-4 text-rose-600 underline-offset-2 group-hover:underline dark:text-rose-400">
              {region.declined.count}
            </div>
            <div className="truncate text-[9px] font-semibold leading-3 text-[var(--text-tertiary)]">{fmtLakh(region.declined.value)}</div>
          </button>
          <Stat label="Points" value={fmtNum(region.points)} hint="slabs + effort" tone="text-indigo-600 dark:text-indigo-300" />
          <Stat label="Calls·leads" value={`${fmtNum(region.callsConnected)}·${fmtNum(region.leadsGenerated)}`} hint="connected·new" />
        </div>

        {/* ── Actions ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-1 border-t border-[var(--border-card)] pt-2 xl:border-t-0 xl:pt-0">
          {t && (
            <button
              type="button"
              onClick={onToggleWeeks}
              aria-expanded={weeksOpen}
              className={ICON_BTN}
              title={weeksOpen ? "Hide the week-by-week carry ledger" : "Show the week-by-week carry ledger"}
            >
              <BookOpen className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">Week ledger</span>
            </button>
          )}
          <button
            type="button"
            onClick={onToggleClosed}
            aria-expanded={closedOpen}
            className={`${ICON_BTN} ${closedOpen ? "border-emerald-400/60 text-emerald-600 dark:text-emerald-400" : ""}`}
            title={closedOpen ? "Hide the closed estimates" : `Show what ${region.name} closed`}
          >
            <Receipt className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">Closed estimates</span>
          </button>
          <button type="button" onClick={onOpenRegion} className={ICON_BTN} title={`Open ${region.name} pipeline`}>
            <Target className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">Follow-ups</span>
          </button>
        </div>
      </div>

      {/* ── Closed estimates (what the Won number is made of) ─────────── */}
      {closedOpen && (
        <div className="px-2.5 pb-2.5 md:px-3">
          <ClosedEstimates
            items={region.acceptedItems ?? []}
            totalCount={region.won.count}
            totalValue={region.won.value}
            regionName={region.name}
            resellerNote={tlName ? `counts to TL ${tlName}` : "counts to the TL total"}
          />
        </div>
      )}

      {/* ── Declined estimates (what the Declined number is made of) ───── */}
      {declinedOpen && (
        <div className="px-2.5 pb-2.5 md:px-3">
          <DeclinedEstimates
            items={region.declinedItems ?? []}
            totalCount={region.declined.count}
            totalValue={region.declined.value}
            regionName={region.name}
          />
        </div>
      )}

      {/* ── The ledger drawer ─────────────────────────────────────────── */}
      {weeksOpen && t && (
        <div className="px-2.5 pb-2.5 md:px-3">
          <WeekLedger target={t} regionName={region.name} />
        </div>
      )}

      {/* ── Always-open telecaller children ───────────────────────────── */}
      <StaffRail
        staff={staff}
        regionId={region.id}
        regionName={region.name}
        workingDays={workingDays}
        tlName={tlName}
      />
    </article>
  );
}

export default PodiumRow;
