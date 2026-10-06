"use client";

import React, { useState, useEffect, useCallback } from "react";

type UsageUser = { id: string; turns: number; lastAt: string | null };
type UsageDay = { day: string; turns: number };
type KeyHealth = {
  id: string; label: string; provider: string; enabled: boolean;
  failures: number; cooldownUntil: number; lastError: string | null;
  lastUsedAt: number; successCount: number;
};
type GatewayUsage = { total: number; calls: number; byDay: Array<{ day: string; total: number; calls: number }> };
type AiHealth = {
  keys: KeyHealth[]; count: number; storm: boolean;
  usageDays: number;
  usage: { total: number; users: UsageUser[]; byDay: UsageDay[]; gateway: GatewayUsage };
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-zinc-500">{sub}</p>}
    </div>
  );
}

export default function AiUsageDashboard() {
  const [data, setData] = useState<AiHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  const fetchData = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    setDenied(false);
    try {
      const res = await fetch(`/api/debug/ai-health?days=${d}`);
      if (res.status === 401 || res.status === 403) { setDenied(true); setData(null); return; }
      if (!res.ok) { setError(`Dashboard not available (HTTP ${res.status}).`); setData(null); return; }
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
      try {
        const res = await fetch(`/api/debug/ai-health?days=${days}`);
        if (!res.ok) {
          if (!cancelled) {
            if (res.status === 401 || res.status === 403) setDenied(true);
            else setError(`Dashboard not available (HTTP ${res.status}).`);
            setData(null);
          }
          return;
        }
        if (!cancelled) { setData(await res.json()); setDenied(false); setError(null); }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [days]);

  if (denied) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <div className="text-5xl">🔒</div>
        <h2 className="text-xl font-bold">Access pending</h2>
        <p className="max-w-md text-sm text-zinc-500">AI usage is visible to MIS members only. Ask the administrator to grant access.</p>
      </div>
    );
  }

  const usage = data?.usage;
  const maxDay = Math.max(1, ...(usage?.byDay.map((d) => d.turns) ?? [1]));
  const paid = data?.keys.find((k) => k.provider === "openrouter-paid");
  const now = Date.now();
  const cooling = data?.keys.filter((k) => k.cooldownUntil > now).length ?? 0;

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100 pb-12">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold font-heading tracking-tight flex items-center gap-2">
            <span>🤖</span> AI Usage
          </h1>
          <p className="mt-1 text-[13px] text-zinc-500">
            Copilot turns per member (20/hr cap, LLM tool steps excluded) · pool {data?.storm ? "throttled" : "healthy"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-[12px] font-bold rounded-full border cursor-pointer ${days === d ? "bg-violet-600 text-white border-violet-600" : "border-zinc-300 dark:border-zinc-700 text-zinc-500"}`}
            >
              {d}d
            </button>
          ))}
          <button
            type="button"
            onClick={() => void fetchData(days)}
            className="px-3 py-1.5 text-[12px] font-bold rounded-full border border-zinc-300 dark:border-zinc-700 text-zinc-500 cursor-pointer"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {loading && !data && <p className="text-sm text-zinc-500">Loading…</p>}
      {error && <p className="text-sm text-rose-500">{error}</p>}

      {data && usage && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label={`Turns · last ${data.usageDays}d`} value={String(usage.total)} sub={`${(usage.total / Math.max(1, data.usageDays)).toFixed(1)}/day avg`} />
            <Stat label="Active members" value={String(usage.users.length)} sub={usage.users[0] ? `top: ${usage.users[0].id}` : "no usage yet"} />
            <Stat label="Paid lane" value={paid ? (paid.enabled ? "Live" : "Disabled") : "Missing"} sub={paid ? `deepseek · ${paid.successCount} served` : "OPENROUTER_PAID_API_KEY unset"} />
            <Stat label="Pool state" value={data.storm ? "Throttled" : cooling > 0 ? `${cooling} cooling` : "Healthy"} sub={`${data.count} keys loaded`} />
          </div>

          {usage.gateway && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label={`Gateway tokens · ${data.usageDays}d`} value={usage.gateway.total > 0 ? usage.gateway.total.toLocaleString() : "0"} sub="all LLM calls" />
              <Stat label="Gateway calls" value={String(usage.gateway.calls)} sub="runners + extraction + chat" />
              <Stat label="Avg tokens/call" value={usage.gateway.calls > 0 ? Math.round(usage.gateway.total / usage.gateway.calls).toLocaleString() : "—"} sub="prompt + completion" />
              <Stat label="Gateway days" value={String(usage.gateway.byDay.length)} sub="with recorded usage" />
            </div>
          )}

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-3">Turns per day</p>
            {usage.byDay.length === 0 && <p className="text-[13px] text-zinc-500">No turns in this window yet.</p>}
            <div className="flex items-end gap-1.5 h-28">
              {usage.byDay.map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${d.day}: ${d.turns}`}>
                  <span className="text-[10px] font-bold text-zinc-500">{d.turns}</span>
                  <div className="w-full rounded-t bg-violet-600/80" style={{ height: `${Math.max(4, Math.round((d.turns / maxDay) * 80))}px` }} />
                  <span className="text-[9px] text-zinc-500 truncate">{d.day.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Turns per member</p>
            {usage.users.length === 0 && <p className="text-[13px] text-zinc-500">Nobody has used the copilots in this window.</p>}
            {usage.users.length > 0 && (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-1.5 pr-2">Member</th>
                    <th className="py-1.5 pr-2 text-right">Turns</th>
                    <th className="py-1.5 pr-2 text-right">Share</th>
                    <th className="py-1.5 text-right">Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.users.map((u) => (
                    <tr key={u.id} className="border-b border-zinc-100 dark:border-zinc-900 last:border-0">
                      <td className="py-1.5 pr-2 font-medium break-all">{u.id}</td>
                      <td className="py-1.5 pr-2 text-right font-extrabold">{u.turns}</td>
                      <td className="py-1.5 pr-2 text-right text-zinc-500">{usage.total > 0 ? `${((u.turns / usage.total) * 100).toFixed(0)}%` : "—"}</td>
                      <td className="py-1.5 text-right text-zinc-500">{u.lastAt ? new Date(u.lastAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Key pool health</p>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-1.5 pr-2">Provider</th>
                  <th className="py-1.5 pr-2">Label</th>
                  <th className="py-1.5 pr-2 text-right">Served</th>
                  <th className="py-1.5 pr-2 text-right">Failures</th>
                  <th className="py-1.5 text-right">State</th>
                </tr>
              </thead>
              <tbody>
                {data.keys.map((k) => {
                  const state = !k.enabled ? "disabled" : k.cooldownUntil > now ? "cooling" : "ready";
                  return (
                    <tr key={k.id} className="border-b border-zinc-100 dark:border-zinc-900 last:border-0">
                      <td className="py-1.5 pr-2 font-medium">{k.provider}</td>
                      <td className="py-1.5 pr-2 text-zinc-500">{k.label}</td>
                      <td className="py-1.5 pr-2 text-right">{k.successCount}</td>
                      <td className="py-1.5 pr-2 text-right">{k.failures}</td>
                      <td className="py-1.5 text-right">
                        <span className={`inline-block px-2 py-0.5 text-[11px] font-bold rounded-full ${state === "ready" ? "bg-emerald-500/15 text-emerald-500" : state === "cooling" ? "bg-amber-500/15 text-amber-500" : "bg-rose-500/15 text-rose-500"}`}>
                          {state}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
