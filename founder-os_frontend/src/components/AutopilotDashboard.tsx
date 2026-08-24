"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useLiveRefresh } from "@/hooks/useLiveEvents";

type AutopilotAction = {
  id: string;
  toolName: string;
  input: unknown;
  status: string;
  reason: string | null;
  createdAt: string;
};

type ReviewTask = {
  id: string;
  chatId: string;
  chatName: string;
  taskType: string;
  item: string | null;
  status: string;
  summary: string | null;
  version: number;
  updatedAt: string;
  latestReason: string | null;
  latestTransition: string | null;
  latestConfidence: number | null;
  actions: AutopilotAction[];
};

type ProposedAction = {
  id: string;
  toolName: string;
  input: unknown;
  status: string;
  reason: string | null;
  requestedBy: string;
  createdAt: string;
  taskId: string | null;
  task: { id: string; chatName: string; item: string | null; status: string; taskType: string } | null;
};

type HistoryEntry = {
  id: string;
  transition: string;
  triggeredBy: string;
  notes: string | null;
  confidence: number | null;
  occurredAt: string;
  task: { id: string; chatName: string; item: string | null; status: string; taskType: string } | null;
};

type AutopilotData = {
  meta: { phase: string; generatedAt: string; lastEngineActivity: string | null };
  stats: Record<string, number> & { openTotal?: number };
  byType: { taskType: string; count: number }[];
  reviewQueue: ReviewTask[];
  proposedActions: ProposedAction[];
  recentHistory: HistoryEntry[];
  overrides: number;
};

const STATUS_STYLES: Record<string, string> = {
  open: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  waiting: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  needs_clarification: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  needs_review: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  completed: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  cancelled: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
};

