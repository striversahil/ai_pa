"use client";

import React, { useCallback, useEffect, useState } from "react";

type TrafficLight = "green" | "amber" | "red";

type Kra = {
  connectedTarget: number;
  connected: number;
  connectedPct: number;
  connectedStatus: TrafficLight;
  leadsTarget: number;
  leads: number;
  leadsPct: number;
  leadsStatus: TrafficLight;
  overall: TrafficLight;
  overallLabel: string;
  zohoEstimates: number;
  zohoPipelineValue: number;
};

type AgentRow = {
  userName: string;
  userId: string;
  managerName: string | null;
  callsAttempted: number;
  callsConnected: number;
  callsNotConnected: number;
  incomingCalls: number;
  outgoingCalls: number;
  incomingMissed: number;
  outgoingMissed: number;
  talkTimeSec: number;
  leadsConverted: number;
  leadsInProgress: number;
  leadsLost: number;
  leadsClosed: number;
  followupLeads: number;
  pendingScheduledLeads: number;
  kra?: Kra;
};

type Totals = Record<string, number>;

type DataResponse = {
  meta: {
    analysis: string;
    reportDate: string | null;
    fetchedAt?: string;
    generatedAt: string;
    agentCount?: number;
    error?: string;
  };
  benchmarks?: { connectedCallsPerDay: number; leadsPerAgentPerDay: number };
  agents: AgentRow[];
  totals: Totals | null;
  zohoUnmapped?: { zohoName: string; estimates: number; value: number }[];
};

const REFRESH_MS = 5 * 60 * 1000;

