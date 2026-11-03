"use client";

// MetricStrip — the four headline tiles above the podium.
//
// Every figure comes from the payload: `kpi` (accepted cohort split) and
// `meta.teamTarget` (the server-computed carry ledger). Nothing is re-derived
// here — if a number is missing we show an em dash, never a guess.

import React from "react";
import { PhoneCall, Sparkles, Target, Timer, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BoardKpi } from "@/telecalling/view-types";
import type { TeamTarget, TargetStatus } from "@/telecalling/targets";
import { TARGET_STATUS_LABEL } from "@/telecalling/targets";
import { fmtDate, fmtLakh, fmtNum, fmtTalk } from "@/telecalling/format";
import { TARGET_TONE } from "@/telecalling/tone";
import { useCountUp } from "@/telecalling/useCountUp";
import { CARD, LABEL, NUM, PILL } from "./surface";

export interface MetricStripProps {
  kpi?: BoardKpi;
  teamTarget?: TeamTarget | null;
  loading?: boolean;
}

const TILE = `${CARD} p-3`;

function ValueTile({
  index, icon: Icon, label, children, accent = "bg-indigo-500",
}: {
  index: number;
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className={`${TILE} fos-rise`} style={{ "--i": index } as React.CSSProperties}>
      <span className={`absolute inset-y-0 left-0 w-[3px] ${accent}`} aria-hidden="true" />
      <div className="flex items-center gap-1.5 pl-1">
        <Icon className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden="true" />
        <span className={LABEL}>{label}</span>
      </div>
      <div className="pl-1">{children}</div>
    </div>
  );
}

