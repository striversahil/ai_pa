"use client";

import React, { Fragment, useState, useCallback } from "react";
import { useLiveQuery } from "@/hooks/useLiveData";

interface LeaderRow {
  id: string;
  name: string;
  active: boolean;
  neodoveUserName: string | null;
  conversion: { assigned: number; won: number; conversionRate: number; pipelineValue: number };
  generation: {
    callsAttempted: number;
    callsConnected: number;
    callsNotConnected: number;
    incomingCalls: number;
    outgoingCalls: number;
    talkTimeSec: number;
    leadsConverted: number;
    leadsInProgress: number;
    leadsLost: number;
    leadsGenerated: number;
    followupLeads: number;
    connectedTarget: number;
    connectedPct: number;
    connectedStatus: "green" | "amber" | "red";
    leadsTarget: number;
    leadsPct: number;
    leadsStatus: "green" | "amber" | "red";
  };
  score: number;
}

interface DashData {
  meta: { day: string; requestedDay?: string; usingLatestAvailable?: boolean; unassignedSent: number; activeCount: number; telecallerCount: number; generatedAt: string; targets?: { connectedCallsPerDay: number; leadsPerAgentPerDay: number }; agents?: { id: string; name: string; active: boolean }[] };
  kpi: { assigned: number; won: number; conversionRate: number; pipelineValue: number; callsConnected: number; leadsGenerated: number; talkTimeSec: number };
  leaderboard: LeaderRow[];
  recent: any[];
}

interface FollowUp {
  estimateId: string;
  estimateNumber: string | null;
  customerName: string | null;
  status: string | null;
  total: number | null;
  day: string;
  assignedAt: any;
  assignmentStatus: string;
}

interface AgentViewData {
  meta: { analysis: string; title: string; day: string; requestedDay?: string; usingLatestAvailable?: boolean; agents?: { id: string; name: string; active: boolean }[]; generatedAt: string; error?: string };
  agent: { id: string; name: string; active: boolean; conversion: any; generation: any; score: number; followUpCount: number };
  followUps: FollowUp[];
}

interface RosterRow {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
  order: number;
  neodoveUserId: string | null;
  neodoveUserName: string | null;
  totalAssigned: number;
  activeAssigned: number;
}

type View = "dashboard" | "conversion" | "generation";

const TABS: { key: View; label: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "📊" },
  { key: "conversion", label: "Lead Conversion", icon: "📨" },
  { key: "generation", label: "Lead Generation", icon: "📞" },
];

