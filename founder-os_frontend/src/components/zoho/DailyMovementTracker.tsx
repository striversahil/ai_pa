"use client";

import React from "react";

export interface RangeTiles {
  salesOrders: { count: number; totalValue: number };
  declined: { count: number; totalValue: number };
  newEstimates: { count: number; totalValue: number };
}

export interface MovementRow {
  kind: "so" | "declined" | "new";
  key: string;
  badge: string;
  badgeCls: string;
  primary: string;
  customer: string;
  total: number;
  meta?: string;
  lines?: string[];
}

export type RangePreset = "today" | "week" | "days30" | "month" | "custom";

interface Props {
  from: string;
  to: string;
  preset: RangePreset;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onPreset: (p: Exclude<RangePreset, "custom">) => void;
  tiles: RangeTiles;
  rows: MovementRow[];
  caption: string;
  captionPending?: boolean;
  loading?: boolean;
}

const PRESETS: { id: Exclude<RangePreset, "custom">; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "7 days" },
  { id: "days30", label: "30 days" },
  { id: "month", label: "This month" },
];

export default function DailyMovementTracker({ from, to, preset, onFromChange, onToChange, onPreset, tiles, rows, caption, captionPending, loading }: Props) {
  return (
    <div className="bg-zinc-50/30 dark:bg-zinc-950/30 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-4 space-y-4 mb-6">
      <div className="flex flex-col gap-2 border-b border-zinc-200/60 dark:border-zinc-800/60 pb-3">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div>
            <h4 className="text-xs font-bold text-zinc-900 dark:text-white flex items-center gap-1.5">
              <span>📈</span> Daily Status Movement Tracker
            </h4>
            <p className={`text-[10px] mt-0.5 ${captionPending ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-zinc-600 dark:text-zinc-500"}`}>
              {caption}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => onPreset(p.id)}
                className={`px-2.5 py-1 rounded-full border text-[11px] font-bold transition-colors cursor-pointer ${preset === p.id ? "bg-indigo-500/15 text-indigo-500 dark:text-indigo-300 border-indigo-500/40" : "bg-zinc-100/60 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 border-zinc-300/60 dark:border-zinc-700/60"}`}
              >
                {p.label}
              </button>
            ))}
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => e.target.value && onFromChange(e.target.value)}
              className="bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800 px-2 py-1 rounded-lg text-[11px] cursor-pointer"
              aria-label="From date"
            />
            <span className="text-[11px] text-zinc-500">→</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => e.target.value && onToChange(e.target.value)}
              className="bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800 px-2 py-1 rounded-lg text-[11px] cursor-pointer"
              aria-label="To date"
            />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-emerald-950/10 border border-emerald-900/20 p-2.5 rounded-lg text-center">
          <span className="text-[9px] text-emerald-500 font-bold uppercase tracking-wider block">SO Created</span>
          <span className="text-base font-bold text-emerald-400 font-mono mt-0.5 block">
            {loading ? "…" : tiles.salesOrders.count} <span className="text-[10px] text-zinc-600 dark:text-zinc-500">(₹{(tiles.salesOrders.totalValue || 0).toLocaleString()})</span>
          </span>
        </div>
        <div className="bg-rose-950/10 border border-rose-900/20 p-2.5 rounded-lg text-center">
          <span className="text-[9px] text-rose-500 font-bold uppercase tracking-wider block">Declined</span>
          <span className="text-base font-bold text-rose-400 font-mono mt-0.5 block">
            {tiles.declined.count} <span className="text-[10px] text-zinc-600 dark:text-zinc-500">(₹{(tiles.declined.totalValue || 0).toLocaleString()})</span>
          </span>
        </div>
        <div className="bg-indigo-950/10 border border-indigo-900/20 p-2.5 rounded-lg text-center">
          <span className="text-[9px] text-indigo-500 font-bold uppercase tracking-wider block">New Estimates</span>
          <span className="text-base font-bold text-indigo-400 font-mono mt-0.5 block">
            {tiles.newEstimates.count} <span className="text-[10px] text-zinc-600 dark:text-zinc-500">(₹{(tiles.newEstimates.totalValue || 0).toLocaleString()})</span>
          </span>
        </div>
      </div>

      <div className="bg-zinc-50/40 dark:bg-zinc-950/40 border border-zinc-200/80 dark:border-zinc-800/80 p-3 rounded-xl">
        {rows.length > 0 ? (
          <>
            <span className="text-[9px] text-zinc-600 dark:text-zinc-500 font-bold uppercase tracking-wider block mb-1.5">Movements in range</span>
            <div className="space-y-2 max-h-60 overflow-y-auto divide-y divide-zinc-200/40 dark:divide-zinc-800/40 pr-1 scrollbar-thin">
              {rows.map((r) => (
                <div key={r.key} className="py-2 border-b border-zinc-200/40 dark:border-zinc-800/40 text-[11px] space-y-1 text-left">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`px-1.5 py-0.5 text-[8px] rounded font-extrabold uppercase tracking-wide border ${r.badgeCls}`}>{r.badge}</span>
                    <span className="text-zinc-800 dark:text-zinc-200 font-mono font-bold">{r.primary}</span>
                    {r.meta && <span className="text-zinc-500 dark:text-zinc-400 font-mono text-[10px]">{r.meta}</span>}
                    <span className="text-zinc-800 dark:text-zinc-200 font-semibold truncate max-w-[140px] sm:max-w-[180px]">{r.customer}</span>
                    <span className="text-zinc-500 dark:text-zinc-400 font-mono ml-auto">₹{Number(r.total).toLocaleString()}</span>
                  </div>
                  {(r.lines ?? []).map((line, i) => (
                    <div key={i} className="text-[10px] text-zinc-500 dark:text-zinc-400 pl-4 italic leading-relaxed">{line}</div>
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-xs text-zinc-600 dark:text-zinc-500 italic py-2 text-center">
            {loading ? "Loading movements…" : "No sales orders or estimate movements in this range."}
          </div>
        )}
      </div>
    </div>
  );
}
