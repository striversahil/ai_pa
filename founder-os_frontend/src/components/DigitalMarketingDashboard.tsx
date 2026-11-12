"use client";

import React, { useMemo, useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import KraKpiCharts from "./DigitalMarketingCharts";
import DigitalMarketingAds from "./DigitalMarketingAds";
import DigitalMarketingOpenTasks from "./DigitalMarketingOpenTasks";
import { useAuth } from "@/auth/AuthContext";
import { TabBar } from "@/components/ui/TabBar";
import { workspaceDataUrl } from "@/workspaces/api";
import type { DigitalMarketingView, DashData, UnscheduledItem } from "./digital-marketing-dashboard/types";
import { matchSelfRoster, fmtToday } from "./digital-marketing-dashboard/helpers";
import { TaskRow } from "./digital-marketing-dashboard/TaskRow";
import { FreqChip } from "./digital-marketing-dashboard/FreqChip";
import { Controller } from "./digital-marketing-dashboard/Controller";

// Pieces split into ./digital-marketing-dashboard/ (importable on their own); re-exported for compat.
export { matchSelfRoster } from "./digital-marketing-dashboard/helpers";

export default function AccountsDashboard() {
  const { me } = useAuth();
  const canMIS = !!me && (me.isAdmin || me.scopes.includes("mis"));
  const [view, setView] = useState<DigitalMarketingView>("dashboard");

  // Today only — no date filter. The backend serves the current IST day.
  // pollMs safety net: a stalled request can never wedge the view forever —
  // the 30s hook timeout turns it into an error and the next poll recovers.
  // Loading renders non-destructively (spinner only before first payload).
  const dash = useLiveDashboard<DashData>(async () => {
    const res = await fetch(workspaceDataUrl("digital-marketing"), { cache: "no-store" });
    if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`);
    return res.json();
  }, { events: ["digital-marketing"], pollMs: 60000 });

  const data = dash.data;
  const [statusFilter, setStatusFilter] = useState<"pending" | "done" | "all">("pending");
  // Inner tabs for the Tasks view: today (today's taskbar) vs incomplete (not-done backlog) vs history (last-30d done)
  const [roleSub, setRoleSub] = useState<"today" | "incomplete" | "history">("today");
  React.useEffect(() => { if (view === "tasks") setRoleSub("today"); }, [view]);
  const selfId = useMemo(() => matchSelfRoster(me as any, data?.roster ?? []), [me, data]);
  // No "Acting as" switcher here — a single manager works this taskbar.
  // Credit is inferred: the signed-in user's roster match (the server
  // resolves and stamps the same identity — the client sends no who).
  const identity = useMemo(() => {
    const id = selfId;
    const name = (id && data?.roster.find((r) => r.id === id)?.name) ?? data?.meta?.self?.name ?? null;
    return { id, name };
  }, [selfId, data]);
  const lane = useMemo(() => data?.items ?? [], [data]);
  const visible = useMemo(() => {
    if (statusFilter === "done") return lane.filter((t) => t.status === "done");
    if (statusFilter === "all") return lane;
    return lane.filter((t) => t.status !== "done" && t.status !== "skipped");
  }, [lane, statusFilter]);
  const pendingCount = lane.filter((t) => t.status !== "done" && t.status !== "skipped").length;
  const doneCount = lane.filter((t) => t.status === "done").length;

  // Single manager — no lane split. Controller only for MIS.
  const visibleTabs: { key: DigitalMarketingView; label: string; icon: string }[] = !data
    ? [{ key: "dashboard", label: "Dashboard", icon: "📊" }]
    : canMIS
      ? [
        { key: "dashboard", label: "Dashboard", icon: "📊" },
        { key: "tasks", label: "Tasks", icon: "📋" },
        { key: "ads", label: "ADS", icon: "📢" },
        { key: "open", label: "Open Tasks", icon: "🗂️" },
        { key: "controller", label: "Controller", icon: "🎛️" },
      ]
      : [
        { key: "dashboard", label: "Dashboard", icon: "📊" },
        { key: "tasks", label: "Tasks", icon: "📋" },
        { key: "ads", label: "ADS", icon: "📢" },
        { key: "open", label: "Open Tasks", icon: "🗂️" },
      ];
  const isTaskView = view === "tasks";
  const incompleteTray = useMemo(() => data?.overdueList ?? [], [data]);
  const historyTray = useMemo(() => data?.history ?? [], [data]);
  // Reference items: single lane, always visible when in tasks view.
  const inUnscheduled = (_u: UnscheduledItem) => true;
  // If the visible tabs narrow (e.g. identity picked/cleared), drop a
  // now-unreachable view back to the dashboard.
  React.useEffect(() => {
    if (data && !visibleTabs.some((t) => t.key === view)) setView("dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, view]);

  return (
    <div className="space-y-4 text-zinc-900 dark:text-zinc-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Digital Marketing <span className="text-xs font-medium text-zinc-500">· daily / weekly taskbar</span></h2>
          {data && (
            <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px]">
              <span className="font-bold text-zinc-800 dark:text-zinc-100 text-xs">📅 Today · {fmtToday(data.meta.date)}</span>
              <span className="font-bold text-emerald-500">✓ {data.meta.done} completed</span>
              <span className="font-bold text-amber-500">✕ {data.meta.open} not completed</span>
              {(data.meta.incomplete ?? data.meta.overdue) > 0 && <span className="font-bold text-rose-500">📦 {data.meta.incomplete ?? data.meta.overdue} incomplete</span>}
              {data.meta.computeV && <span className="text-zinc-400" title="Backend version that calculated these numbers">· {data.meta.computeV}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* Tabs (full-width horizontal row, like Telecalling). Non-MIS viewers
            only get Dashboard + Tasks — the Controller tab never renders. */}
        <aside className="w-full shrink-0">
          <TabBar
            items={visibleTabs.filter((t) => t.key !== "controller" || canMIS)}
            active={view}
            onChange={setView}
          />
        </aside>

        {/* Content (seamless switch — queries stay mounted) */}
        <div className="flex-1 min-w-0">
          {data && view === "dashboard" && <KraKpiCharts />}
          {data && view === "ads" && <DigitalMarketingAds />}
          {data && view === "open" && <DigitalMarketingOpenTasks />}

      {dash.loading && !data && <div className="py-16 text-center text-sm text-zinc-500 animate-pulse">Loading digital marketing taskbar…</div>}
      {Boolean((dash as any).error) && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-400">Failed to load: {String((dash as any).error)} <button onClick={() => dash.refresh()} className="ml-2 underline cursor-pointer">Retry</button></div>}

      {/* Tasks — single manager with inner tabs Today / Incomplete / History */}
      {data && view === "tasks" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {([
              { key: "today" as const, label: `📋 Today (${lane.length})` },
              { key: "incomplete" as const, label: `✕ Incomplete (${incompleteTray.length})` },
              { key: "history" as const, label: `🕘 History (${historyTray.length})` },
            ]).map((t) => (
              <button key={t.key} onClick={() => setRoleSub(t.key)} className={`px-3 py-1.5 text-xs font-bold rounded-full cursor-pointer border ${roleSub === t.key ? "bg-indigo-600 text-white border-transparent" : "border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
                {t.label}
              </button>
            ))}
          </div>

          {roleSub === "today" && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {([
                  { key: "pending", label: `● Pending (${pendingCount})` },
                  { key: "done", label: `✓ Done (${doneCount})` },
                  { key: "all", label: `All (${lane.length})` },
                ] as const).map((s) => (
                  <button key={s.key} onClick={() => setStatusFilter(s.key)} className={`px-3 py-1 text-[11px] font-bold rounded-full cursor-pointer border ${statusFilter === s.key ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-transparent" : "border-zinc-300 dark:border-zinc-700 text-zinc-500"}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {visible.map((t) => <TaskRow key={t.templateId} t={t} roster={data.roster} identity={identity} onLogged={() => dash.refresh()} />)}
                {visible.length === 0 && <div className="col-span-2 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">{statusFilter === "done" ? "Nothing marked done today — switch to History for past completions." : "No tasks pending today."}</div>}
              </div>
              {(data.unscheduled ?? []).filter(inUnscheduled).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-500">📌 No fixed date — reference ({(data.unscheduled ?? []).filter(inUnscheduled).length})</h3>
                  <div className="grid gap-2 md:grid-cols-2">
                    {(data.unscheduled ?? []).filter(inUnscheduled).map((u) => (
                      <div key={u.templateId} className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-3 text-xs">
                        <div className="font-semibold text-zinc-800 dark:text-zinc-200">{u.title}</div>
                        {(u.note || u.dueLabel) && <div className="text-zinc-500 mt-0.5">{[u.note, u.dueLabel].filter(Boolean).join(" · ")}</div>}
                        <div className="flex gap-1.5 mt-1.5">
                          <FreqChip f={u.frequency} />
                          <span title={u.employeeRaw ? `Sheet: ${u.employeeRaw}` : undefined} className="inline-flex items-center rounded-full border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">{u.isShared ? "👥 shared" : u.ownerRole}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {roleSub === "incomplete" && (
            <div className="space-y-2">
              {incompleteTray.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {incompleteTray.map((t) => <TaskRow key={t.logId ?? t.templateId} t={t} roster={data.roster} identity={identity} today={data.meta.date} onLogged={() => dash.refresh()} />)}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">All clear — nothing incomplete. 🎉</div>
              )}
            </div>
          )}

          {roleSub === "history" && (
            <div className="space-y-2">
              {historyTray.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {historyTray.map((t) => <TaskRow key={t.logId ?? `${t.templateId}-${t.dueDate}`} t={t} roster={data.roster} identity={identity} today={data.meta.date} onLogged={() => dash.refresh()} />)}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">No completed tasks in the last 30 days.</div>
              )}
            </div>
          )}
        </div>
      )}

      {data && view === "controller" && (canMIS ? <Controller onChanged={() => dash.refresh()} /> : <div className="rounded-xl border p-6 text-sm text-zinc-500">🔒 Controller is restricted to MIS-level users.</div>)}
        </div>
      </div>
    </div>
  );
}