export function MetricStrip({ kpi, teamTarget, loading = false }: MetricStripProps) {
  const accepted = Number(kpi?.acceptedValue ?? 0);
  const animatedAccepted = useCountUp(accepted);
  const won = Number(kpi?.won ?? 0);

  const regionWon = Number(kpi?.regionWon ?? 0);
  const regionValue = Number(kpi?.regionValue ?? 0);
  const directWon = Number(kpi?.directWon ?? 0);
  const directValue = Number(kpi?.directValue ?? 0);
  const unlinkedWon = Number(kpi?.unlinkedWon ?? 0);
  const unlinkedValue = Number(kpi?.unlinkedValue ?? 0);

  const pctOf = (n: number) => (accepted > 0 ? Math.max(0, Math.min(100, (n / accepted) * 100)) : 0);
  const regionPct = pctOf(regionValue);
  const directPct = pctOf(directValue);
  const unlinkedPct = pctOf(unlinkedValue);

  // Filter-period team bar (consumer-only, no carry-in): the number the tiles
  // go green on. Falls back to the week ledger for payloads that predate it.
  // Tile 2 IS this number — the "team target" always means the SELECTED
  // filter's start→end date. The since-start ledger (with backlog) survives
  // only as the caption underneath (the fixed "This week" tile was removed
  // 2026-11-03 — it never moved with the filter; backlog lives on each row
  // and in the WeekLedger drawer).
  const hasPeriod = teamTarget != null && teamTarget.periodTarget !== undefined;
  const periodLabel = teamTarget?.periodLabel ?? "This week";
  const periodTarget = Number(hasPeriod ? teamTarget?.periodTarget ?? 0 : teamTarget?.weekTarget ?? 0);
  const periodAccepted = Number(hasPeriod ? teamTarget?.periodAccepted ?? 0 : teamTarget?.weekAccepted ?? 0);
  const periodPct = hasPeriod
    ? Number(teamTarget?.periodPct ?? 0)
    : (periodTarget > 0 ? Math.round((periodAccepted / periodTarget) * 100) : 0);
  const periodMet = periodTarget > 0 ? periodAccepted >= periodTarget : periodAccepted > 0;
  const periodNone = hasPeriod && periodTarget <= 0;
  const periodUnclassified = Number(teamTarget?.periodUnclassifiedValue ?? 0);
  const animatedPeriod = useCountUp(periodPct);
  const periodStatus: TargetStatus = periodNone ? "critical" : periodMet ? "cleared" : periodPct >= 60 ? "behind" : "critical";
  const periodTone = TARGET_TONE[periodStatus];

  return (
    <div className={`grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 ${loading ? "opacity-70 transition-opacity" : "transition-opacity"}`} aria-busy={loading}>
      {/* 1 — the whole acceptance cohort, with the split explained underneath. */}
      <ValueTile index={0} icon={Wallet} label="Accepted ₹" accent="bg-indigo-500">
        <div className={`mt-0.5 text-xl ${NUM}`} title={`${fmtNum(Math.round(animatedAccepted))} accepted`}>
          {fmtNum(Math.round(animatedAccepted))}
        </div>
        <div className="mt-1 flex items-baseline gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
          <span className="font-mono">{won}</span>
          <span className="text-[var(--text-tertiary)]">accepted estimates</span>
        </div>

        {/* Cohort split — why the region rows never add up to this total. */}
        <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-[var(--border-card)]" role="img" aria-label={`Regions ${fmtLakh(regionValue)}, Sales Head ${fmtLakh(directValue)}, unlinked ${fmtLakh(unlinkedValue)}`}>
          <span className="h-full bg-indigo-500 transition-[width] duration-700 ease-out" style={{ width: `${regionPct}%` }} />
          <span className="h-full bg-violet-500 transition-[width] duration-700 ease-out" style={{ width: `${directPct}%` }} />
          <span className="h-full bg-amber-500 transition-[width] duration-700 ease-out" style={{ width: `${unlinkedPct}%` }} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />Regions {fmtLakh(regionValue)}</span>
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-violet-500" />Head {fmtLakh(directValue)}</span>
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Unlinked {fmtLakh(unlinkedValue)}</span>
        </div>
        {kpi?.consumerValue !== undefined && (
          <div className="mt-1 text-[10px] font-semibold text-[var(--text-tertiary)]" title="Only end-consumer ₹ counts toward the ₹1L/day target — reseller and unclassified rows are excluded until reviewed">
            Consumer {fmtLakh(Number(kpi.consumerValue ?? 0))}
            {Number(kpi.resellerValue ?? 0) > 0 && <span> · Reseller {fmtLakh(Number(kpi.resellerValue ?? 0))}</span>}
            {Number(kpi.unclassifiedValue ?? 0) > 0 && <span> · ? {fmtLakh(Number(kpi.unclassifiedValue ?? 0))} unclassified</span>}
          </div>
        )}
      </ValueTile>

      {/* 2 — team target for the SELECTED filter (consumer-only, no backlog). */}
      <ValueTile index={1} icon={Target} label={`Team target · ${hasPeriod ? periodLabel : "since start"}`} accent={periodTone.rail}>
        <div className="mt-1 flex items-baseline gap-2">
          <span className={`text-xl ${NUM}`}>
            {teamTarget ? `${Math.round(animatedPeriod)}%` : "—"}
          </span>
          {teamTarget && (
            <span className={`${PILL} ${periodTone.chip}`}>{TARGET_STATUS_LABEL[periodStatus]}</span>
          )}
        </div>
        <div className="mt-1 text-[11px] font-semibold text-[var(--text-secondary)]">
          {teamTarget
            ? `${fmtLakh(periodAccepted)} of ${fmtLakh(periodTarget)} consumer`
            : "Ledger unavailable"}
        </div>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--border-card)]"
          role="progressbar"
          aria-valuenow={Math.round(periodPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Team target attainment ${periodLabel}`}
        >
          <span className={`block h-full rounded-full ${periodTone.rail} transition-[width] duration-700 ease-out`} style={{ width: `${Math.min(100, Math.max(2, periodPct))}%` }} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
          {teamTarget
            ? <span>Ledger {fmtLakh(teamTarget.sinceStartAccepted)} / {fmtLakh(teamTarget.sinceStartTarget)} since {fmtDate(teamTarget.targetStart)}</span>
            : <span>&nbsp;</span>}
          {periodUnclassified > 0 && (
            <span className={`${PILL} border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300`} title="Accepted ₹ waiting for a consumer/reseller decision — excluded until reviewed">
              ? {fmtLakh(periodUnclassified)} unclassified
            </span>
          )}
        </div>
      </ValueTile>

      {/* 3 — activity micro-group (calls / leads / talk). */}
      <ValueTile index={2} icon={PhoneCall} label="Activity" accent="bg-sky-500">
        <div className="mt-1 grid grid-cols-3 gap-2">
          <div>
            <div className={`text-base ${NUM}`}>{fmtNum(Number(kpi?.callsConnected ?? 0))}</div>
            <div className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
              <PhoneCall className="h-3 w-3" aria-hidden="true" /> Calls
            </div>
          </div>
          <div>
            <div className={`text-base ${NUM}`}>{fmtNum(Number(kpi?.leadsGenerated ?? 0))}</div>
            <div className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
              <Sparkles className="h-3 w-3" aria-hidden="true" /> Leads
            </div>
          </div>
          <div>
            <div className={`text-base ${NUM}`}>{fmtTalk(Number(kpi?.talkTimeSec ?? 0))}</div>
            <div className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
              <Timer className="h-3 w-3" aria-hidden="true" /> Talk
            </div>
          </div>
        </div>
        <div className="mt-1.5 text-[10px] font-semibold text-[var(--text-tertiary)]">
          Connected calls · new leads · talk time this period
        </div>
      </ValueTile>
    </div>
  );
}

export default MetricStrip;
