"use client";

import React, { useState, useEffect } from "react";
import ZohoEstimates from "./ZohoEstimates";
import DppPricesDashboard from "./DppPricesDashboard";

type AutomationTrigger = {
  type?: string;
  cron?: string | string[];
  event?: string;
  fallbackCron?: string;
};

type Automation = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: string;
  enabled: boolean;
  cooldownMs: number;
  lastRunAt: string | null;
  runCount: number;
  hasDashboard: boolean;
  trigger: AutomationTrigger | null;
};

function describeTrigger(t: AutomationTrigger | null | undefined): string {
  if (!t) return "—";
  if (t.type === "schedule") return `⏰ every ${t.cron}`;
  if (t.type === "event_plus_scan") return `⚡ ${t.event} + scan ${t.fallbackCron}`;
  if (t.type === "event") return `⚡ ${t.event}`;
  return t.type ?? "—";
}

export default function Automations() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchList = async () => {
    try {
      const res = await fetch("/api/automations");
      if (res.ok) setAutomations(await res.json());
    } catch (e) {
      console.error("Failed to load automations", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/automations");
        if (res.ok && !cancelled) setAutomations(await res.json());
      } catch (e) {
        console.error("Failed to load automations", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleEnabled = async (a: Automation) => {
    setToggling(a.slug);
    try {
      await fetch(`/api/automations/${a.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !a.enabled }),
      });
      fetchList();
    } catch (e) {
      console.error(e);
    } finally {
      setToggling(null);
    }
  };

  const renderDashboard = () => {
    if (selected === "zoho-sent-analyzer") return <ZohoEstimates />;
    if (selected === "dpp-prices-dashboard") return <DppPricesDashboard />;
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center text-sm text-zinc-500">
        No dashboard wired for <code className="text-zinc-300">{selected}</code> yet.
      </div>
    );
  };

  return (
    <div className="space-y-6 text-zinc-100 pb-12">
      <div className="border-b border-zinc-800 pb-5">
        <h1 className="text-3xl font-bold font-heading tracking-tight">
          <span className="bg-gradient-to-r from-white via-indigo-100 to-indigo-400 bg-clip-text text-transparent">Automations</span>
        </h1>
        <p className="text-sm text-zinc-400 mt-0.5">
          Every scheduled & event-driven job in the system. Each lives in its own folder under{" "}
          <code className="text-zinc-300">src/automations/&lt;slug&gt;/</code>.
        </p>
      </div>

      {selected ? (
        <div className="space-y-4">
          <button
            onClick={() => setSelected(null)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-sm transition-all duration-200 cursor-pointer border-0"
          >
            ← Back to all automations
          </button>
          {renderDashboard()}
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-400">
          <span className="animate-pulse">Loading automations...</span>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {automations.map((a) => (
            <div
              key={a.slug}
              className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-5 hover:border-indigo-500/40 transition-all duration-200"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold text-white truncate">{a.name}</h3>
                  <code className="text-[11px] text-indigo-400 font-mono">{a.slug}</code>
                </div>
                <span
                  className={`shrink-0 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border ${
                    a.enabled
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : "bg-zinc-800 text-zinc-500 border-zinc-700"
                  }`}
                >
                  {a.enabled ? "Active" : "Paused"}
                </span>
              </div>

              {a.description && (
                <p className="text-xs text-zinc-400 mt-2 line-clamp-2">{a.description}</p>
              )}

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500 mt-3">
                <span>{describeTrigger(a.trigger)}</span>
                <span>runs: {a.runCount}</span>
                {a.lastRunAt && <span>last: {new Date(a.lastRunAt).toLocaleString()}</span>}
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                <button
                  onClick={() => toggleEnabled(a)}
                  disabled={toggling === a.slug}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all duration-200 cursor-pointer border-0 disabled:opacity-50 ${
                    a.enabled
                      ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white"
                  }`}
                >
                  {a.enabled ? "Pause" : "Enable"}
                </button>
                {a.hasDashboard && (
                  <button
                    onClick={() => setSelected(a.slug)}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-all duration-200 cursor-pointer border-0"
                  >
                    📊 View Dashboard
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
