"use client";

import React, { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useLiveQuery } from "@/hooks/useLiveData";

// Lazy-load each dashboard so only the opened one is fetched & parsed.
const ZohoEstimates = dynamic(() => import("./ZohoEstimates"), { ssr: false });
const DppPricesDashboard = dynamic(() => import("./DppPricesDashboard"), { ssr: false });
const SheetAnalysisDashboard = dynamic(() => import("./SheetAnalysisDashboard"), { ssr: false });
const WaEngineDashboard = dynamic(() => import("./WaEngineDashboard"), { ssr: false });
const WhatsAppMarketingDashboard = dynamic(() => import("./WhatsAppMarketingDashboard"), { ssr: false });
const EnterpriseOperationsDashboard = dynamic(() => import("./EnterpriseOperationsDashboard"), { ssr: false });
const NeodoveTelecallerDashboard = dynamic(() => import("./NeodoveTelecallerDashboard"), { ssr: false });
const TelecallingDashboard = dynamic(() => import("./TelecallingDashboard"), { ssr: false });
const AutopilotDashboard = dynamic(() => import("./AutopilotDashboard"), { ssr: false });

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

interface AutomationsProps {
  slug: string | null;
  onNavigate: (path: string) => void;
}

export default function Automations({ slug, onNavigate }: AutomationsProps) {
  const automations = useLiveQuery<Automation[]>(
    async () => {
      const res = await fetch("/api/automations");
      if (!res.ok) throw new Error("load failed");
      return res.json();
    },
    { events: ["automation", "automations"] },
  );
  const [toggling, setToggling] = useState<string | null>(null);
  const [pinned, setPinned] = useLocalStorage<string[]>("pinned_automations", []);

  const selected = slug;

  const togglePin = (s: string) => {
    setPinned(pinned.includes(s) ? pinned.filter(x => x !== s) : [...pinned, s]);
  };

  const [dragSlug, setDragSlug] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const handleDropOn = (targetSlug: string) => {
    if (dragSlug && dragSlug !== targetSlug) {
      const next = [...pinned];
      const from = next.indexOf(dragSlug);
      const to = next.indexOf(targetSlug);
      if (from !== -1 && to !== -1) {
        next.splice(from, 1);
        next.splice(to, 0, dragSlug);
        setPinned(next);
      }
    }
    setDragSlug(null);
    setDropTarget(null);
  };

  const toggleEnabled = async (a: Automation) => {
    setToggling(a.slug);
    try {
      await fetch(`/api/automations/${a.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !a.enabled }),
      });
      automations.refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setToggling(null);
    }
  };

  const { pinnedList, restList } = useMemo(() => {
    const bySlug = new Map((automations.data ?? []).map(a => [a.slug, a]));
    return {
      pinnedList: pinned.map(slug => bySlug.get(slug)).filter(Boolean) as Automation[],
      restList: (automations.data ?? []).filter(a => !pinned.includes(a.slug)),
    };
  }, [(automations.data ?? []), pinned]);

  const renderDashboard = () => {
    if (selected === "enterprise-operations-analytics") return <EnterpriseOperationsDashboard />;
    if (selected === "zoho-sent-analyzer") return <ZohoEstimates />;
    if (selected === "dpp-prices-dashboard") return <DppPricesDashboard />;
    if (selected === "wa-engine-monitor") return <WaEngineDashboard />;
    if (selected === "whatsapp-marketing") return <WhatsAppMarketingDashboard />;
    if (selected === "neodove-telecaller-report") return <NeodoveTelecallerDashboard />;
    if (selected === "telecalling") return <TelecallingDashboard />;
    if (selected === "whatsapp-autopilot") return <AutopilotDashboard />;
    // Generic sheet-analysis renderer: any automation whose `data()` returns
    // { meta: { analysis: 'sheet', ... } } gets a dashboard automatically.
    return <SheetAnalysisDashboard slug={selected ?? ""} />;
  };

  const renderCard = (a: Automation, opts: { draggable?: boolean } = {}) => {
    const isDraggable = !!opts.draggable;
    const isDragging = dragSlug === a.slug;
    const isDropTarget = dropTarget === a.slug && dragSlug && dragSlug !== a.slug;
    return (
      <div
        key={a.slug}
        draggable={isDraggable}
        onDragStart={isDraggable ? (e) => { setDragSlug(a.slug); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", a.slug); } : undefined}
        onDragOver={isDraggable ? (e) => { e.preventDefault(); if (dropTarget !== a.slug) setDropTarget(a.slug); } : undefined}
        onDragLeave={isDraggable ? () => { if (dropTarget === a.slug) setDropTarget(null); } : undefined}
        onDrop={isDraggable ? (e) => { e.preventDefault(); handleDropOn(a.slug); } : undefined}
        onDragEnd={isDraggable ? () => { setDragSlug(null); setDropTarget(null); } : undefined}
        className={`bg-zinc-50 dark:bg-zinc-900 border rounded-xl p-5 transition-all duration-200 ${isDraggable ? "cursor-grab active:cursor-grabbing" : ""
          } ${isDropTarget ? "border-indigo-500 ring-1 ring-indigo-500/50" : "border-zinc-200/80 dark:border-zinc-800/80 hover:border-indigo-500/40"} ${isDragging ? "opacity-50" : ""}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-bold text-zinc-900 dark:text-white truncate">{a.name}</h3>
            <code className="text-[11px] text-indigo-400 font-mono">{a.slug}</code>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isDraggable && (
              <span className="text-zinc-500 dark:text-zinc-600 select-none text-lg leading-none" title="Drag to reorder">⠿</span>
            )}
            <button
              onClick={() => togglePin(a.slug)}
              title={pinned.includes(a.slug) ? "Unpin" : "Pin for quick access"}
              className={`px-2 py-0.5 text-xs rounded-full border transition-all duration-200 cursor-pointer ${pinned.includes(a.slug)
                  ? "bg-indigo-500/10 text-indigo-300 border-indigo-500/30"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-500 border-zinc-300 dark:border-zinc-700 hover:text-zinc-700 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600"
                }`}
            >
              {pinned.includes(a.slug) ? "📌 Pinned" : "📌 Pin"}
            </button>
            <span
              className={`px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border ${a.enabled
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-500 border-zinc-300 dark:border-zinc-700"
                }`}
            >
              {a.enabled ? "Active" : "Paused"}
            </span>
          </div>
        </div>

        {a.description && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 line-clamp-2">{a.description}</p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-500 mt-3">
          <span>{describeTrigger(a.trigger)}</span>
          <span>runs: {a.runCount}</span>
          {a.lastRunAt && <span>last: {new Date(a.lastRunAt).toLocaleString()}</span>}
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <button
            onClick={() => toggleEnabled(a)}
            disabled={toggling === a.slug}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all duration-200 cursor-pointer border-0 disabled:opacity-50 ${a.enabled
                ? "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                : "bg-emerald-600 hover:bg-emerald-500 text-white"
              }`}
          >
            {a.enabled ? "Pause" : "Enable"}
          </button>
          {a.hasDashboard && (
            <button
              onClick={() => onNavigate(`#/automations/${a.slug}`)}
              className="text-white px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 transition-all duration-200 cursor-pointer border-0"
            >
              📊 View Dashboard
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100">
      {!selected && (
        <div className="border-b border-zinc-200 dark:border-zinc-800 pb-5">
          <h1 className="text-3xl font-bold font-heading tracking-tight">
            <span className="bg-gradient-to-r from-white via-indigo-100 to-indigo-400 bg-clip-text text-transparent">Automations</span>
          </h1>
        </div>
      )}

      {selected ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={() => onNavigate("/automations")}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 font-medium text-sm transition-all duration-200 cursor-pointer border-0"
            >
              ← Back to all automations
            </button>
            <button
              onClick={() => togglePin(selected)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer border-0 ${pinned.includes(selected)
                  ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/30"
                  : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white"
                }`}
            >
              {pinned.includes(selected) ? "📌 Pinned" : "📌 Pin this dashboard"}
            </button>
          </div>
          {renderDashboard()}
        </div>
          ) : automations.loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-500 dark:text-zinc-400">
          <span className="animate-pulse">Loading automations...</span>
        </div>
      ) : (
        <>
          {pinnedList.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-indigo-300">
                📌 Pinned <span className="text-zinc-600 dark:text-zinc-500 normal-case font-medium">— drag to reorder</span>
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {pinnedList.map(a => renderCard(a, { draggable: true }))}
              </div>
            </div>
          )}
          <div className="space-y-4">
            {pinnedList.length > 0 && (
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-500">
                All Automations
              </h2>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {restList.map(a => renderCard(a))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