function fmtTalk(sec: number): string {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtNum(n: number): string {
  return n === 0 ? "0" : n.toLocaleString();
}

const LIGHT_TEXT: Record<string, string> = {
  green: "text-emerald-400",
  amber: "text-amber-400",
  red: "text-rose-400",
};
const LIGHT_BG: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
};
const LIGHT_CHIP: Record<string, string> = {
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  red: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

type TrafficLight = "green" | "amber" | "red";

function worst(a: TrafficLight, b: TrafficLight): TrafficLight {
  if (a === "red" || b === "red") return "red";
  if (a === "amber" || b === "amber") return "amber";
  return "green";
}
const OVERALL_LABEL: Record<TrafficLight, string> = {
  green: "On Track",
  amber: "At Risk",
  red: "Behind",
};

function KraBar({ label, value, target, pct, status }: { label: string; value: number; target: number; pct: number; status: TrafficLight }) {
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
        <div className={`h-full rounded-full ${LIGHT_BG[status]}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export default function TelecallingDashboard() {
  const [view, setView] = useState<View>("dashboard");

  const dash = useLiveQuery<DashData>(
    async () => {
      const res = await fetch("/api/automations/telecalling/data");
      if (!res.ok) throw new Error("load failed");
      return res.json();
    },
    { events: ["automation", "telecalling"] },
  );

  const roster = useLiveQuery<{ telecallers: RosterRow[] }>(
    async () => {
      const res = await fetch("/api/telecallers");
      if (!res.ok) throw new Error("load failed");
      return res.json();
    },
    { events: ["telecalling", "automation"] },
  );

  const [form, setForm] = useState({
    name: "", email: "", active: true, order: 0,
    neodoveUserId: "", neodoveUserName: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sortKey, setSortKey] = useState<"score" | "won" | "callsConnected" | "leadsGenerated">("score");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);

  // Per-agent assigned-estimates dropdown (inline in the leaderboard). Toggle on
  // an agent's row → fetch that agent's open assigned estimates via ?agent=.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const agentDetail = useLiveQuery<AgentViewData | null>(
    async () => {
      if (!expandedId) return null;
      const res = await fetch(`/api/automations/telecalling/data?agent=${encodeURIComponent(expandedId)}`);
      if (!res.ok) throw new Error("load failed");
      return res.json();
    },
    { events: ["automation", "telecalling"], deps: [expandedId] },
  );

  // Per-agent follow-up list (dropdown). Re-fetches whenever the selected agent
  // changes; backend returns that agent's open assigned estimates.
  const agentView = useLiveQuery<AgentViewData | null>(
    async () => {
      if (!agentFilter) return null;
      const res = await fetch(`/api/automations/telecalling/data?agent=${encodeURIComponent(agentFilter)}`);
      if (!res.ok) throw new Error("load failed");
      return res.json();
    },
    { events: ["automation", "telecalling"], deps: [agentFilter] },
  );

  const refreshAll = useCallback(() => {
    dash.refresh();
    roster.refresh();
  }, [dash, roster]);

  const save = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        email: form.email || null,
        active: form.active,
        order: form.order || 0,
        neodoveUserId: form.neodoveUserId || null,
        neodoveUserName: form.neodoveUserName || null,
      };
      if (editingId) {
        await fetch(`/api/telecallers/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch("/api/telecallers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setForm({ name: "", email: "", active: true, order: 0, neodoveUserId: "", neodoveUserName: "" });
      setEditingId(null);
      refreshAll();
    } finally {
      setBusy(false);
    }
  };

  const edit = (t: RosterRow) => {
    setEditingId(t.id);
    setForm({
      name: t.name, email: t.email ?? "", active: t.active, order: t.order,
      neodoveUserId: t.neodoveUserId ?? "", neodoveUserName: t.neodoveUserName ?? "",
    });
  };

  const toggleActive = async (id: string, active: boolean) => {
    setBusy(true);
    try {
      await fetch(`/api/telecallers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      refreshAll();
    } finally {
      setBusy(false);
    }
  };

  const kpi = dash.data?.kpi;
  const board = [...(dash.data?.leaderboard ?? [])];
  const activeBoard = board.filter((r) => r.active);
  const sorted = [...activeBoard].sort((a, b) => {
    if (sortKey === "score") return b.score - a.score;
    if (sortKey === "won") return b.conversion.won - a.conversion.won;
    if (sortKey === "callsConnected") return b.generation.callsConnected - a.generation.callsConnected;
    return b.generation.leadsGenerated - a.generation.leadsGenerated;
  });

  const rosterRows: RosterRow[] = roster.data?.telecallers ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold font-heading text-zinc-900 dark:text-white">Telecalling</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Daily performance · Lead Conversion (estimates) + Lead Generation (NeoDove, live)
              {dash.data?.meta?.day ? ` · ${dash.data.meta.day}` : ""}
              {dash.data?.meta?.usingLatestAvailable ? (
                <span className="ml-1 text-amber-400/90">
                  (today's NeoDove push is empty — showing latest available day)
                </span>
              ) : null}
            </p>
          </div>
          <div className="rounded-xl bg-indigo-600/10 border border-indigo-500/30 px-4 py-3 text-center">
            <div className="text-3xl font-extrabold text-indigo-300">{dash.data?.meta?.unassignedSent ?? "—"}</div>
            <div className="text-[11px] uppercase tracking-wide text-indigo-300/80">Unassigned sent</div>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Sidebar */}
        <aside className="md:w-56 shrink-0">
          <nav className="flex md:flex-col gap-2">
            {TABS.map((t) => {
              const active = view === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setView(t.key)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors text-left ${
                    active
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                  }`}
                >
                  <span className="text-base leading-none">{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content (seamless switch — queries stay mounted) */}
        <div className="flex-1 min-w-0">
          {view === "dashboard" && (
            <div className="space-y-6">
              {kpi && (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                  {[
                    { label: "Est. Assigned", value: fmtNum(kpi.assigned), accent: "text-zinc-900 dark:text-white" },
                    { label: "Est. Won", value: fmtNum(kpi.won), accent: "text-emerald-400" },
                    { label: "Conv. %", value: `${kpi.conversionRate}%`, accent: "text-indigo-300" },
                    { label: "Calls Connected", value: fmtNum(kpi.callsConnected), accent: "text-emerald-300" },
                    { label: "Leads Generated", value: fmtNum(kpi.leadsGenerated), accent: "text-amber-300" },
                    { label: "Talk Time", value: fmtTalk(kpi.talkTimeSec), accent: "text-indigo-300" },
                  ].map((k) => (
                    <div key={k.label} className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-600 dark:text-zinc-500 font-bold">{k.label}</div>
                      <div className={`text-2xl font-extrabold mt-1 ${k.accent}`}>{k.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Leaderboard */}
              <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h3 className="text-lg font-bold">🏆 Leaderboard — Today</h3>
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as any)}
                    className="px-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 cursor-pointer focus:outline-none"
                  >
                    <option value="score">Rank by Composite Score</option>
                    <option value="won">Rank by Estimates Won</option>
                    <option value="callsConnected">Rank by Calls Connected</option>
                    <option value="leadsGenerated">Rank by Leads Generated</option>
                  </select>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-zinc-500 dark:text-zinc-400 text-xs uppercase">
                      <tr className="border-b border-zinc-200 dark:border-zinc-800">
                        <th className="text-left py-2 pr-4">#</th>
                        <th className="text-left py-2 pr-4">Telecaller</th>
                        <th className="text-right py-2 pr-4">Est. Assigned</th>
                        <th className="text-right py-2 pr-4">Est. Won</th>
                        <th className="text-right py-2 pr-4">Conv %</th>
                        <th className="text-right py-2 pr-4">Calls</th>
                        <th className="text-right py-2 pr-4">Leads</th>
                        <th className="text-right py-2 pr-4">Talk</th>
                        <th className="text-right py-2">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((t, i) => {
                        const open = expandedId === t.id;
                        const view = agentDetail.data?.agent?.id === t.id ? agentDetail.data : null;
                        return (
                          <Fragment key={t.id}>
                            <tr className={`border-b border-zinc-100 dark:border-zinc-800/60 ${open ? "bg-indigo-50/40 dark:bg-indigo-500/5" : ""}`}>
                              <td className="py-2 pr-4 text-zinc-500 dark:text-zinc-600 font-bold">{i + 1}</td>
                              <td className="py-2 pr-4">
                                <button
                                  onClick={() => setExpandedId(open ? null : t.id)}
                                  className="inline-flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-white hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
                                  title={open ? "Hide assigned estimates" : "Show assigned estimates"}
                                >
                                  {t.name}
                                  <span className={`text-[10px] text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
                                </button>
                              </td>
                              <td className="py-2 pr-4 text-right font-mono">{t.conversion.assigned}</td>
                              <td className="py-2 pr-4 text-right text-emerald-400 font-mono">{t.conversion.won}</td>
                              <td className="py-2 pr-4 text-right font-mono">{t.conversion.conversionRate}%</td>
                              <td className="py-2 pr-4 text-right font-mono">{fmtNum(t.generation.callsConnected)}</td>
                              <td className="py-2 pr-4 text-right font-mono">{fmtNum(t.generation.leadsGenerated)}</td>
                              <td className="py-2 pr-4 text-right font-mono text-indigo-300">{fmtTalk(t.generation.talkTimeSec)}</td>
                              <td className="py-2 text-right font-extrabold text-indigo-300 font-mono">{t.score}</td>
                            </tr>
                            {open && (
                              <tr className="border-b border-zinc-100 dark:border-zinc-800/60">
                                <td colSpan={9} className="py-2 pr-4">
                                  <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3">
                                    <div className="flex items-center justify-between mb-2">
                                      <h4 className="text-sm font-bold text-zinc-900 dark:text-white">
                                        {t.name} — assigned estimates
                                        <span className="ml-2 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                                          ({view?.agent?.followUpCount ?? t.conversion.assigned})
                                        </span>
                                      </h4>
                                      {view && (
                                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                          {view.agent.conversion?.assigned ?? 0} assigned · {view.agent.conversion?.won ?? 0} won ·{" "}
                                          {view.agent.conversion?.conversionRate ?? 0}% conv
                                        </span>
                                      )}
                                    </div>
                                    {agentDetail.loading && <p className="text-xs text-zinc-500">Loading assigned estimates…</p>}
                                    {!agentDetail.loading && (view?.followUps?.length ?? 0) === 0 && (
                                      <p className="text-xs text-zinc-500">No assigned estimates for this agent.</p>
                                    )}
                                    <div className="grid gap-1.5 sm:grid-cols-2">
                                      {(view?.followUps ?? []).map((f) => (
                                        <div key={f.estimateId} className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5">
                                          <div className="min-w-0">
                                            <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{f.customerName ?? "—"}</div>
                                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">{f.estimateNumber ?? f.estimateId}</div>
                                          </div>
                                          <div className="text-right shrink-0">
                                            <div className="text-[11px] text-zinc-600 dark:text-zinc-300">{f.status ?? "—"}</div>
                                            <div className="text-[11px] font-mono text-emerald-400">₹{fmtNum(Number(f.total ?? 0))}</div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                      {sorted.length === 0 && (
                        <tr><td colSpan={9} className="py-4 text-center text-zinc-500">No active telecallers yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Roster management */}
              <RosterSection
                rosterRows={rosterRows}
                form={form}
                setForm={setForm}
                editingId={editingId}
                busy={busy}
                onEdit={edit}
                onToggleActive={toggleActive}
                onSave={save}
              />
            </div>
          )}

          {view === "conversion" && (
            <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
              <h3 className="text-lg font-bold mb-1">📨 Lead Conversion</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                Sent estimates are distributed evenly across telecallers. Pick an agent to see their follow-up list.
              </p>

              <div className="flex items-center gap-2 mb-4">
                <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Agent:</label>
                <select
                  value={agentFilter ?? ""}
                  onChange={(e) => setAgentFilter(e.target.value || null)}
                  className="px-3 py-1.5 text-sm bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 cursor-pointer focus:outline-none"
                >
                  <option value="">All agents</option>
                  {(dash.data?.meta?.agents ?? activeBoard).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              {!agentFilter && (
                <div className="space-y-2">
                  {activeBoard.length === 0 && <p className="text-sm text-zinc-500">No active telecallers.</p>}
                  {activeBoard.map((t) => (
                    <div key={t.id} className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2">
                      <span className="font-semibold text-zinc-900 dark:text-white">{t.name}</span>
                      <span className="text-xs text-zinc-600 dark:text-zinc-400 font-mono">
                        {t.conversion.assigned} assigned · {t.conversion.won} won · {t.conversion.conversionRate}% · ₹{fmtNum(t.conversion.pipelineValue)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {agentFilter && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-zinc-900 dark:text-white">
                      {agentView.data?.agent?.name ?? "…"} — follow-ups ({agentView.data?.agent?.followUpCount ?? 0})
                    </h4>
                    <button onClick={() => setAgentFilter(null)} className="text-xs text-indigo-400 hover:underline">Back to all</button>
                  </div>
                  {agentView.loading && <p className="text-sm text-zinc-500">Loading…</p>}
                  {!agentView.loading && (agentView.data?.followUps?.length ?? 0) === 0 && (
                    <p className="text-sm text-zinc-500">No follow-up estimates assigned to this agent.</p>
                  )}
                  <div className="space-y-2">
                    {agentView.data?.followUps?.map((f) => (
                      <div key={f.estimateId} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-zinc-900 dark:text-white truncate">{f.customerName ?? "—"}</div>
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">{f.estimateNumber ?? f.estimateId}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs text-zinc-700 dark:text-zinc-300">{f.status ?? "—"}</div>
                          <div className="text-xs font-mono text-emerald-400">₹{fmtNum(Number(f.total ?? 0))}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {view === "generation" && (
            <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
              <h3 className="text-lg font-bold mb-1">📞 Lead Generation</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                Per-telecaller NeoDove performance (live) — sourced from the NeoDove worker database.
                {" "}
                {dash.data?.meta?.targets ? (
                  <span>
                    Benchmarks per agent/day: <span className="text-zinc-700 dark:text-zinc-300 font-semibold">≥ {dash.data.meta.targets.connectedCallsPerDay} connected calls</span> ·{" "}
                    <span className="text-zinc-700 dark:text-zinc-300 font-semibold">≥ {dash.data.meta.targets.leadsPerAgentPerDay} leads</span> (in-progress + converted). Traffic light: 🟢 ≥100% · 🟡 60–99% · 🔴 &lt;60%
                  </span>
                ) : null}
              </p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {activeBoard.map((t) => {
                  const g = t.generation;
                  const overall = worst(g.connectedStatus, g.leadsStatus);
                  return (
                    <div
                      key={t.id}
                      className={`rounded-xl border p-4 space-y-3 bg-zinc-50 dark:bg-zinc-900 ${
                        overall === "green" ? "border-emerald-500/30" : overall === "amber" ? "border-amber-500/30" : "border-rose-500/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-bold text-zinc-900 dark:text-white truncate block">{t.name}</span>
                          <span className="text-[10px] text-zinc-600 dark:text-zinc-500">{t.neodoveUserName ?? "—"}</span>
                        </div>
                        <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-extrabold uppercase tracking-wide ${LIGHT_CHIP[overall]}`}>
                          {OVERALL_LABEL[overall]}
                        </span>
                      </div>
                      <KraBar label="Connected Calls" value={g.callsConnected} target={g.connectedTarget} pct={g.connectedPct} status={g.connectedStatus} />
                      <KraBar label="Leads Generated" value={g.leadsGenerated} target={g.leadsTarget} pct={g.leadsPct} status={g.leadsStatus} />
                      <div className="flex items-center justify-between pt-1 border-t border-zinc-200/80 dark:border-zinc-800/80 text-[10px] text-zinc-600 dark:text-zinc-500">
                        <span>Lead Conversion</span>
                        <span className="font-mono text-zinc-500 dark:text-zinc-400">
                          {t.conversion.won} won / {t.conversion.assigned} assigned
                        </span>
                      </div>
                      {(() => {
                        const open = expandedId === t.id;
                        const view = agentDetail.data?.agent?.id === t.id ? agentDetail.data : null;
                        return (
                          <div className="pt-1 border-t border-zinc-200/80 dark:border-zinc-800/80">
                            <button
                              onClick={() => setExpandedId(open ? null : t.id)}
                              className="w-full inline-flex items-center justify-between gap-2 text-xs font-semibold text-indigo-500 dark:text-indigo-400 hover:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
                            >
                              <span>Assigned estimates ({view?.agent?.followUpCount ?? t.conversion.assigned})</span>
                              <span className={`text-[10px] text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
                            </button>
                            {open && (
                              <div className="mt-2 space-y-1.5">
                                {agentDetail.loading && <p className="text-[11px] text-zinc-500">Loading…</p>}
                                {!agentDetail.loading && (view?.followUps?.length ?? 0) === 0 && (
                                  <p className="text-[11px] text-zinc-500">No assigned estimates.</p>
                                )}
                                {(view?.followUps ?? []).map((f) => (
                                  <div key={f.estimateId} className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 bg-white dark:bg-zinc-950">
                                    <div className="min-w-0">
                                      <div className="text-[11px] font-semibold text-zinc-900 dark:text-white truncate">{f.customerName ?? "—"}</div>
                                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono truncate">{f.estimateNumber ?? f.estimateId}</div>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <div className="text-[10px] text-zinc-600 dark:text-zinc-300">{f.status ?? "—"}</div>
                                      <div className="text-[10px] font-mono text-emerald-400">₹{fmtNum(Number(f.total ?? 0))}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
                {activeBoard.length === 0 && (
                  <p className="text-sm text-zinc-500">No active telecallers yet — add them in the Dashboard roster and link each to their NeoDove user.</p>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function RosterSection({
  rosterRows,
  form,
  setForm,
  editingId,
  busy,
  onEdit,
  onToggleActive,
  onSave,
}: {
  rosterRows: RosterRow[];
  form: { name: string; email: string; active: boolean; order: number; neodoveUserId: string; neodoveUserName: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; email: string; active: boolean; order: number; neodoveUserId: string; neodoveUserName: string }>>;
  editingId: string | null;
  busy: boolean;
  onEdit: (t: RosterRow) => void;
  onToggleActive: (id: string, active: boolean) => void;
  onSave: () => void;
}) {
  const [rosterTab, setRosterTab] = useState<"active" | "inactive">("active");
  const activeRows = rosterRows.filter((r) => r.active);
  const inactiveRows = rosterRows.filter((r) => !r.active);
  const visible = rosterTab === "active" ? activeRows : inactiveRows;
  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
      <h3 className="text-lg font-bold mb-3">Telecaller Roster</h3>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mb-5">
        {rosterRows.map((t) => (
          <div key={t.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-zinc-900 dark:text-white">{t.name}</div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${t.active ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-500"}`}>
                {t.active ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
              {t.neodoveUserName ? `NeoDove: ${t.neodoveUserName}` : "NeoDove: not linked"}
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Total assigned: {t.totalAssigned}</div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => onEdit(t)} className="flex-1 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 py-1.5 font-semibold hover:bg-zinc-200 dark:hover:bg-zinc-700">Edit</button>
              <button onClick={() => onToggleActive(t.id, t.active)} className={`flex-1 text-xs rounded-lg py-1.5 font-semibold ${
                t.active
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
              }`}>
                {t.active ? "Make inactive" : "Reactivate"}
              </button>
            </div>
          </div>
        ))}
        {rosterRows.length === 0 && <p className="text-sm text-zinc-500">No telecallers yet — add one below.</p>}
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4 grid gap-2 md:grid-cols-[1fr_1fr_auto_auto_1fr_1fr]">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name"
          className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm" />
        <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email (opt)"
          className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm" />
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 px-2">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="accent-indigo-500" /> Active
        </label>
        <input value={form.neodoveUserName} onChange={(e) => setForm({ ...form, neodoveUserName: e.target.value })} placeholder="NeoDove user"
          className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm" />
        <input value={form.neodoveUserId} onChange={(e) => setForm({ ...form, neodoveUserId: e.target.value })} placeholder="NeoDove user id (opt)"
          className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm" />
        <button onClick={onSave} disabled={busy}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-60">
          {editingId ? "Update" : "Add"}
        </button>
      </div>
      <p className="text-[11px] text-zinc-500 dark:text-zinc-600 mt-2">
        Link each telecaller to their NeoDove agent (user name) so Lead Generation merges with Lead Conversion. Use
        {" "}<span className="font-semibold text-zinc-600 dark:text-zinc-400">Make inactive</span> to hide a telecaller's data
        from the Dashboard, Lead Conversion and Lead Generation views (they stay in this roster so you can Reactivate them).
      </p>
    </section>
  );
}
