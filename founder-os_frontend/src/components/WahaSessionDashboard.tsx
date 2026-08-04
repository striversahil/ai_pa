"use client";

import React, { useState, useEffect, useCallback } from "react";

type Kpi = {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "indigo" | "emerald" | "rose" | "amber" | "violet";
};

type Table = {
  title: string;
  columns: string[];
  rows: (string | number)[][];
};

type WahaData = {
  meta: {
    analysis: string;
    title: string;
    sessionName: string;
    windowDays: number;
    generatedAt: string;
    liveCheckedAt: string;
    cacheAgeSec?: number;
  };
  live: {
    status: string;
    reachable: boolean;
    error: string | null;
  };
  diagnostics: {
    sessionName: string;
    accountId: string | null;
    lid: string | null;
    pushName: string | null;
    engine: string | null;
    webVersion: string | null;
    connectionState: string | null;
    config: Record<string, unknown>;
  };
  health: {
    status: string;
    waha?: {
      status: string;
      reachable: boolean;
      checkedAt: string | null;
    };
    metrics: {
      unprocessedMessages: number;
      slaBreaches: number;
      pendingItems: number;
      lastWebhookAt: string | null;
      lagMs: number | null;
      queueDepth: number;
      ai: { totalCalls: number; failedCalls: number; failureRate: string };
    };
  } | null;
  uptimeByDay: { date: string; uptime: number; downtimeMin: number }[];
  kpis: Kpi[];
  tables: Table[];
};

const ACCENT_CLASS: Record<string, { text: string; glow: string }> = {
  indigo: { text: "text-indigo-400", glow: "bg-indigo-500/10" },
  emerald: { text: "text-emerald-400", glow: "bg-emerald-500/10" },
  rose: { text: "text-rose-400", glow: "bg-rose-500/10" },
  amber: { text: "text-amber-400", glow: "bg-amber-500/10" },
  violet: { text: "text-violet-400", glow: "bg-violet-500/10" },
};

