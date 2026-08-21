"use client";

import React, { useRef } from "react";
import type { FilterRule } from "./types";

export interface KpiCardConfig {
  field: string;
  label: string;
  negLabel: string;
  count: number;
  accent: string; // tailwind color token base e.g. "indigo"
}

interface Props {
  totalCount: number;
  totalValue: number;
  notAnsweringCount: number;
  kpiCards: KpiCardConfig[];
  filters: FilterRule[];
  inverted: Record<string, boolean>;
  onCardClick: (field: string) => void;
  onCardDoubleClick: (field: string) => void;
}

const ACCENT_RINGS: Record<string, string> = {
  emerald: "border-emerald-500/60 ring-2 ring-emerald-500/30",
  rose: "border-rose-500/60 ring-2 ring-rose-500/30",
  amber: "border-amber-500/60 ring-2 ring-amber-500/30",
  orange: "border-orange-500/60 ring-2 ring-orange-500/30",
  indigo: "border-indigo-500/60 ring-2 ring-indigo-500/30",
  violet: "border-violet-500/60 ring-2 ring-violet-500/30",
  cyan: "border-cyan-500/60 ring-2 ring-cyan-500/30",
  blue: "border-blue-500/60 ring-2 ring-blue-500/30",
  teal: "border-teal-500/60 ring-2 ring-teal-500/30",
};

export default function KpiCards({
  totalCount,
  totalValue,
  notAnsweringCount,
  kpiCards,
  filters,
  inverted,
  onCardClick,
  onCardDoubleClick,
}: Props) {
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = (field: string) => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => onCardClick(field), 260);
  };

  const handleDoubleClick = (field: string) => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = null;
    onCardDoubleClick(field);
  };

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
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-indigo400">
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
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-emerald400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
          </div>
        </div>
        <div className="group relative overflow-hidden bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-4 shadow-sm hover:border-rose-500/40 hover:shadow-lg hover:shadow-rose-500/5 hover:-translate-y-0.5 transition-all duration-300">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-rose-500 to-orange-500" />
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">Not Answering</span>
              <span className="text-2xl font-bold text-rose-600 dark:text-rose-rose400 block">{notAnsweringCount}</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600 dark:text-rose-rose400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M16 17l-4 4m0 0l-4-4m4 4V3" /></svg>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
        {kpiCards.map((k) => {
          const active = isActive(k.field);
          const isInverted = !!inverted[k.field];
          const ring = active ? ACCENT_RINGS[k.accent] || ACCENT_RINGS.indigo : "border-zinc-200/80 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700";
          return (
            <button
              key={k.field}
              type="button"
              onClick={() => handleClick(k.field)}
              onDoubleClick={() => handleDoubleClick(k.field)}
              title={`Click: filter ${k.label}. Double-click: ${k.negLabel}.`}
              className={`group relative overflow-hidden bg-zinc-50 dark:bg-zinc-900 border rounded-xl p-2.5 text-left shadow-sm transition-all duration-200 cursor-pointer ${ring} ${active ? "bg-zinc-50 dark:bg-zinc-900" : "hover:-translate-y-0.5"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-bold text-zinc-900 dark:text-white leading-none">{k.count}</span>
                {active && <span className="text-[8px] font-extrabold uppercase tracking-wide text-indigo-600 dark:text-indigo-indigo300 bg-indigo-500/10 border border-indigo-500/30 rounded px-1 py-0.5">Active</span>}
              </div>
              <span className="block text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold mt-1 leading-tight">
                {isInverted ? k.negLabel : k.label}
              </span>
              <span className="block text-[9px] text-zinc-500 dark:text-zinc-600 mt-0.5 font-medium">
                {isInverted ? "double-click for " + k.label : "double-click for " + k.negLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}