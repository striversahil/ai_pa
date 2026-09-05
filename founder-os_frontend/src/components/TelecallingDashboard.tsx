"use client";

import React, { Fragment, useState, useCallback, useEffect } from "react";
import { Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useLiveQuery } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";

interface LeaderRow {
  id: string;
  name: string;
  active: boolean;
  neodoveUserName: string | null;
  conversion: { assigned: number; won: number; conversionRate: number; pipelineValue: number; estimatedConversion: { count: number; value: number }; credit: { won: number; value: number } };
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
  risk?: { atRisk: number; zombie: number };
}

interface RiskRow {
  estimateId: string;
  estimateNumber: string;
  customerName: string;
  telecallerName: string | null;
  total: number;
  risk: "ok" | "pending" | "red" | "zombie";
  lastCommentDate: string | null;
  staleHours: number | null;
  reasoning: string | null;
  snatchReason?: string | null;
  snatchInHours?: number | null;
}

interface DashData {
  meta: { day: string; requestedDay?: string; usingLatestAvailable?: boolean; unassignedSent: number; activeCount: number; telecallerCount: number; generatedAt: string; period?: string; periodLabel?: string; periodFrom?: string | null; periodTo?: string | null; workingDays?: number; targets?: { connectedCallsPerDay: number; leadsPerAgentPerDay: number }; agents?: { id: string; name: string; active: boolean }[] };
  kpi: { assigned: number; won: number; conversionRate: number; pipelineValue: number; callsConnected: number; leadsGenerated: number; talkTimeSec: number };
  leaderboard: LeaderRow[];
  recent: any[];
  risk?: {
    counts: { open: number; ok: number; pending: number; red: number; zombie: number };
    valueAtRisk: number;
    atRisk: RiskRow[];
  };
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
  /** Verdict from the 15-min Zoho analyzer (Classification.meaningfulUpdate). */
  satisfactory?: boolean | null;
  intentScore?: number | null;
  analysisSummary?: string | null;
  lastCommentDate?: string | null;
  staleHours?: number | null;
  risk?: "ok" | "pending" | "red" | "zombie";
  snatchReason?: string | null;
  snatchInHours?: number | null;
}

/** Satisfactory / Unsatisfactory chip from the periodic Zoho AI analysis. */
function SatChip({ value, compact = false }: { value: boolean | null | undefined; compact?: boolean }) {
  const base = `inline-flex items-center gap-1 shrink-0 rounded-full border font-semibold ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`;
  if (value === true)
    return (
      <span title="Zoho analyzer found a meaningful update" className={`${base} bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30`}>
        ✓{compact ? "" : " Satisfactory"}
      </span>
    );
  if (value === false)
    return (
      <span title="No meaningful update yet — needs another call" className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ✕{compact ? "" : " Unsatisfactory"}
      </span>
    );
  return (
    <span title="Awaiting the next Zoho analyzer pass" className={`${base} bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-400/40`}>
      …{compact ? "" : " Pending"}
    </span>
  );
}

/** Time-since-last-comment chip — the "clock is ticking" signal for agents. */
function StaleChip({ staleHours, compact = false }: { staleHours: number | null | undefined; compact?: boolean }) {
  const base = `inline-flex items-center gap-1 shrink-0 rounded-full border font-semibold ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`;
  if (staleHours === null || staleHours === undefined)
    return (
      <span title="No sales comment synced from Zoho yet" className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ∅{compact ? "" : " No comments"}
      </span>
    );
  const days = Math.floor(staleHours / 24);
  if (days >= 2)
    return (
      <span title={`Last comment ${days} days ago — zombie territory (silent > 2 days = reassigned)`} className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ⏰{compact ? "" : ` ${days}d stale`}
      </span>
    );
  if (staleHours >= 24)
    return (
      <span title="Last comment was more than a day ago" className={`${base} bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/30`}>
        ⏰{compact ? "" : " 1d+"}
      </span>
    );
  return (
    <span title="Commented within the last 24 hours" className={`${base} bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30`}>
      ●{compact ? "" : " Fresh"}
    </span>
  );
}

