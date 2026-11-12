"use client";

import React, { useMemo, useRef, useState } from "react";
import { useLiveQuery, useOptimisticMutation, patchRowInLists, mapRowInLists } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import { TabBar } from "@/components/ui/TabBar";
import PaymentDues from "@/components/accounts/PaymentDues";
import DispatchCash from "@/components/accounts/DispatchCash";
import { inr, inrShort } from "@/components/accounts/payment-calendar";
import { workspaceDataUrl } from "@/workspaces/api";
import type { AccountsView, DashData, TaskItem, FileItem, LaneStat, UnscheduledItem } from "./accounts-dashboard/types";
import { matchSelfRoster, ACTOR_KEY, fmtToday } from "./accounts-dashboard/helpers";
import { TeamBoard } from "./accounts-dashboard/TeamBoard";
import { TaskRow } from "./accounts-dashboard/TaskRow";
import { FreqChip } from "./accounts-dashboard/FreqChip";
import { Controller } from "./accounts-dashboard/Controller";

// Pieces split into ./accounts-dashboard/ (importable on their own); re-exported for compat.
export { matchSelfRoster } from "./accounts-dashboard/helpers";

export default function AccountsDashboard() {
  const { me } = useAuth();
  const canMIS = !!me && (me.isAdmin || me.scopes.includes("mis"));
  // Dispatch cash: adds from accounts OR dispatch floor; edits from accounts/MIS.
  const canCashAdd = !!me && (me.isAdmin || me.scopes.includes("mis") || me.scopes.includes("accounts") || me.scopes.includes("dispatch") || me.scopes.includes("crm"));
  const canCashEdit = !!me && (me.isAdmin || me.scopes.includes("mis") || me.scopes.includes("accounts"));
  const [view, setView] = useState<AccountsView>("dashboard");

  // Today only — no date filter. The backend serves the current IST day.
  // pollMs safety net: a stalled request can never wedge the view forever —
  // the 30s hook timeout turns it into an error and the next poll recovers.
  // Loading renders non-destructively (spinner only before first payload).
  //
  // Refetch scope: this payload is ~280 KB (task lanes + 300-row history +
  // paid history), so refetching it on EVERY `data-changed` event (WhatsApp,
  // CRM sync, enquiries, chat…) is what made the tab crawl. Every write that
  // can change these numbers broadcasts `accounts` (all accounts routes
  // notifyLive(Accounts)), and the 60s poll covers anything that does not, so
  // the hook is narrowed to that one event.
  const dash = useLiveQuery<DashData>(async () => {
    // Identity rides along so the backend scopes the payload to the viewer's
    // own lane (MIS/root skip scoping server-side).
    const res = await fetch(`${workspaceDataUrl("accounts")}${actorPick ? `?as=${encodeURIComponent(actorPick)}` : ""}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`);
    return res.json();
  }, { events: ["accounts"], pollMs: 60000 });

  const data = dash.data;
  // Shared optimistic module (useLiveData): every write paints instantly and
  // reconciles in the background — the same contract as sales enquiries.
  // All payload lists holding log rows; rapid taps on one log serialize via
  // the mutation key, taps on different logs run concurrently.
  const LISTS = useMemo(() => ["items", "senior", "junior", "overdueList", "incompleteList", "history"] as const, []);
  const { mutate } = useOptimisticMutation(dash);
  const saveLog = React.useCallback((logId: string, body: Record<string, unknown>, patch: Partial<TaskItem>) =>
    mutate(
      (prev) => patchRowInLists(prev, [...LISTS], "logId", logId, patch as Record<string, any>),
      async () => {
        const res = await fetch(`/api/accounts/logs/${logId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await res.text());
      },
      { key: logId },
    ), [mutate, LISTS]);
  const attachFile = React.useCallback((logId: string, file: File) => {
    const temp: FileItem = { id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`, fileName: file.name, mime: file.type || "application/octet-stream", size: file.size, uploadedBy: "…", createdAt: new Date().toISOString(), url: "#" };
    return mutate(
      (prev) => mapRowInLists(prev, [...LISTS], "logId", logId, (row) => ({ ...row, attachments: [...(row.attachments ?? []), temp] })),
      async () => {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/accounts/logs/${logId}/files`, { method: "POST", body: form });
        if (!res.ok) throw new Error(await res.text());
      },
      { key: logId },
    );
  }, [mutate, LISTS]);
  const detachFile = React.useCallback((logId: string, fileId: string) =>
    mutate(
      (prev) => mapRowInLists(prev, [...LISTS], "logId", logId, (row) => ({ ...row, attachments: (row.attachments ?? []).filter((f: FileItem) => f.id !== fileId) })),
      async () => {
        const res = await fetch(`/api/accounts/files/${fileId}`, { method: "DELETE" });
        if (!res.ok) throw new Error(await res.text());
      },
      { key: logId },
    ), [mutate, LISTS]);
  const [statusFilter, setStatusFilter] = useState<"pending" | "done" | "all">("pending");
  // Inner tabs for Senior/Junior/My: today (today's taskbar) vs incomplete (role's not-done backlog) vs history (role's last-30d done)
  const [roleSub, setRoleSub] = useState<"today" | "incomplete" | "history">("today");
  React.useEffect(() => { if (["senior", "junior", "my"].includes(view)) setRoleSub("today"); }, [view]);
  const selfId = useMemo(() => matchSelfRoster(me as any, data?.roster ?? []), [me, data]);
  // Shared logins can't be told apart by auth — each device declares its human
  // once ("Acting as"), remembered in localStorage. Every Done/remark/file is
  // credited to this identity unless a row overrides it.
  const [actorPick, setActorPick] = useState(() => {
    try { return localStorage.getItem(ACTOR_KEY) || ""; } catch { return ""; }
  });
  const pickActor = (id: string) => {
    setActorPick(id);
    try {
      if (id) localStorage.setItem(ACTOR_KEY, id);
      else localStorage.removeItem(ACTOR_KEY);
    } catch { /* private mode */ }
  };
  // Identity drives backend lane scoping — refetch as the new person
  // (skipped on mount; the initial load already runs).
  const mounted = useRef(false);
  React.useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    dash.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorPick]);
  // Inferred doer for instant Done paint: the device's "Acting as"
  // identity, else the signed-in user's roster match, else the
  // server-resolved name. The server stamps the same identity — no who
  // is ever sent from the client.
  const identity = useMemo(() => {
    const id = actorPick || selfId;
    const name = (id && data?.roster.find((r) => r.id === id)?.name) ?? data?.meta?.self?.name ?? null;
    return { id, name, as: actorPick };
  }, [actorPick, selfId, data]);
  // A remembered identity can go stale (person removed from the roster):
  // drop it so "Acting as" never credits a deleted accountant.
  React.useEffect(() => {
    if (actorPick && data && !data.roster.some((r) => r.id === actorPick)) pickActor("");
  }, [actorPick, data]);
  const lane = useMemo(() => {
    if (!data) return [];
    if (view === "senior") return data.senior;
    if (view === "junior") return data.junior;
    if (view === "incomplete") return [];
    // Scoped "My Tasks" and the admin "All Tasks" both render the payload's
    // items, which the backend already lane-filtered for non-admin viewers.
    return data.items;
  }, [data, view]);
  const visible = useMemo(() => {
    if (statusFilter === "done") return lane.filter((t) => t.status === "done");
    if (statusFilter === "all") return lane;
    return lane.filter((t) => t.status !== "done" && t.status !== "skipped");
  }, [lane, statusFilter]);
  const pendingCount = lane.filter((t) => t.status !== "done" && t.status !== "skipped").length;
  const doneCount = lane.filter((t) => t.status === "done").length;

  // Identity-aware nav: MIS/root see every lane; everyone else sees Dashboard
  // + exactly their own lane ("My Tasks"). The backend already scopes the
  // payload, so this is display-layer enforcement to match.
  const selfRole = data?.meta?.self && !data?.meta?.isAdmin ? data.meta.self.role : null;
  const showAllLanes = !data || data.meta.isAdmin;
  const visibleTabs: { key: AccountsView; label: string; icon: string }[] = !data
    ? [{ key: "dashboard", label: "Dashboard", icon: "📊" }]
    : showAllLanes
      ? [
        { key: "dashboard", label: "Dashboard", icon: "📊" },
        { key: "tasks", label: "All Tasks", icon: "📋" },
        { key: "senior", label: "Senior", icon: "👔" },
        { key: "junior", label: "Junior", icon: "🧾" },
        { key: "dues", label: "Payment dues", icon: "💳" },
        { key: "cash", label: "Dispatch cash", icon: "💵" },
        { key: "controller", label: "Controller", icon: "🎛️" },
      ]
      : selfRole
        ? [
          { key: "dashboard", label: "Dashboard", icon: "📊" },
          { key: "my", label: "My Tasks", icon: selfRole === "senior" ? "👔" : "🧾" },
          { key: "dues", label: "Payment dues", icon: "💳" },
          { key: "cash", label: "Dispatch cash", icon: "💵" },
        ]
        : [
          { key: "dashboard", label: "Dashboard", icon: "📊" },
          { key: "cash", label: "Dispatch cash", icon: "💵" },
        ];
  const isTaskView = view === "tasks" || view === "senior" || view === "junior" || view === "my";
  const isIncompleteView = view === "incomplete";
  // Payment-dues badges on the TAB BAR (not just inside the tab): the red
  // overdue ₹ and the amber this-week ₹ stay visible from every Accounts view,
  // so money at risk is seen before opening the page. Short notation keeps the
  // nav from reflowing; the tooltip carries the full figures.
  const paySum = data?.paymentSummary ?? null;
  const duesBadges = useMemo(() => {
    if (!paySum) return undefined;
    const out: { text: string; tone: "danger" | "warning"; title: string }[] = [];
    // A credit card's amount is NULL until its statement is entered, so a
    // backlog can exist with ₹0 behind it. Show the amount when we know it and
    // fall back to the count so the tab still warns that bills are waiting.
    if (paySum.overdueCount > 0) {
      out.push({
        text: paySum.overdueTotal > 0 ? inrShort(paySum.overdueTotal) : String(paySum.overdueCount),
        tone: "danger",
        title: paySum.overdueTotal > 0
          ? `${paySum.overdueCount} overdue bill${paySum.overdueCount === 1 ? "" : "s"} · ${inr(paySum.overdueTotal)} — past the due date`
          : `${paySum.overdueCount} overdue bill${paySum.overdueCount === 1 ? "" : "s"} — amounts not entered yet`,
      });
    }
    if (paySum.weekCount > 0) {
      out.push({
        text: paySum.weekTotal > 0 ? inrShort(paySum.weekTotal) : String(paySum.weekCount),
        tone: "warning",
        title: paySum.weekTotal > 0
          ? `${paySum.weekCount} bill${paySum.weekCount === 1 ? "" : "s"} due in the next 7 days · ${inr(paySum.weekTotal)}`
          : `${paySum.weekCount} bill${paySum.weekCount === 1 ? "" : "s"} due in the next 7 days — amounts not entered yet`,
      });
    }
    return out.length ? out : undefined;
  }, [paySum]);
  const duesTitle = paySum
    ? `${paySum.unpaidCount} open cycle${paySum.unpaidCount === 1 ? "" : "s"} · ${inr(paySum.unpaidTotal)} unpaid` +
      (paySum.overdueCount > 0 ? ` · ${paySum.overdueCount} overdue (${inr(paySum.overdueTotal)})` : "") +
      (paySum.weekCount > 0 ? ` · ${paySum.weekCount} due in 7 days (${inr(paySum.weekTotal)})` : "")
    : undefined;
  const isHistoryView = view === "history";
  // Incomplete tab shows the full not-done backlog (past-due unresolved logs).
  // The payload is already lane-scoped server-side, so admins see everything and
  // everyone else sees their own lane — no further narrowing by lane tab.
  const incompleteCount = (data?.incompleteList ?? data?.overdueList ?? []).length;
  const incompleteTray = useMemo(() => {
    const list = data?.incompleteList ?? data?.overdueList ?? [];
    if (isIncompleteView || view === "tasks") return list;
    if (view === "my") return selfRole ? list.filter((t) => t.ownerRole === "either" || t.ownerRole === selfRole) : list;
    return list.filter((t) => t.ownerRole === "either" || t.ownerRole === view);
  }, [data, view, selfRole, isIncompleteView]);
  const historyCount = data?.history?.length ?? 0;
  const historyTray = useMemo(() => {
    const list = data?.history ?? [];
    if (isHistoryView || view === "tasks") return list;
    if (view === "my") return selfRole ? list.filter((t) => t.ownerRole === "either" || t.ownerRole === selfRole) : list;
    if (view === "senior" || view === "junior") return list.filter((t) => t.ownerRole === "either" || t.ownerRole === view);
    return list;
  }, [data, view, selfRole, isHistoryView]);
  // Completed vs not completed per lane (today) + past backlog count —
  // feeds the dashboard hero so the one number that matters is unmissable.
  const laneStats = useMemo(() => {
    if (!data) return null;
    const stat = (arr: TaskItem[]): LaneStat => {
      const total = arr.length;
      const done = arr.filter((t) => t.status === "done").length;
      return { done, total, not: total - done };
    };
    return { senior: stat(data.senior), junior: stat(data.junior) };
  }, [data]);
  const backlogCount = (data?.incompleteList ?? data?.overdueList ?? []).length;
  // Reference items follow the same lane visibility as tasks.
  const inUnscheduled = (u: UnscheduledItem) => {
    if (view === "my") return !selfRole || u.ownerRole === "either" || u.ownerRole === selfRole;
    if (view === "tasks") return true;
    return u.ownerRole === "either" || u.ownerRole === view;
  };
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
          <h2 className="text-xl font-bold">Accounts <span className="text-xs font-medium text-zinc-500">· daily / monthly / yearly taskbar</span></h2>
          {data && (
            <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px]">
              <span className="font-bold text-zinc-800 dark:text-zinc-100 text-xs">📅 Today · {fmtToday(data.meta.date)}</span>
              <span className="font-bold text-emerald-500">✓ {data.meta.done} completed</span>
              <span className="font-bold text-amber-500">✕ {data.meta.open} not completed</span>
              {(data.meta.incomplete ?? data.meta.overdue) > 0 && <span className="font-bold text-rose-500">✕ {data.meta.incomplete ?? data.meta.overdue} incomplete</span>}
              {data.meta.computeV && <span className="text-zinc-400" title="Backend version that calculated these numbers">· {data.meta.computeV}</span>}
            </div>
          )}
        </div>
        {data && data.roster.length > 0 && (
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 shrink-0" title="Shared login? Pick who is using this device — credits go to this person">
            Acting as:
            <select value={actorPick} onChange={(e) => pickActor(e.target.value)} className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-2 py-1.5 text-xs font-bold text-indigo-300 outline-none">
              <option value="">Auto{selfId && data.roster.find((r) => r.id === selfId) ? ` (${data.roster.find((r) => r.id === selfId)!.name})` : ""}</option>
              {data.roster.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.role}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="flex flex-col gap-6">
        {/* Tabs (full-width horizontal row, like Telecalling). Non-MIS viewers
            only get Dashboard + their own lane — other lanes never render. */}
        <aside className="w-full shrink-0">
          <TabBar
            items={visibleTabs
              .filter((t) => t.key !== "controller" || canMIS)
              .map((t) => ({
                ...t,
                count: t.key === "incomplete" ? incompleteCount : t.key === "history" ? historyCount : null,
                tone: t.key === "incomplete" ? "danger" as const : undefined,
                badges: t.key === "dues" ? duesBadges : undefined,
                title: t.key === "dues" ? duesTitle : undefined,
              }))}
            active={view}
            onChange={setView}
          />
        </aside>

        {/* Content (seamless switch — queries stay mounted) */}
        <div className="flex-1 min-w-0">
          {data && view === "dashboard" && <TeamBoard team={data.team ?? null} freqStats={data.freqStats ?? []} laneStats={laneStats} backlog={backlogCount} />}

      {dash.loading && !data && <div className="py-16 text-center text-sm text-zinc-500 animate-pulse">Loading accounts taskbar…</div>}
      {Boolean((dash as any).error) && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-400">Failed to load: {String((dash as any).error)} <button onClick={() => dash.refresh()} className="ml-2 underline cursor-pointer">Retry</button></div>}

      {/* All Tasks (global) — today taskbar */}
      {data && view === "tasks" && (
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
                {visible.map((t) => <TaskRow key={t.templateId} t={t} roster={data.roster} identity={identity} onSave={saveLog} onAttach={attachFile} onDetach={detachFile} />)}
            {visible.length === 0 && <div className="col-span-2 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">{statusFilter === "done" ? "Nothing marked done in this view yet — today's completions will appear here (past done is in History tab)." : "No pending tasks in this view."}</div>}
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

      {/* Senior / Junior / My — individual tabs: Today / Incomplete (by role) / History (by role) */}
      {data && (view === "senior" || view === "junior" || view === "my") && (
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
            {visible.map((t) => <TaskRow key={t.templateId} t={t} roster={data.roster} identity={identity} onSave={saveLog} onAttach={attachFile} onDetach={detachFile} />)}
                {visible.length === 0 && <div className="col-span-2 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">{statusFilter === "done" ? "Nothing marked done today for this lane — switch to History for past completions." : "No pending tasks for this lane today."}</div>}
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
                  {incompleteTray.map((t) => <TaskRow key={t.logId ?? t.templateId} t={t} roster={data.roster} identity={identity} today={data.meta.date} onSave={saveLog} onAttach={attachFile} onDetach={detachFile} />)}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">All clear — nothing incomplete for this lane. 🎉</div>
              )}
            </div>
          )}

          {roleSub === "history" && (
            <div className="space-y-2">
              {historyTray.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {historyTray.map((t) => <TaskRow key={t.logId ?? `${t.templateId}-${t.dueDate}`} t={t} roster={data.roster} identity={identity} today={data.meta.date} onSave={saveLog} onAttach={attachFile} onDetach={detachFile} />)}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">No completed tasks in the last 30 days for this lane.</div>
              )}
            </div>
          )}
        </div>
      )}

      {data && view === "controller" && (canMIS ? <Controller onChanged={() => dash.refresh()} /> : <div className="rounded-xl border p-6 text-sm text-zinc-500">🔒 Controller is restricted to MIS-level users.</div>)}
      {data && view === "dues" && <PaymentDues dues={data.payments ?? []} history={data.paymentHistory ?? []} summary={data.paymentSummary} onRefresh={() => dash.refresh()} />}
      {data && view === "cash" && <DispatchCash entries={data.cashEntries ?? []} summary={data.cashSummary} canAdd={canCashAdd} canEdit={canCashEdit} onRefresh={() => dash.refresh()} />}
        </div>
      </div>
    </div>
  );
}
