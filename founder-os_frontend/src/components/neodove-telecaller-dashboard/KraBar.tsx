"use client";

// Extracted verbatim from NeodoveTelecallerDashboard.tsx by scripts/refactor/split-module.mjs.
// NeodoveTelecallerDashboard.tsx re-exports everything public here, so existing imports keep working.
import type { TrafficLight } from "./types";
import { LIGHT_TEXT, LIGHT_BG } from "./helpers";

export function KraBar({ label, value, target, pct, status }: { label: string; value: number; target: number; pct: number; status: TrafficLight }) {
  const width = Math.min(100, pct);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-zinc-500 dark:text-zinc-400 font-semibold">{label}</span>
        <span className={`font-bold font-mono ${LIGHT_TEXT[status]}`}>
          {value}/{target} · {pct}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${LIGHT_BG[status]}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