/** EOD snatch countdown chip — the "get a meaningful update before 9 PM" signal. */
function SnatchChip({ risk, snatchInHours, compact = false }: { risk?: string | null; snatchInHours?: number | null; compact?: boolean }) {
  const base = `inline-flex items-center gap-1 shrink-0 rounded-full border font-semibold ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`;
  if (risk === "zombie")
    return (
      <span title="Silent for over 2 days — will be snatched at tonight's EOD sweep" className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ☠{compact ? "" : " Zombie"}
      </span>
    );
  if (risk === "red")
    return (
      <span title={`Unsatisfactory remark — snatched at EOD${snatchInHours != null ? ` in ~${snatchInHours}h` : ""}`} className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ⚠{compact ? "" : ` Snatch in ${snatchInHours != null ? `~${snatchInHours}h` : "EOD"}`}
      </span>
    );
  if (risk === "pending")
    return (
      <span title="Awaiting the AI verdict" className={`${base} bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/30`}>
        ⏳{compact ? "" : " Analyzing"}
      </span>
    );
  return (
    <span title="Meaningful update logged — safe from tonight's sweep" className={`${base} bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30`}>
      🛡{compact ? "" : " Safe"}
    </span>
  );
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

type View = "dashboard" | "conversion" | "generation" | "controller";

const TABS: { key: View; label: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "📊" },
  { key: "conversion", label: "Lead Conversion", icon: "📨" },
  { key: "generation", label: "Lead Generation", icon: "📞" },
  // MIS-only controller tab (filtered out of the nav without the `mis` scope).
  { key: "controller", label: "Controller", icon: "🎛️" },
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
  const { me } = useAuth();
  const [period, setPeriod] = useState<"today" | "week" | "lastweek" | "month" | "lastmonth" | "year" | "lastyear">("week");
  const PERIOD_OPTIONS: { key: typeof period; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "lastweek", label: "Last Week" },
    { key: "month", label: "This Month" },
    { key: "lastmonth", label: "Last Month" },
    { key: "year", label: "This Year" },
    { key: "lastyear", label: "Last Year" },
  ];
  // Roster is the assignment controller — visible/editable only with the
  // `mis` scope (root/admin always allowed).
  const canManageRoster = !!me && (me.isAdmin || me.scopes.includes("mis"));

  const dash = useLiveQuery<DashData>(
    async () => {
      const res = await fetch(`/api/automations/telecalling/data?period=${period}`);
      if (!res.ok) throw new Error(`Failed to load leaderboard (HTTP ${res.status})`);
      return res.json();
    },
    { events: ["automation", "telecalling"], deps: [period], clearOnError: true },
  );

  // Lead Conversion is the default view with no period filtering — it hits the
  // plain dashboard endpoint (no ?period=) and stays independent of the
  // Dashboard's filter.
  const convDash = useLiveQuery<DashData>(
    async () => {
      const res = await fetch("/api/automations/telecalling/data");
      if (!res.ok) throw new Error("Conversion load failed");
      return res.json();
    },
    { events: ["automation", "telecalling"], clearOnError: true },
  );

  // Lead Generation has its OWN period filter — independent of the leaderboard
  // period, so filtering the dashboard/conversion never changes the Generation
  // view. Same endpoint, different period param.
  const [genPeriod, setGenPeriod] = useState<typeof period>("week");
  const genDash = useLiveQuery<DashData>(
    async () => {
      const res = await fetch(`/api/automations/telecalling/data?period=${genPeriod}`);
      if (!res.ok) throw new Error("Gen load failed");
      return res.json();
    },
    { events: ["automation", "telecalling"], deps: [genPeriod], clearOnError: true },
  );

  const roster = useLiveQuery<{ telecallers: RosterRow[] }>(
    async () => {
      if (!canManageRoster) return { telecallers: [] };
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
  const [sortKey, setSortKey] = useState<"score" | "won" | "callsConnected" | "leadsGenerated" | "estConv">("score");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Prefetch EVERY active agent's data in parallel (one round of requests),
  // refreshed on live events. Switching agents then reads from the local map —
  // instant, and it never shows another agent's stale data while loading.
  // Keyed off the CONVERSION data (default view) so agent follow-ups always
  // load regardless of what Dashboard period filter is active.
  const activeAgentIds = (convDash.data?.leaderboard ?? dash.data?.leaderboard ?? [])
    .filter((r) => r.active)
    .map((r) => r.id);
  const agentIdsKey = activeAgentIds.join(",");
  const agentViews = useLiveQuery<Record<string, AgentViewData | null>>(
    async () => {
      if (!agentIdsKey) return {};
      const ids = agentIdsKey.split(",");
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`/api/automations/telecalling/data?agent=${encodeURIComponent(id)}`);
            return [id, res.ok ? ((await res.json()) as AgentViewData) : null] as const;
          } catch {
            return [id, null] as const;
          }
        }),
      );
      return Object.fromEntries(entries);
    },
    { events: ["automation", "telecalling"], deps: [agentIdsKey], clearOnError: true },
  );
  const agentViewsMap = agentViews.data ?? {};
  const getAgentView = (id: string | null): AgentViewData | null => (id ? agentViewsMap[id] ?? null : null);
  const selectedAgentView = getAgentView(agentFilter);

  const refreshAll = useCallback(() => {
    dash.refresh();
    roster.refresh();
  }, [dash, roster]);

  // ── Deleted agents (MIS Controller) ──────────────────────────────────────
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedRows, setDeletedRows] = useState<RosterRow[]>([]);
  const loadDeleted = useCallback(async () => {
    if (!canManageRoster) return;
    try {
      const res = await fetch("/api/telecallers?deleted=1");
      if (res.ok) setDeletedRows((await res.json()).telecallers ?? []);
    } catch { /* ignore */ }
  }, [canManageRoster]);
  useEffect(() => {
    if (showDeleted) void loadDeleted();
  }, [showDeleted, loadDeleted]);
  const deleteTelecaller = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/telecallers/${id}`, { method: "DELETE" });
      refreshAll();
      void loadDeleted();
    } finally {
      setBusy(false);
    }
  };
  // Pretty in-house confirm (replaces window.confirm) for roster deletion.
  const [confirmDelete, setConfirmDelete] = useState<RosterRow | null>(null);
  const restoreTelecaller = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/telecallers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleted: false }),
      });
      refreshAll();
      void loadDeleted();
    } finally {
      setBusy(false);
    }
  };

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
  // Lead Conversion board — driven by ITS OWN convDash/period, not the dashboard.
  const convBoard = [...(convDash.data?.leaderboard ?? [])];
  const convActiveBoard = convBoard.filter((r) => r.active);
  // Lead Generation board — driven by its OWN genDash/period, not the leaderboard period.
  const genBoard = [...(genDash.data?.leaderboard ?? [])];
  const genActiveBoard = genBoard.filter((r) => r.active);
  const teamEstConv = activeBoard.reduce((s, r) => s + (r.conversion.estimatedConversion?.value ?? 0), 0);
  const sorted = [...activeBoard].sort((a, b) => {
    if (sortKey === "score") return b.score - a.score;
    if (sortKey === "won") return b.conversion.won - a.conversion.won;
    if (sortKey === "callsConnected") return b.generation.callsConnected - a.generation.callsConnected;
    if (sortKey === "estConv") return b.conversion.estimatedConversion.value - a.conversion.estimatedConversion.value;
    return b.generation.leadsGenerated - a.generation.leadsGenerated;
  });

  const rosterRows: RosterRow[] = roster.data?.telecallers ?? [];
  const leaderScore = sorted[0]?.score ?? 0;

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={!!confirmDelete}
        title={`Delete ${confirmDelete?.name ?? "telecaller"}?`}
        message="They disappear from the roster, leaderboard and assignment engine. You can restore them anytime from Deleted Agents in the Controller."
        confirmLabel="Delete agent"
        busy={busy}
        onConfirm={() => { const id = confirmDelete?.id; setConfirmDelete(null); if (id) void deleteTelecaller(id); }}
        onCancel={() => setConfirmDelete(null)}
      />
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

      <div className="flex flex-col gap-6">
        {/* Tabs (full-width horizontal row) */}
        <aside className="w-full shrink-0">
          <nav className="flex flex-row flex-wrap gap-2">
            {TABS.filter((t) => t.key !== "controller" || canManageRoster).map((t) => {
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
                    { label: "Est. Conv ₹", value: fmtNum(teamEstConv), accent: "text-indigo-300", title: "Projected closed value across the open pipeline (agent win rate × live estimate risk)" },
                    { label: "Calls Connected", value: fmtNum(kpi.callsConnected), accent: "text-emerald-300" },
                    { label: "Leads Generated", value: fmtNum(kpi.leadsGenerated), accent: "text-amber-300" },
                    { label: "Talk Time", value: fmtTalk(kpi.talkTimeSec), accent: "text-indigo-300" },
                  ].map((k) => (
                    <div key={k.label} title={k.title} className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-600 dark:text-zinc-500 font-bold">{k.label}</div>
                      <div className={`text-2xl font-extrabold mt-1 ${k.accent}`}>{k.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Leaderboard */}
              <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-lg font-bold">🏆 Leaderboard — {dash.data?.meta?.periodLabel ?? "Today"}</h3>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mt-0.5" title="Composite score formula">
                      1 close = <span className="font-bold text-emerald-400">+100</span> · 1 lead ={" "}
                      <span className="font-bold text-amber-400">+15</span> · 1 connected call ={" "}
                      <span className="font-bold text-indigo-300">+0.5</span>
                    </p>
                  </div>
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as any)}
                    className="px-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 cursor-pointer focus:outline-none"
                  >
                    <option value="estConv">Rank by Est. Conversion ₹</option>
                    <option value="score">Rank by Composite Score</option>
                    <option value="won">Rank by Estimates Won</option>
                    <option value="callsConnected">Rank by Calls Connected</option>
                    <option value="leadsGenerated">Rank by Leads Generated</option>
                  </select>
                </div>
                {/* Period switcher (chase window) */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {PERIOD_OPTIONS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => setPeriod(p.key)}
                      className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                        period === p.key
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:border-indigo-400"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {/* Chase podium — top 3 with gaps (score ranking only) */}
                {sortKey === "score" && sorted.length >= 2 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                    {sorted.slice(0, 3).map((t, i) => {
                      const medals = ["🥇", "🥈", "🥉"];
                      const gap = i > 0 ? sorted[i - 1].score - t.score : sorted[1] ? t.score - sorted[1].score : 0;
                      return (
                        <div
                          key={t.id}
                          className={`rounded-xl border p-3 flex items-center gap-3 ${
                            i === 0
                              ? "border-amber-400/40 bg-amber-400/5"
                              : i === 1
                                ? "border-zinc-300/50 dark:border-zinc-600/40 bg-zinc-400/5"
                                : "border-orange-400/30 bg-orange-400/5"
                          }`}
                        >
                          <div className="text-2xl shrink-0">{medals[i]}</div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-sm text-zinc-900 dark:text-white truncate">{t.name}</div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                              {t.conversion.won} won · {fmtNum(t.generation.leadsGenerated)} leads · {fmtNum(t.generation.callsConnected)} calls
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-extrabold font-mono text-indigo-300">{t.score}</div>
                            <div className={`text-[10px] font-bold ${i === 0 ? "text-emerald-400" : "text-rose-400"}`}>
                              {i === 0 ? `+${gap} ahead` : `${gap} to #${i}`}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-zinc-500 dark:text-zinc-400 text-xs uppercase">
                      <tr className="border-b border-zinc-200 dark:border-zinc-800">
                        <th className="text-left py-2 pr-4">#</th>
                        <th className="text-left py-2 pr-4 min-w-[11rem]">Telecaller</th>
                        <th className="text-right py-2 pr-4">Est. Assigned</th>
                        <th className="text-right py-2 pr-4">Est. Won</th>
                        <th className="text-right py-2 pr-4">Conv %</th>
                        <th className="text-right py-2 pr-4">Est. Conv ₹</th>
                        <th className="text-right py-2 pr-4">Calls</th>
                        <th className="text-right py-2 pr-4">Leads</th>
                        <th className="text-right py-2 pr-4">Talk</th>
                        <th className="text-right py-2 pr-4">Risk</th>
                        <th className="text-right py-2">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((t, i) => {
                        const open = expandedId === t.id;
                        const view = getAgentView(t.id);
                        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
                        const podium = i < 3;
                        return (
                          <Fragment key={t.id}>
                            <tr className={`border-b border-zinc-100 dark:border-zinc-800/60 ${open ? "bg-indigo-50/40 dark:bg-indigo-500/5" : podium ? (i === 0 ? "bg-amber-500/10" : "bg-zinc-500/5") : ""}`}>
                              <td className={`py-2 pr-4 font-bold text-lg ${podium ? "" : "text-zinc-500 dark:text-zinc-600"}`} title={podium ? `Rank #${i + 1} — projected + co-credited close value` : `Rank #${i + 1}`}>
                                {medal ?? i + 1}
                              </td>
                              <td className="py-2 pr-4 min-w-[11rem]">
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
                              <td className="py-2 pr-4 text-right text-emerald-400 font-mono whitespace-nowrap">
                                {t.conversion.won}
                                {(t.conversion.credit?.won ?? 0) > 0 && (
                                  <span className="ml-1 text-[10px] font-bold text-amber-500 dark:text-amber-400" title={`Co-credited closes (originator 0.6 + closer 0.4): ₹${fmtNum(t.conversion.credit?.value ?? 0)} co-credited value`}>
                                    +🏅{t.conversion.credit?.won?.toFixed(1)}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 pr-4 text-right font-mono">{t.conversion.conversionRate}%</td>
                              <td className="py-2 pr-4 text-right font-mono text-indigo-200">{fmtNum(t.conversion.estimatedConversion?.value ?? 0)}</td>
                              <td className="py-2 pr-4 text-right font-mono">{fmtNum(t.generation.callsConnected)}</td>
                              <td className="py-2 pr-4 text-right font-mono">{fmtNum(t.generation.leadsGenerated)}</td>
                              <td className="py-2 pr-4 text-right font-mono text-indigo-300">{fmtTalk(t.generation.talkTimeSec)}</td>
                              <td className="py-2 pr-4 text-right font-mono whitespace-nowrap">
                                {(t.risk?.atRisk ?? 0) + (t.risk?.zombie ?? 0) > 0 ? (
                                  <span className="text-rose-400 font-bold" title="Open estimates red (no meaningful update) or zombie (silent > 2 days) — lost at EOD">
                                    {t.risk?.atRisk ?? 0}⚠ / {t.risk?.zombie ?? 0}☠
                                  </span>
                                ) : (
                                  <span className="text-emerald-400" title="No estimates at risk">✓</span>
                                )}
                              </td>
                              <td className="py-2 text-right whitespace-nowrap">
                                <div className="flex items-center justify-end gap-2">
                                  <span className="font-extrabold text-indigo-300 font-mono">{t.score}</span>
                                  {sortKey === "score" && leaderScore > 0 && (
                                    <>
                                      <span
                                        className="hidden sm:inline-block w-12 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden"
                                        title={`${Math.round((t.score / leaderScore) * 100)}% of the leader's score`}
                                      >
                                        <span
                                          className={`block h-full rounded-full ${i === 0 ? "bg-amber-400" : "bg-indigo-400"}`}
                                          style={{ width: `${Math.max(6, Math.round((t.score / leaderScore) * 100))}%` }}
                                        />
                                      </span>
                                      {i > 0 && (
                                        <span className="text-[10px] text-zinc-500 dark:text-zinc-500 font-semibold" title={`Points behind rank #${i}`}>
                                          {sorted[i - 1].score - t.score} to #{i}
                                        </span>
                                      )}
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {open && (
                              <tr className="border-b border-zinc-100 dark:border-zinc-800/60">
                                <td colSpan={11} className="py-2 pr-4">
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
                                          {view.agent.conversion?.conversionRate ?? 0}% conv · Est. Conv ₹{" "}
                                          {fmtNum(view.agent.conversion?.estimatedConversion?.value ?? 0)}
                                        </span>
                                      )}
                                    </div>
                                    {agentViews.loading && !view && <p className="text-xs text-zinc-500">Loading assigned estimates…</p>}
                                    {!agentViews.loading && (view?.followUps?.length ?? 0) === 0 && (
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
                        <tr><td colSpan={10} className="py-4 text-center text-zinc-500">No active telecallers yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Founder pre-warning: open estimates about to be snatched at EOD */}
              {dash.data?.risk && (dash.data.risk.counts.red > 0 || dash.data.risk.counts.zombie > 0) && (
                <section className="bg-rose-500/5 border border-rose-500/30 rounded-xl p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h3 className="text-lg font-bold text-rose-500 dark:text-rose-400">🔥 At Risk — about to be snatched at EOD (9 PM IST)</h3>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                      <span className="font-mono font-bold text-rose-400">₹{fmtNum(dash.data.risk.valueAtRisk)}</span> at risk ·{" "}
                      <span className="font-bold text-rose-400">{dash.data.risk.counts.red} red</span> ·{" "}
                      <span className="font-bold text-rose-400">{dash.data.risk.counts.zombie} zombie</span>
                    </span>
                  </div>
                  <div className="grid gap-1.5 md:grid-cols-2">
                    {dash.data.risk.atRisk.map((r) => (
                      <div key={r.estimateId} className="rounded-md border border-rose-500/20 bg-white dark:bg-zinc-950 px-2.5 py-1.5" title={r.snatchReason ?? r.reasoning ?? undefined}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{r.customerName ?? "—"}</div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">{r.estimateNumber ?? r.estimateId} · {r.telecallerName ?? "—"}</div>
                          </div>
                          <div className="text-right shrink-0 space-y-0.5">
                            <div className="text-[11px] font-mono text-emerald-400">₹{fmtNum(Number(r.total ?? 0))}</div>
                            <div className="flex justify-end gap-1">
                              <StaleChip compact staleHours={r.staleHours} />
                              <SnatchChip compact risk={r.risk} snatchInHours={r.snatchInHours} />
                            </div>
                          </div>
                        </div>
                        {(r.snatchReason || r.reasoning) && (
                          <p className="text-[11px] text-rose-600/80 dark:text-rose-400/70 mt-1 leading-snug line-clamp-2">
                            {r.snatchReason ?? r.reasoning}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-600 mt-2">
                    Red = latest AI verdict found no meaningful update · Zombie = no comment for over 2 days. Both are re-poached to a higher-converting agent at tonight's sweep.
                  </p>
                </section>
              )}

              {/* Roster management has moved to the MIS-only Controller tab */}
            </div>
          )}

          {view === "conversion" && (
            <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
              <div className="mb-3">
                <h3 className="text-lg font-bold mb-1">📨 Lead Conversion</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Sent estimates are distributed across telecallers. Switch between agent tabs to see each one's assigned estimates.
                </p>
              </div>

              {/* Horizontal agent tabs */}
              <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1">
                <button
                  onClick={() => setAgentFilter(null)}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                    !agentFilter
                      ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                      : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500"
                  }`}
                >
                  All
                </button>
                {(convDash.data?.meta?.agents ?? convActiveBoard).filter((a) => a.active).map((t) => {
                  const board = convActiveBoard.find((b) => b.id === t.id);
                  const count = board?.conversion.assigned ?? 0;
                  const active = agentFilter === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setAgentFilter(active ? null : t.id)}
                      className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                        active
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500"
                      }`}
                    >
                      {t.name}
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${active ? "bg-white/20" : "bg-zinc-100 dark:bg-zinc-700/60 text-zinc-500 dark:text-zinc-400"}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {!agentFilter && (
                <div className="space-y-2">
                  {convActiveBoard.length === 0 && <p className="text-sm text-zinc-500">No active telecallers.</p>}
                  {convActiveBoard.map((t) => (
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
                      {selectedAgentView?.agent?.name ?? "…"} — follow-ups ({selectedAgentView?.agent?.followUpCount ?? 0})
                    </h4>
                    <button onClick={() => setAgentFilter(null)} className="text-xs text-indigo-400 hover:underline">Back to all</button>
                  </div>
                  {agentViews.loading && !selectedAgentView && <p className="text-sm text-zinc-500">Loading…</p>}
                  {!agentViews.loading && (selectedAgentView?.followUps?.length ?? 0) === 0 && (
                    <p className="text-sm text-zinc-500">No follow-up estimates assigned to this agent.</p>
                  )}
                  <div className="space-y-2">
                    {selectedAgentView?.followUps?.map((f) => (
                      <div key={f.estimateId} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 space-y-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="font-semibold text-sm text-zinc-900 dark:text-white truncate min-w-0">{f.customerName ?? "—"}</div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <SatChip value={f.satisfactory} />
                            <StaleChip staleHours={f.staleHours} />
                            <SnatchChip risk={f.risk} snatchInHours={f.snatchInHours} />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">{f.estimateNumber ?? f.estimateId}</div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-zinc-700 dark:text-zinc-300">{f.status ?? "—"}</span>
                            <span className="text-xs font-mono text-emerald-400">₹{fmtNum(Number(f.total ?? 0))}</span>
                          </div>
                        </div>
                        {(f.risk === "red" || f.risk === "zombie") && f.snatchReason && (
                          <p className="text-[11px] text-rose-600/80 dark:text-rose-400/70 leading-snug line-clamp-2" title={f.snatchReason}>
                            {f.snatchReason}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Controller — MIS-only: roster + all telecalling control actions */}
          {view === "controller" && (
            canManageRoster ? (
              <div className="space-y-6">
                <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
                  <h3 className="text-lg font-bold mb-1">🎛️ Controller</h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                    MIS-level control of telecalling — the roster below drives the automatic
                    estimate assignment and end-of-day reassignment engine. Changes apply from
                    the next rotation.
                  </p>
                </section>
                <RosterSection
                  rosterRows={rosterRows}
                  form={form}
                  setForm={setForm}
                  editingId={editingId}
                  busy={busy}
                  onEdit={edit}
                  onToggleActive={toggleActive}
                  onSave={save}
                  onDelete={(t) => setConfirmDelete(t)}
                  onRestore={restoreTelecaller}
                  deletedRows={deletedRows}
                  showDeleted={showDeleted}
                  onToggleShowDeleted={(o) => {
                    setShowDeleted(o);
                    if (o) void loadDeleted();
                  }}
                />
              </div>
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-600 px-1">
                🔒 Controller is restricted to MIS-level users.
              </p>
            )
          )}

          {view === "generation" && (
            <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
              <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-lg font-bold mb-1">📞 Lead Generation</h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Per-telecaller NeoDove performance (live) — sourced from the NeoDove worker database.
                  </p>
                </div>
                {/* Independent period filter for Lead Generation */}
                <div className="flex flex-wrap gap-1.5">
                  {PERIOD_OPTIONS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => setGenPeriod(p.key)}
                      className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                        genPeriod === p.key
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:border-indigo-400"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                {genDash.data?.meta?.targets ? (
                  <span>
                    Benchmarks per agent for <span className="font-bold">{genDash.data.meta.periodLabel ?? "Today"}</span>
                    {genDash.data.meta.workingDays && genDash.data.meta.workingDays > 1 ? ` (${genDash.data.meta.workingDays} working days × daily target)` : ""}:{" "}
                    <span className="text-zinc-700 dark:text-zinc-300 font-semibold">≥ {genDash.data.meta.targets.connectedCallsPerDay} connected calls</span> ·{" "}
                    <span className="text-zinc-700 dark:text-zinc-300 font-semibold">≥ {genDash.data.meta.targets.leadsPerAgentPerDay} leads</span> (in-progress + converted). Traffic light: 🟢 ≥100% · 🟡 60–99% · 🔴 &lt;60%
                  </span>
                ) : null}
              </p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {genActiveBoard.map((t) => {
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
                        const view = getAgentView(t.id);
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
                                {agentViews.loading && !view && <p className="text-[11px] text-zinc-500">Loading…</p>}
                                {!agentViews.loading && (view?.followUps?.length ?? 0) === 0 && (
                                  <p className="text-[11px] text-zinc-500">No assigned estimates.</p>
                                )}
                                {(view?.followUps ?? []).map((f) => (
                                  <div key={f.estimateId} className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 bg-white dark:bg-zinc-950">
                                    <div className="min-w-0">
                                      <div className="text-[11px] font-semibold text-zinc-900 dark:text-white truncate">{f.customerName ?? "—"}</div>
                                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono truncate">{f.estimateNumber ?? f.estimateId}</div>
                                    </div>
                                    <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                                      <div className="flex items-center gap-1">
                                        <SatChip value={f.satisfactory} compact />
                                        <StaleChip staleHours={f.staleHours} compact />
                                      </div>
                                      <SnatchChip risk={f.risk} snatchInHours={f.snatchInHours} compact />
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
                {genActiveBoard.length === 0 && (
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
  onDelete,
  onRestore,
  deletedRows,
  showDeleted,
  onToggleShowDeleted,
}: {
  rosterRows: RosterRow[];
  form: { name: string; email: string; active: boolean; order: number; neodoveUserId: string; neodoveUserName: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; email: string; active: boolean; order: number; neodoveUserId: string; neodoveUserName: string }>>;
  editingId: string | null;
  busy: boolean;
  onEdit: (t: RosterRow) => void;
  onToggleActive: (id: string, active: boolean) => void;
  onSave: () => void;
  onDelete: (t: RosterRow) => void;
  onRestore: (id: string) => void;
  deletedRows: RosterRow[];
  showDeleted: boolean;
  onToggleShowDeleted: (open: boolean) => void;
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
              <button
                onClick={() => onDelete(t)}
                disabled={busy}
                className="inline-flex items-center justify-center rounded-lg bg-rose-500/10 text-rose-500 dark:text-rose-400 p-2 hover:bg-rose-500/20 disabled:opacity-40"
                title="Delete agent — hidden everywhere, restorable from Deleted Agents"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {rosterRows.length === 0 && <p className="text-sm text-zinc-500">No telecallers yet — add one below.</p>}
      </div>

      {/* Deleted agents — hidden from the roster/leaderboard, restorable */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 pt-3 mt-3">
        <button
          onClick={() => onToggleShowDeleted(!showDeleted)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:border-rose-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors"
          title="Expand/collapse deleted agents (restorable)"
        >
          <span className={`transition-transform inline-block ${showDeleted ? "rotate-90" : ""}`}>▸</span>
          <Trash2 className="w-4 h-4" />
          Deleted agents ({deletedRows.length})
        </button>

        {showDeleted && (
          <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {deletedRows.map((t) => (
              <div key={t.id} className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-sm text-zinc-800 dark:text-zinc-200">{t.name}</div>
                  <span className="text-[10px] px-2 py-1 rounded-full bg-rose-500/10 text-rose-400 font-bold">Deleted</span>
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
                  {t.neodoveUserName ? `NeoDove: ${t.neodoveUserName}` : "NeoDove: not linked"}
                  <br />
                  Total assigned: {t.totalAssigned}
                </div>
                <button
                  onClick={() => onRestore(t.id)}
                  disabled={busy}
                  className="mt-3 w-full text-xs rounded-lg bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 py-2 font-semibold hover:bg-emerald-500/20 disabled:opacity-40"
                  title="Restore as inactive — reactivate when ready"
                >
                  ♻ Restore (inactive)
                </button>
              </div>
            ))}
            {deletedRows.length === 0 && <p className="text-xs text-zinc-500 py-2">No deleted agents.</p>}
          </div>
        )}
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