function StatusChip({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? STATUS_STYLES.cancelled;
  return (
    <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border ${cls}`}>
      {(status || "?").replace(/_/g, " ")}
    </span>
  );
}

export default function AutopilotDashboard() {
  const [data, setData] = useState<AutopilotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/automations/whatsapp-autopilot/data");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 60_000);
    return () => clearInterval(timer);
  }, [fetchData]);

  useLiveRefresh((event) => event.type === "autopilot", fetchData);

  const decideTask = async (task: ReviewTask, resolution: string) => {
    setBusyId(task.id);
    try {
      await fetch(`/api/autopilot/tasks/${task.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      fetchData();
    } catch (e) {
      console.error(e);
    } finally {
      setBusyId(null);
    }
  };

  const decideAction = async (actionId: string, decision: string) => {
    setBusyId(actionId);
    try {
      await fetch(`/api/autopilot/actions/${actionId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      fetchData();
    } catch (e) {
      console.error(e);
    } finally {
      setBusyId(null);
    }
  };

  const kpis = [
    { label: "Open Tasks", value: data?.stats?.openTotal ?? 0, accent: "text-sky-300" },
    { label: "Waiting", value: data?.stats?.waiting ?? 0, accent: "text-amber-300" },
    { label: "Needs Review", value: data?.stats?.needs_review ?? 0, accent: "text-rose-300" },
    { label: "Completed", value: data?.stats?.completed ?? 0, accent: "text-emerald-300" },
    { label: "Human Overrides", value: data?.overrides ?? 0, accent: "text-violet-300" },
  ];

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div>
          <h1 className="text-3xl font-bold font-heading tracking-tight">
            <span className="bg-gradient-to-r from-white via-indigo-100 to-indigo-400 bg-clip-text text-transparent">WhatsApp Autopilot</span>
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            Structured business layer under WhatsApp — phase {data?.meta?.phase ?? "0 (shadow)"} · nothing is ever sent automatically
          </p>
        </div>
        <button
          onClick={fetchData}
          className="text-white flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-medium text-sm transition-all duration-200 cursor-pointer shadow-lg shadow-indigo-600/25 border-0"
        >
          <span>🔄</span> Refresh
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-zinc-500 dark:text-zinc-400">
          <span className="animate-pulse">Loading autopilot state...</span>
        </div>
      )}

      {error && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-5 text-sm text-amber-300">
          Dashboard not available ({error}). The worker may need the new schema deployed.
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {kpis.map((k) => (
              <div key={k.label} className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-5">
                <span className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">{k.label}</span>
                <span className={`text-2xl font-bold block ${k.accent}`}>{k.value}</span>
              </div>
            ))}
          </div>

          {/* Task types */}
          {data.byType.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.byType.map((t) => (
                <span key={t.taskType} className="px-3 py-1 text-xs rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
                  {t.taskType.replace(/_/g, " ")} · {t.count}
                </span>
              ))}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Review queue */}
            <section className="space-y-3">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-rose-300">
                🔍 Review Queue — human decisions required
              </h2>
              {data.reviewQueue.length === 0 ? (
                <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-6 text-sm text-zinc-500 dark:text-zinc-400">
                  Nothing needs review. The engine is confident or quiet.
                </div>
              ) : (
                data.reviewQueue.map((t) => (
                  <div key={t.id} className="bg-zinc-50 dark:bg-zinc-900 border border-rose-500/20 rounded-xl p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">{t.item || "(no item)"}</div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{t.chatName}</div>
                      </div>
                      <StatusChip status={t.status} />
                    </div>
                    {t.latestReason && (
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
                        <span className="uppercase font-bold text-[10px] mr-1 text-rose-400">{(t.latestTransition || "?")}{t.latestConfidence != null ? ` (${Number(t.latestConfidence).toFixed(2)})` : ""}</span>
                        {t.latestReason}
                      </p>
                    )}
                    {t.actions.filter((a) => a.status === "pending").length > 0 && (
                      <ul className="text-xs space-y-1">
                        {t.actions.filter((a) => a.status === "pending").map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2 py-1">
                            <span className="truncate"><code className="text-indigo-400">{a.toolName}</code> {JSON.stringify(a.input).slice(0, 80)}</span>
                            <span className="flex gap-1 shrink-0">
                              <button disabled={busyId === a.id} onClick={() => decideAction(a.id, "approve")} className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold cursor-pointer border-0 disabled:opacity-50">approve</button>
                              <button disabled={busyId === a.id} onClick={() => decideAction(a.id, "reject")} className="px-2 py-0.5 rounded bg-zinc-600 hover:bg-zinc-500 text-white text-[10px] font-bold cursor-pointer border-0 disabled:opacity-50">reject</button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {[["completed", "✓ Complete"], ["open", "↻ Keep open"], ["waiting", "⏸ Wait"], ["cancelled", "✕ Cancel"]].map(([res, label]) => (
                        <button
                          key={res}
                          disabled={busyId === t.id}
                          onClick={() => decideTask(t, String(res))}
                          className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 cursor-pointer border-0 disabled:opacity-50"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </section>

            <div className="space-y-6">
              {/* Proposed actions */}
              <section className="space-y-3">
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-indigo-300">
                  🛠️ Proposed Actions — pending approval (shadow mode)
                </h2>
                {data.proposedActions.length === 0 ? (
                  <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-6 text-sm text-zinc-500 dark:text-zinc-400">
                    No pending tool proposals.
                  </div>
                ) : (
                  data.proposedActions.slice(0, 8).map((a) => (
                    <div key={a.id} className="bg-zinc-50 dark:bg-zinc-900 border border-indigo-500/20 rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-xs text-indigo-400 font-bold">{a.toolName}</code>
                        <StatusChip status={a.status} />
                      </div>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 break-all">{JSON.stringify(a.input)}</p>
                      {a.reason && <p className="text-[11px] text-zinc-500 italic">{a.reason}</p>}
                      {a.task && (
                        <p className="text-[11px] text-zinc-500 truncate">for: {a.task.item || a.task.chatName}</p>
                      )}
                      <div className="flex gap-2">
                        <button disabled={busyId === a.id} onClick={() => decideAction(a.id, "approve")} className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer border-0 disabled:opacity-50">Approve</button>
                        <button disabled={busyId === a.id} onClick={() => decideAction(a.id, "execute_manual")} className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white cursor-pointer border-0 disabled:opacity-50">Did it manually</button>
                        <button disabled={busyId === a.id} onClick={() => decideAction(a.id, "reject")} className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-zinc-600 hover:bg-zinc-500 text-white cursor-pointer border-0 disabled:opacity-50">Reject</button>
                      </div>
                    </div>
                  ))
                )}
              </section>

              {/* Recent history */}
              <section className="space-y-3">
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  📜 Recent Engine Decisions
                </h2>
                <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl divide-y divide-zinc-200/60 dark:divide-zinc-800/60 max-h-[420px] overflow-y-auto">
                  {data.recentHistory.map((h) => (
                    <div key={h.id} className="p-3 text-xs space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-indigo-400">{h.transition}</span>
                        <span className="text-zinc-500">by {h.triggeredBy}{h.confidence != null ? ` · conf ${Number(h.confidence).toFixed(2)}` : ""}</span>
                        <span className="ml-auto text-zinc-500 shrink-0">{new Date(h.occurredAt).toLocaleTimeString()}</span>
                      </div>
                      {h.task && <div className="truncate text-zinc-600 dark:text-zinc-400">{h.task.item || h.task.chatName}</div>}
                      {h.notes && <div className="line-clamp-2 text-zinc-500">{h.notes}</div>}
                    </div>
                  ))}
                </div>
                {data.meta.lastEngineActivity && (
                  <p className="text-[11px] text-zinc-500">Last engine activity: {new Date(data.meta.lastEngineActivity).toLocaleString()}</p>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