export default function WahaSessionDashboard() {
  const [data, setData] = useState<WahaData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState<number>(7);

  const fetchData = useCallback(async (days: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/automations/waha-session-monitor/data?windowDays=${days}`);
      if (!res.ok) {
        setError(`Dashboard not available (HTTP ${res.status}).`);
        setData(null);
        return;
      }
      setData(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/automations/waha-session-monitor/data?windowDays=${windowDays}`);
        if (!res.ok) {
          if (!cancelled) {
            setError(`Dashboard not available (HTTP ${res.status}).`);
            setData(null);
          }
          return;
        }
        if (!cancelled) setData(await res.json());
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [windowDays]);

  const liveOk = data?.live?.reachable && data?.live?.status === "WORKING";

  return (
    <div className="space-y-6 text-zinc-100 pb-12">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-zinc-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold font-heading tracking-tight flex items-center gap-2">
            <span>📶</span> {data?.meta?.title ?? "WAHA Session Monitor"}
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            session <code className="text-zinc-300 font-mono">{data?.meta?.sessionName ?? "—"}</code>
            {data?.meta?.generatedAt && ` · updated ${new Date(data.meta.generatedAt).toLocaleTimeString()}`}
            {typeof data?.meta?.cacheAgeSec === "number" && (
              <span className="text-zinc-500"> · WAHA snapshot {data.meta.cacheAgeSec}s old (cron refreshes every 5m)</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg p-1.5 text-xs">
            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider pl-1">Window:</span>
            <select
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
              className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-md px-2 py-1 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value={1}>Last 24h</option>
              <option value={7}>Last 7 Days</option>
              <option value={14}>Last 14 Days</option>
              <option value={30}>Last 30 Days</option>
            </select>
          </div>
          <button
            onClick={() => fetchData(windowDays)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition-all duration-200 cursor-pointer border-0"
          >
            <span>🔄</span> Refresh
          </button>
        </div>
      </div>

      {/* Live status banner */}
      {!loading && !error && data && (
        <div className={`flex flex-wrap items-center gap-3 rounded-xl border p-4 text-sm ${liveOk ? "bg-emerald-950/10 border-emerald-500/20 text-emerald-300" : "bg-rose-950/10 border-rose-500/30 text-rose-300"}`}>
          <span className={`w-2.5 h-2.5 rounded-full ${liveOk ? "bg-emerald-400" : "bg-rose-400"} animate-pulse`}></span>
          <span className="font-bold uppercase tracking-wide text-xs">
            {liveOk ? "Session healthy — WORKING" : `Session ${data.live.status}`}
          </span>
          <span className="text-xs opacity-80">
            {liveOk
              ? "WhatsApp session is connected and responding."
              : data.live.error
                ? `WAHA API error: ${data.live.error}`
                : "WhatsApp session is not in WORKING state."}
          </span>
          {data.live.error && <span className="text-xs font-mono opacity-70">{data.live.error}</span>}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-5 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20 text-zinc-400">
          <span className="animate-pulse">Loading session health...</span>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Account / Engine diagnostics */}
          {data.diagnostics && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold text-base">Connected Account & Engine</h3>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${liveOk ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"}`}>
                  {data.diagnostics.connectionState ?? data.live.status}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="col-span-2 md:col-span-3 flex items-center gap-4">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-lg font-bold text-white">
                    {(data.diagnostics.pushName ?? "?").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-white font-semibold text-sm">{data.diagnostics.pushName ?? "—"}</div>
                    <div className="text-zinc-400 text-xs font-mono">{data.diagnostics.accountId ?? "—"}</div>
                  </div>
                </div>
                <DiagField label="Engine" value={data.diagnostics.engine} />
                <DiagField label="WAHA Web Version" value={data.diagnostics.webVersion} />
                <DiagField label="LinkedID" value={data.diagnostics.lid} />
              </div>
            </div>
          )}

          {/* Uptime by day */}
          {data.uptimeByDay && data.uptimeByDay.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md">
              <h3 className="text-white font-bold text-base mb-4">Uptime by Day</h3>
              <div className="space-y-2">
                {data.uptimeByDay.map((d) => (
                  <div key={d.date} className="flex items-center gap-3">
                    <span className="w-14 text-zinc-400 text-[10px] font-mono whitespace-nowrap">{d.date}</span>
                    <div className="flex-1 h-4 bg-zinc-950 border border-zinc-800 rounded overflow-hidden">
                      <div
                        className={`h-full ${d.uptime >= 99 ? "bg-emerald-500" : d.uptime >= 90 ? "bg-amber-500" : "bg-rose-500"}`}
                        style={{ width: `${d.uptime}%` }}
                      />
                    </div>
                    <span className="w-14 text-right text-zinc-300 text-[10px] font-mono">{d.uptime}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Platform health */}
          {data.health && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold text-base">Platform Health</h3>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${data.health.status === "healthy" ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"}`}>
                  {data.health.status}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <MetricTile label="Unprocessed Messages" value={data.health.metrics.unprocessedMessages} />
                <MetricTile label="SLA Breaches" value={data.health.metrics.slaBreaches} />
                <MetricTile label="Pending Items" value={data.health.metrics.pendingItems} />
                <MetricTile
                  label="Webhook Lag"
                  value={
                    data.health.metrics.lagMs != null
                      ? data.health.metrics.lagMs < 60_000
                        ? `${Math.round(data.health.metrics.lagMs / 1000)}s`
                        : `${Math.round(data.health.metrics.lagMs / 60_000)}m`
                      : "—"
                  }
                />
                <MetricTile label="Queue Depth" value={data.health.metrics.queueDepth} />
                <MetricTile label="AI Failure Rate" value={data.health.metrics.ai.failureRate} />
              </div>
            </div>
          )}

          {/* KPI cards */}
          {data.kpis && data.kpis.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {data.kpis.map((kpi) => {
                const accent = ACCENT_CLASS[kpi.accent ?? "indigo"] ?? ACCENT_CLASS.indigo;
                return (
                  <div key={kpi.label} className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 flex flex-col justify-between shadow-md relative overflow-hidden">
                    <div className={`absolute top-0 right-0 p-2 text-5xl font-bold font-mono ${accent.glow}`}>•</div>
                    <span className="text-zinc-400 text-[10px] font-semibold uppercase tracking-wider">{kpi.label}</span>
                    <span className={`text-2xl font-extrabold mt-1 z-10 font-mono ${accent.text}`}>{kpi.value}</span>
                    {kpi.sub && <span className="text-[9px] text-zinc-500 mt-0.5 font-medium">{kpi.sub}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Tables */}
          {data.tables && data.tables.map((table) => (
            <div key={table.title} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md">
              <h3 className="text-white font-bold text-base mb-4">{table.title}</h3>
              <div className="overflow-x-auto border border-zinc-800 rounded-lg">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-zinc-950 border-b border-zinc-800 text-zinc-400 font-bold">
                      {table.columns.map((col) => (
                        <th key={col} className="p-3.5 whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.length === 0 ? (
                      <tr>
                        <td colSpan={table.columns.length} className="p-8 text-center text-zinc-500">
                          No records found in this window.
                        </td>
                      </tr>
                    ) : (
                      table.rows.slice(0, 100).map((row, idx) => (
                        <tr key={idx} className="border-b border-zinc-800/60 hover:bg-zinc-800/20 text-zinc-300">
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className={`p-3.5 whitespace-nowrap ${cIdx === 0 ? "font-mono font-bold text-zinc-400 text-center" : ""}`}>
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function DiagField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="bg-zinc-950 border border-zinc-800/60 rounded-lg px-3.5 py-2.5">
      <div className="text-zinc-500 text-[9px] font-bold uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-zinc-200 text-xs font-mono truncate">{value ?? "—"}</div>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-zinc-950 border border-zinc-800/60 rounded-lg px-3.5 py-3">
      <div className="text-zinc-500 text-[9px] font-bold uppercase tracking-wider mb-1">{label}</div>
      <div className="text-zinc-100 text-xl font-extrabold font-mono">{value}</div>
    </div>
  );
}