const LIGHT_TEXT: Record<TrafficLight, string> = {
  green: "text-emerald-400",
  amber: "text-amber-400",
  red: "text-rose-400",
};
const LIGHT_BG: Record<TrafficLight, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
};
const LIGHT_CHIP: Record<TrafficLight, string> = {
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  red: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

function fmtTalkTime(sec: number): string {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtNum(n: number | undefined): string {
  return n === undefined || n === null ? "—" : String(n);
}

function KraBar({ label, value, target, pct, status }: { label: string; value: number; target: number; pct: number; status: TrafficLight }) {
  const width = Math.min(100, pct);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-zinc-400 font-semibold">{label}</span>
        <span className={`font-bold font-mono ${LIGHT_TEXT[status]}`}>
          {value}/{target} · {pct}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${LIGHT_BG[status]}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export default function NeodoveTelecallerDashboard() {
  const [data, setData] = useState<DataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch("/api/automations/neodove-telecaller-report/data", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DataResponse = await res.json();
      setData(json);
      setError(json.meta.error ?? null);
      setLastLoaded(new Date());
    } catch (e: any) {
      setError(e.message ?? "failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const agents = data?.agents ?? [];
  const totals = data?.totals;
  const reportDate = data?.meta.reportDate;
  const benchmarks = data?.benchmarks ?? { connectedCallsPerDay: 120, leadsPerAgentPerDay: 5 };
  const zohoUnmapped = data?.zohoUnmapped ?? [];
  const withKra = agents.filter((a) => a.kra);

  return (
    <div className="space-y-4 text-zinc-100">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">📞 Telecaller Performance — Individual KRA/KPI</h2>
            <p className="text-xs text-zinc-400 mt-1">
              {reportDate ? (
                <>
                  <span className="text-indigo-300 font-semibold">{reportDate}</span> · live vs daily benchmarks · auto-refreshes every 5 min
                  {data?.meta.fetchedAt && <> · NeoDove fetched {new Date(data.meta.fetchedAt).toLocaleTimeString()}</>}
                </>
              ) : (
                "Waiting for first report…"
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastLoaded && (
              <span className="text-[11px] text-zinc-500">updated {lastLoaded.toLocaleTimeString()}</span>
            )}
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-all duration-200 cursor-pointer border-0 disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "↻ Refresh now"}
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          Benchmarks per agent/day: <span className="text-zinc-300 font-semibold">≥ {benchmarks.connectedCallsPerDay} connected calls</span> ·{" "}
          <span className="text-zinc-300 font-semibold">≥ {benchmarks.leadsPerAgentPerDay} leads</span> (in-progress + converted). Traffic light: 🟢 ≥100% · 🟡 60–99% · 🔴 &lt;60%
        </p>
        {error && (
          <p className="mt-3 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">{error}</p>
        )}
      </div>

      {/* Individual Agent KRA/KPI cards */}
      {!loading && withKra.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-indigo-300">🎯 Individual Agent KRA — Today vs Benchmark</h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {withKra.map((a) => {
              const k = a.kra!;
              return (
                <div key={a.userId || a.userName} className={`rounded-xl border p-4 space-y-3 bg-zinc-900 ${
                  k.overall === "green" ? "border-emerald-500/30" : k.overall === "amber" ? "border-amber-500/30" : "border-rose-500/30"
                }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-bold text-white truncate block">{a.userName}</span>
                      <span className="text-[10px] text-zinc-500">{a.managerName ?? "—"}</span>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-extrabold uppercase tracking-wide ${LIGHT_CHIP[k.overall]}`}>
                      {k.overallLabel}
                    </span>
                  </div>
                  <KraBar label="Connected Calls" value={k.connected} target={k.connectedTarget} pct={k.connectedPct} status={k.connectedStatus} />
                  <KraBar label="Leads Generated" value={k.leads} target={k.leadsTarget} pct={k.leadsPct} status={k.leadsStatus} />
                  <div className="flex items-center justify-between pt-1 border-t border-zinc-800/80 text-[10px] text-zinc-500">
                    <span>Zoho pipeline</span>
                    {k.zohoEstimates > 0 ? (
                      <span className="font-semibold text-indigo-300">
                        {k.zohoEstimates} sent est. · ₹{k.zohoPipelineValue.toLocaleString()}
                      </span>
                    ) : (
                      <span className="italic">not mapped</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {zohoUnmapped.length > 0 && (
            <p className="text-[10px] text-zinc-600">
              Zoho commenters not mapped to any agent: {zohoUnmapped.map((z) => `${z.zohoName} (${z.estimates})`).join(", ")}. Set the D1 setting
              {" "}
              <code className="text-zinc-500">kra:zoho_name_map</code> to map them.
            </p>
          )}
        </div>
      )}

      {/* Team KPI strip */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
          {[
            { label: "Calls Attempted", value: fmtNum(totals.callsAttempted), accent: "text-white" },
            { label: "Connected", value: fmtNum(totals.callsConnected), accent: "text-emerald-400" },
            { label: "Missed (in+out)", value: fmtNum((totals.incomingMissed ?? 0) + (totals.outgoingMissed ?? 0)), accent: "text-rose-400" },
            { label: "Team Talk Time", value: fmtTalkTime(totals.talkTimeSec), accent: "text-indigo-300" },
            { label: "Converted", value: fmtNum(totals.leadsConverted), accent: "text-emerald-300" },
            { label: "Follow-ups Due", value: fmtNum(totals.followupLeads), accent: "text-amber-300" },
          ].map((k) => (
            <div key={k.label} className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">{k.label}</div>
              <div className={`text-2xl font-extrabold mt-1 ${k.accent}`}>{k.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Agent table */}
      <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-zinc-400 animate-pulse">Loading telecaller data…</div>
        ) : agents.length === 0 ? (
          <div className="py-16 text-center text-zinc-400">No agent activity stored for this day yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Manager</th>
                  <th className="px-4 py-3 text-right">Attempted</th>
                  <th className="px-4 py-3 text-right">Connected</th>
                  <th className="px-4 py-3 text-right">Conn. % of 120</th>
                  <th className="px-4 py-3 text-right">Leads (IP+Cv)</th>
                  <th className="px-4 py-3 text-right">Not Conn.</th>
                  <th className="px-4 py-3 text-right">Incoming</th>
                  <th className="px-4 py-3 text-right">Outgoing</th>
                  <th className="px-4 py-3 text-right">Missed</th>
                  <th className="px-4 py-3 text-right">Talk Time</th>
                  <th className="px-4 py-3 text-right">Converted</th>
                  <th className="px-4 py-3 text-right">In Prog.</th>
                  <th className="px-4 py-3 text-right">Lost</th>
                  <th className="px-4 py-3 text-right">Follow-ups</th>
                  <th className="px-4 py-3 text-right">Pending Sched.</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a, i) => (
                  <tr key={a.userId || a.userName} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-2.5 text-zinc-600">{i + 1}</td>
                    <td className="px-4 py-2.5 font-semibold text-white whitespace-nowrap">{a.userName}</td>
                    <td className="px-4 py-2.5 text-zinc-400 whitespace-nowrap">{a.managerName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-white">{a.callsAttempted}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-400">{a.callsConnected}</td>
                    <td className={`px-4 py-2.5 text-right font-mono font-bold ${a.kra ? LIGHT_TEXT[a.kra.connectedStatus] : "text-zinc-400"}`}>
                      {a.kra ? `${a.kra.connectedPct}%` : "—"}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono font-bold ${a.kra ? LIGHT_TEXT[a.kra.leadsStatus] : "text-zinc-400"}`}>
                      {a.kra ? `${a.kra.leads}/${a.kra.leadsTarget}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-400">{a.callsNotConnected}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300">{a.incomingCalls}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300">{a.outgoingCalls}</td>
                    <td className="px-4 py-2.5 text-right text-rose-400">{a.incomingMissed + a.outgoingMissed}</td>
                    <td className="px-4 py-2.5 text-right text-indigo-300 font-medium">{fmtTalkTime(a.talkTimeSec)}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-300 font-semibold">{a.leadsConverted}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300">{a.leadsInProgress}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-500">{a.leadsLost}</td>
                    <td className="px-4 py-2.5 text-right text-amber-300">{a.followupLeads}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300">{a.pendingScheduledLeads}</td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="bg-zinc-800/40 text-[13px] font-bold border-t border-zinc-700">
                    <td colSpan={3} className="px-4 py-3 text-zinc-300 uppercase tracking-wide text-[10px]">Team Total</td>
                    <td className="px-4 py-3 text-right text-white">{fmtNum(totals.callsAttempted)}</td>
                    <td className="px-4 py-3 text-right text-emerald-400">{fmtNum(totals.callsConnected)}</td>
                    <td className="px-4 py-3 text-right text-zinc-400">—</td>
                    <td className="px-4 py-3 text-right text-zinc-400">—</td>
                    <td className="px-4 py-3 text-right text-zinc-400">{fmtNum(totals.callsNotConnected)}</td>
                    <td className="px-4 py-3 text-right text-zinc-300">{fmtNum(totals.incomingCalls)}</td>
                    <td className="px-4 py-3 text-right text-zinc-300">{fmtNum(totals.outgoingCalls)}</td>
                    <td className="px-4 py-3 text-right text-rose-400">{(totals.incomingMissed ?? 0) + (totals.outgoingMissed ?? 0)}</td>
                    <td className="px-4 py-3 text-right text-indigo-300">{fmtTalkTime(totals.talkTimeSec)}</td>
                    <td className="px-4 py-3 text-right text-emerald-300">{fmtNum(totals.leadsConverted)}</td>
                    <td className="px-4 py-3 text-right text-zinc-300">{fmtNum(totals.leadsInProgress)}</td>
                    <td className="px-4 py-3 text-right text-zinc-500">{fmtNum(totals.leadsLost)}</td>
                    <td className="px-4 py-3 text-right text-amber-300">{fmtNum(totals.followupLeads)}</td>
                    <td className="px-4 py-3 text-right text-zinc-300">{fmtNum(totals.pendingScheduledLeads)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}