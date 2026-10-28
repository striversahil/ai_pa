"use client";

// HR view: one card per team member for the selected day — how much is open,
// what is due, what got done, and whether they updated anything at all.
import React from "react";
import { initials } from "@/hr/format";
import { istClock } from "@/hr/delegation";
import type { HrDelegationTeamRow } from "@/hr/types";

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className={`text-sm font-extrabold ${tone}`}>{value}</span>
      <span className="text-[9px] font-bold uppercase tracking-wide text-zinc-400">{label}</span>
    </div>
  );
}

export default function TeamPanel({
  team, selectedId, onSelect,
}: {
  team: HrDelegationTeamRow[];
  selectedId: string | null;
  onSelect: (memberId: string | null) => void;
}) {
  if (!team.length) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 px-3 py-6 text-center text-xs text-zinc-500">
        No active team members on the roster yet.
      </div>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {team.map((row) => {
        const active = selectedId === row.memberId;
        return (
          <button
            key={row.memberId}
            type="button"
            onClick={() => onSelect(active ? null : row.memberId)}
            className={`rounded-xl border p-3 text-left transition ${
              active
                ? "border-indigo-500/60 bg-indigo-500/5"
                : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:border-indigo-500/40"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500/10 text-[10px] font-extrabold text-indigo-500">
                {initials(row.name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">{row.name}</div>
                <div className="truncate text-[10px] text-zinc-500">{row.designation ?? "—"}</div>
              </div>
              {row.overdue > 0 && (
                <span className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold text-rose-500">{row.overdue} late</span>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between gap-1 border-t border-zinc-100 dark:border-zinc-800 pt-2">
              <Stat label="Open" value={row.open} tone="text-zinc-700 dark:text-zinc-200" />
              <Stat label="Due" value={row.dueOnDate} tone="text-amber-600 dark:text-amber-400" />
              <Stat label="Done" value={row.doneOnDate} tone="text-emerald-600 dark:text-emerald-400" />
              <Stat label="Updates" value={row.updates} tone={row.updates ? "text-indigo-500" : "text-zinc-400"} />
            </div>
            <div className="mt-1 text-[10px] text-zinc-400">
              {row.lastUpdateAt ? `Last update ${istClock(row.lastUpdateAt)}` : "No update this day"}
            </div>
          </button>
        );
      })}
    </div>
  );
}
