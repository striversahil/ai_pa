"use client";

import React from "react";
import type { FilterRule } from "./types";
import { FileText, IndianRupee, PhoneOff, Filter } from "lucide-react";

export interface KpiCardConfig {
  field: string;
  label: string;
  negLabel: string;
  count: number;
  accent: string;
  polarity: "good" | "bad";
}

interface Props {
  totalCount: number;
  totalValue: number;
  notAnsweringCount: number;
  kpiCards: KpiCardConfig[];
  filters: FilterRule[];
  inverted: Record<string, boolean>;
  onCardClick: (field: string) => void;
}

const ACTIVE_RING = {
  good: "border-emerald-500/70 ring-2 ring-emerald-500/40 bg-emerald-500/10",
  bad: "border-amber-500/70 ring-2 ring-amber-500/40 bg-amber-500/10",
} as const;

const BADGE = {
  good: "text-emerald-300 bg-emerald-500/20 border-emerald-500/40",
  bad: "text-amber-300 bg-amber-500/20 border-amber-500/40",
} as const;

export default function KpiCards({
  totalCount,
  totalValue,
  notAnsweringCount,
  kpiCards,
  filters,
  inverted,
  onCardClick,
}: Props) {
  const isActive = (field: string) => filters.some((f) => f.field === field);

  return (
    <div className="space-y-4">
      {/* Top Main KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#111726]/80 p-5 shadow-xl backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-500/40 hover:shadow-2xl hover:shadow-indigo-500/10">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                Active Sent Estimates
              </span>
              <span className="text-3xl font-extrabold text-white block">
                {totalCount}
              </span>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <FileText className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#111726]/80 p-5 shadow-xl backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-emerald-500/40 hover:shadow-2xl hover:shadow-emerald-500/10">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                Cumulative Pipeline Value
              </span>
              <span className="text-3xl font-extrabold text-white block">
                ₹{totalValue.toLocaleString()}
              </span>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <IndianRupee className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#111726]/80 p-5 shadow-xl backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-rose-500/40 hover:shadow-2xl hover:shadow-rose-500/10">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-rose-500 to-orange-500" />
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                Unresponsive Leads
              </span>
              <span className="text-3xl font-extrabold text-rose-400 block">
                {notAnsweringCount}
              </span>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <PhoneOff className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* Filterable Sub-KPI Pills */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {kpiCards.map((k) => {
          const active = isActive(k.field);
          const isInverted = !!inverted[k.field];
          const effectiveCount = isInverted
            ? Math.max(0, totalCount - k.count)
            : k.count;
          const effectiveGood = isInverted ? k.polarity === "bad" : k.polarity === "good";
          const tone = effectiveGood ? "good" : "bad";
          const ring = active
            ? ACTIVE_RING[tone]
            : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10";

          return (
            <button
              key={k.field}
              type="button"
              onClick={() => onCardClick(k.field)}
              title={`Click: filter ${k.label}. Click again: reverse (${k.negLabel}). Third: clear.`}
              className={`group relative overflow-hidden rounded-2xl border p-3 text-left shadow-lg backdrop-blur-md transition-all duration-200 cursor-pointer ${ring} ${
                active ? "" : "hover:-translate-y-0.5"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-lg font-extrabold text-white leading-none tabular-nums">
                  {effectiveCount}
                </span>
                {active && (
                  <span
                    className={`text-[8px] font-extrabold uppercase tracking-wide rounded-md px-1.5 py-0.5 border ${BADGE[tone]}`}
                  >
                    {isInverted ? "Reversed" : "Active"}
                  </span>
                )}
              </div>
              <span className="block text-[11px] text-zinc-300 font-bold mt-1.5 leading-tight truncate">
                {isInverted ? k.negLabel : k.label}
              </span>
              <span
                className={`block text-[9px] mt-1 font-medium ${
                  active
                    ? effectiveGood
                      ? "text-emerald-400"
                      : "text-amber-400"
                    : "text-zinc-500"
                }`}
              >
                {active
                  ? isInverted
                    ? "Click to clear"
                    : "Click to reverse"
                  : "Click to filter"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
