"use client";

import React from "react";
import type { FilterRule } from "./types";

export interface KpiCardConfig {
  field: string;
  label: string;
  negLabel: string;
  count: number;
  accent: string; // tailwind color token base e.g. "indigo"
  polarity: "good" | "bad"; // drives green/orange when active
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
  good: "border-emerald-500/70 ring-2 ring-emerald-500/40",
  bad: "border-orange-500/70 ring-2 ring-orange-500/40",
} as const;

const BADGE = {
  good: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  bad: "text-orange-300 bg-orange-500/10 border-orange-500/30",
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
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="group relative overflow-hidden bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-4 shadow-sm hover:border-indigo-500/40 hover:shadow-lg hover:shadow-indigo-500/5 hover:-translate-y-0.5 transition-all duration-300">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-indigo-500 to-violet-500" />
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Active Sent Estimates</span>
              <span className="text-2xl font-bold text-zinc-900 dark:text-white block">{totalCount}</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </div>
          </div>
        </div>
        <div className="group relative overflow-hidden bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-4 shadow-sm hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5 hover:-translate-y-0.5 transition-all duration-300">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Cumulative Value</span>
              <span className="text-2xl font-bold text-zinc-900 dark:text-white block">₹{totalValue.toLocaleString()}</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
          </div>
        </div>
        <div className="group relative overflow-hidden bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-4 shadow-sm hover:border-rose-500/40 hover:shadow-lg hover:shadow-rose-500/5 hover:-translate-y-0.5 transition-all duration-300">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-rose-500 to-orange-500" />
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Not Answering</span>
              <span className="text-2xl font-bold text-rose-400 block">{notAnsweringCount}</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M16 17l-4 4m0 0l-4-4m4 4V3" /></svg>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
        {kpiCards.map((k) => {
          const active = isActive(k.field);
          const isInverted = !!inverted[k.field];
          // When reversed the card shows the complement of its category count
          // (e.g. Not Answering 20 of 50 → Answering 30).
          const effectiveCount = isInverted
            ? Math.max(0, totalCount - k.count)
            : k.count;
          // Effective polarity flips when reversed: a good card shown reversed
          // means "filter the bad ones" → orange, and vice-versa.
          const effectiveGood = isInverted ? k.polarity === "bad" : k.polarity === "good";
          const tone = effectiveGood ? "good" : "bad";
          const ring = active
            ? ACTIVE_RING[tone]
            : "border-zinc-200/80 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700";
          return (
            <button
              key={k.field}
              type="button"
              onClick={() => onCardClick(k.field)}
              title={`Click: filter ${k.label}. Click again: reverse (${k.negLabel}). Click a third time: clear.`}
              className={`group relative overflow-hidden bg-zinc-50 dark:bg-zinc-900 border rounded-xl p-2.5 text-left shadow-sm transition-all duration-200 cursor-pointer ${ring} ${active ? "" : "hover:-translate-y-0.5"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-bold text-zinc-900 dark:text-white leading-none tabular-nums">{effectiveCount}</span>
                {active && (
                  <span className={`text-[8px] font-extrabold uppercase tracking-wide rounded px-1 py-0.5 border ${BADGE[tone]}`}>
                    {isInverted ? "Reversed" : "Active"}
                  </span>
                )}
              </div>
              <span className="block text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold mt-1 leading-tight">
                {isInverted ? k.negLabel : k.label}
              </span>
              <span className={`block text-[9px] mt-0.5 font-medium ${active ? (effectiveGood ? "text-emerald-500/80 dark:text-emerald-400/80" : "text-orange-500/80 dark:text-orange-400/80") : "text-zinc-500 dark:text-zinc-600"}`}>
                {active ? (isInverted ? "click to clear" : "click to reverse") : "click to filter"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
