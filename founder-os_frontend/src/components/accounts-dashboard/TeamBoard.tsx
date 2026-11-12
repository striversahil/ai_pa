"use client";

// Extracted verbatim from AccountsDashboard.tsx by scripts/refactor/split-module.mjs.
// AccountsDashboard.tsx re-exports everything public here, so existing imports keep working.
import type { TeamData, FreqStat, LaneStat } from "./types";

export function TeamBoard({ team, freqStats, laneStats, backlog }: {
  team: TeamData | null;
  freqStats?: FreqStat[];
  laneStats?: { senior: LaneStat; junior: LaneStat } | null;
  backlog?: number;
}) {
  if (!team) return <div className="py-12 text-center text-sm text-zinc-500">Team stats unavailable.</div>;
  const maxMonth = Math.max(1, ...team.members.map((m) => m.doneMonth));
  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`);
  const freqIcon: Record<string, string> = { daily: "📅", weekly: "🗓", monthly: "📆", quarterly: "📊", yearly: "🎯" };
  // What truly matters: completed vs not completed. Today first, backlog next.
  const doneToday = team.doneToday;
  const notToday = team.openToday;
  const totalToday = doneToday + notToday;
  const backlogCount = backlog ?? team.incompleteToday ?? team.overdueToday;
  return (
    <div className="space-y-6">
      {/* Hero: completed vs not completed — the one number that matters */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 sm:p-5">
        <div className="text-[10px] uppercase tracking-wider text-zinc-600 dark:text-zinc-500 font-extrabold">Today — completed vs not completed</div>
        <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-2">
          <div>
            <span className="text-3xl font-extrabold text-emerald-500">✓ {doneToday}</span>
            <span className="ml-2 text-xs font-semibold text-zinc-500">completed</span>
          </div>
          <div>
            <span className="text-3xl font-extrabold text-rose-500">✕ {notToday}</span>
            <span className="ml-2 text-xs font-semibold text-zinc-500">not completed</span>
          </div>
          <div className="ml-auto text-right">
            <span className="text-2xl font-extrabold text-indigo-400">{team.completionPct}%</span>
            <div className="text-[10px] uppercase text-zinc-500 font-bold">of {totalToday} due today</div>
          </div>
        </div>
        <div className="h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 mt-3 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500" style={{ width: `${team.completionPct}%` }} />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold">
          {laneStats && (
            <>
              <span className="text-zinc-600 dark:text-zinc-300">👔 Senior: <span className="text-emerald-500">✓ {laneStats.senior.done}</span> <span className="text-zinc-500">/</span> <span className="text-rose-500">✕ {laneStats.senior.not}</span> <span className="text-zinc-500 font-normal">of {laneStats.senior.total}</span></span>
              <span className="text-zinc-600 dark:text-zinc-300">🧾 Junior: <span className="text-emerald-500">✓ {laneStats.junior.done}</span> <span className="text-zinc-500">/</span> <span className="text-rose-500">✕ {laneStats.junior.not}</span> <span className="text-zinc-500 font-normal">of {laneStats.junior.total}</span></span>
            </>
          )}
          <span className={backlogCount > 0 ? "text-rose-500" : "text-zinc-500"}>📦 Backlog: {backlogCount} past task{backlogCount === 1 ? "" : "s"} still not done</span>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Done this week", value: team.weekDone, accent: "text-zinc-900 dark:text-zinc-100" },
          { label: "Done this month", value: team.monthDone, accent: "text-zinc-900 dark:text-zinc-100" },
        ].map((k) => (
          <div key={k.label} className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-600 dark:text-zinc-500 font-bold">{k.label}</div>
            <div className={`text-2xl font-extrabold mt-1 ${k.accent}`}>{k.value}</div>
          </div>
        ))}
      </div>
      {freqStats && freqStats.length > 0 && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
            📊 Today by frequency — completed vs not completed
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {freqStats.map((f) => (
              <div key={f.frequency} className="p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  <span>{freqIcon[f.frequency] ?? "📌"}</span> {f.frequency}
                  <span className="ml-auto text-[10px] font-bold text-zinc-500">{f.total} total</span>
                </div>
                <div className="mt-2 flex gap-2 text-center">
                  <span className="flex-1">
                    <span className="block text-sm font-extrabold text-emerald-500">{f.done}</span>
                    <span className="block text-[9px] uppercase text-zinc-500">done</span>
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-extrabold text-rose-500">{f.incomplete ?? f.overdue}</span>
                    <span className="block text-[9px] uppercase text-zinc-500">not done</span>
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-extrabold text-amber-500">{f.pending}</span>
                    <span className="block text-[9px] uppercase text-zinc-500">pending</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 mt-2 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500" style={{ width: `${f.completionPct}%` }} />
                </div>
                <div className="text-[10px] text-center text-zinc-500 mt-1">{f.completionPct}% complete</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
          🏆 Per person · completed vs pending <span className="normal-case font-medium">(week starts Monday)</span>
        </div>
        {team.members.length === 0 && <div className="p-6 text-center text-xs text-zinc-500">No accountants on the roster yet — root adds them from the Controller tab.</div>}
        {team.members.map((m, i) => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800/60 last:border-0">
            <span className="w-7 text-sm font-bold shrink-0">{medal(i)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-bold text-sm truncate">{m.name}</span>
                <span className={`text-[10px] font-bold uppercase ${m.role === "senior" ? "text-indigo-400" : "text-zinc-500"}`}>{m.role}</span>
              </div>
              <div className="mt-0.5 text-[11px] font-semibold">
                <span className="text-emerald-500">✓ {m.doneToday} done today</span>
                <span className="text-zinc-500 font-normal"> · </span>
                <span className={m.openLaneToday > 0 ? "text-rose-500" : "text-zinc-500"}>✕ {m.openLaneToday} pending in {m.role} lane</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 mt-1 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500" style={{ width: `${Math.round((m.doneMonth / maxMonth) * 100)}%` }} />
              </div>
            </div>
            <div className="flex gap-3 text-center shrink-0">
              <span title="Done today"><span className="block text-sm font-extrabold font-mono text-emerald-500">{m.doneToday}</span><span className="block text-[9px] uppercase text-zinc-500">today</span></span>
              <span title="Done this week"><span className="block text-sm font-extrabold font-mono">{m.doneWeek}</span><span className="block text-[9px] uppercase text-zinc-500">week</span></span>
              <span title="Done this month"><span className="block text-sm font-extrabold font-mono">{m.doneMonth}</span><span className="block text-[9px] uppercase text-zinc-500">month</span></span>
            </div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-zinc-500">Tip: Done credits whoever is signed in (or the device's “Acting as” identity) — no need to pick a name. Shared tasks credit whoever logs them.</div>
    </div>
  );
}
