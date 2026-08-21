"use client";

import React, { useCallback, useEffect, useState } from "react";

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
  agents: AgentRow[];
  totals: Totals | null;
};

const REFRESH_MS = 5 * 60 * 1000;

function fmtTalkTime(sec: number): string {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtNum(n: number | undefined): string {
  return n === undefined || n === null ? "—" : String(n);
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

  return (
    <div className="space-y-4 text-zinc-100">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">📞 Telecaller Performance — Live</h2>
            <p className="text-xs text-zinc-400 mt-1">
              {reportDate ? (
                <>
                  <span className="text-indigo-300 font-semibold">{reportDate}</span> · auto-refreshes every 5 min · runner overwrites every 10 min
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
        {error && (
          <p className="mt-3 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">{error}</p>
        )}
      </div>

      {/* KPI strip */}
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
