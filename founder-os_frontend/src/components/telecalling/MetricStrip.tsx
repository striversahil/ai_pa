"use client";

// MetricStrip — the four headline tiles above the podium.
//
// Every figure comes from the payload: `kpi` (accepted cohort split) and
// `meta.teamTarget` (the server-computed carry ledger). Nothing is re-derived
// here — if a number is missing we show an em dash, never a guess.

import React from "react";
import { PhoneCall, Sparkles, Target, Timer, TrendingUp, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BoardKpi } from "@/telecalling/view-types";
import type { TeamTarget } from "@/telecalling/targets";
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

  const attainmentPct = teamTarget && teamTarget.sinceStartTarget > 0
    ? Math.round((teamTarget.sinceStartAccepted / teamTarget.sinceStartTarget) * 100)
    : 0;
  const animatedPct = useCountUp(attainmentPct);
  const targetTone = TARGET_TONE[teamTarget?.status ?? "critical"];

  const weekDue = Number(teamTarget?.due ?? 0);
  const weekAccepted = Number(teamTarget?.weekAccepted ?? 0);
  const weekPct = weekDue > 0 ? Math.max(0, Math.min(100, (weekAccepted / weekDue) * 100)) : 0;
  const carryIn = Number(teamTarget?.carryIn ?? 0);

  return (
    <div className={`grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4 ${loading ? "opacity-70 transition-opacity" : "transition-opacity"}`} aria-busy={loading}>
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
      </ValueTile>

      {/* 2 — team target = the sum of the four region targets (₹4L/day). */}
      <ValueTile index={1} icon={Target} label="Team target · since start" accent={targetTone.rail}>
        <div className="mt-1 flex items-baseline gap-2">
          <span className={`text-xl ${NUM}`}>
            {teamTarget ? `${Math.round(animatedPct)}%` : "—"}
          </span>
          {teamTarget && (
            <span className={`${PILL} ${targetTone.chip}`}>{TARGET_STATUS_LABEL[teamTarget.status]}</span>
          )}
        </div>
        <div className="mt-1 text-[11px] font-semibold text-[var(--text-secondary)]">
          {teamTarget
            ? `${fmtLakh(teamTarget.sinceStartAccepted)} of ${fmtLakh(teamTarget.sinceStartTarget)} owed`
            : "Ledger unavailable"}
        </div>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--border-card)]"
          role="progressbar"
          aria-valuenow={attainmentPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Team target attainment since the ledger start"
        >
          <span className={`block h-full rounded-full ${targetTone.rail} transition-[width] duration-700 ease-out`} style={{ width: `${Math.min(100, Math.max(2, attainmentPct))}%` }} />
        </div>
        <div className="mt-1.5 text-[10px] font-semibold text-[var(--text-tertiary)]">
          {teamTarget ? `Start ${fmtDate(teamTarget.targetStart)} · ₹${fmtNum(teamTarget.teamPerDay)}/day team` : "\u00A0"}
        </div>
      </ValueTile>

      {/* 3 — this week: accepted vs due (carried backlog included). */}
      <ValueTile index={2} icon={TrendingUp} label="This week" accent={weekPct >= 100 ? "bg-emerald-500" : weekPct >= 60 ? "bg-amber-500" : "bg-rose-500"}>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className={`text-xl ${NUM}`}>{fmtLakh(weekAccepted)}</span>
          <span className="text-[11px] font-semibold text-[var(--text-tertiary)]">/ {fmtLakh(weekDue)} due</span>
        </div>
        <div className="mt-1 text-[11px] font-semibold text-[var(--text-secondary)]">
          {teamTarget?.weekFrom ? `${fmtLakh(teamTarget.weekTarget)} accrued so far` : "No active week"}
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--border-card)]" role="progressbar" aria-valuenow={Math.round(weekPct)} aria-valuemin={0} aria-valuemax={100} aria-label="This week accepted against due">
          <span className={`block h-full rounded-full ${weekPct >= 100 ? "bg-emerald-500" : weekPct >= 60 ? "bg-amber-500" : "bg-rose-500"} transition-[width] duration-700 ease-out`} style={{ width: `${Math.max(2, Math.min(100, weekPct))}%` }} />
        </div>
        <div className="mt-1.5">
          {carryIn > 0 ? (
            <span className={`${PILL} border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300`} title="Unmet target carried into this week">
              ↩ {fmtLakh(carryIn)} carried in
            </span>
          ) : (
            <span className={`${PILL} border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300`}>
              ✓ no backlog carried
            </span>
          )}
        </div>
      </ValueTile>

      {/* 4 — activity micro-group (calls / leads / talk). */}
      <ValueTile index={3} icon={PhoneCall} label="Activity" accent="bg-sky-500">
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
