"use client";

import React from "react";
import { useOverviewData } from "@/hooks/useOverviewData";
import { sectionLink } from "@/overview/normalize";

/** Shared concise one-page summary grid. Both overview pages render this. */
export default function OverviewDashboard({ slug }: { slug: "samarth-overview" | "sahil-overview" }) {
  const overview = useOverviewData(slug);
  const data = overview.data;

  if (overview.loading && !data) {
    return <div className="flex items-center justify-center py-20 text-zinc-500"><span className="animate-pulse">Loading overview…</span></div>;
  }
  if (overview.error && !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-300">
        Overview failed to load: {String((overview.error as any)?.message ?? overview.error)}
        <button onClick={overview.refresh} className="ml-3 px-3 py-1 text-xs font-bold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white border-0 cursor-pointer">Retry</button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold font-heading tracking-tight">{data.meta.title}</h1>
          <p className="text-xs text-zinc-500 mt-1">
            {data.meta.sectionsOk}/{data.meta.sectionsTotal} sections live
            {data.meta.generatedAt ? ` · updated ${new Date(data.meta.generatedAt).toLocaleString("en-IN")}` : ""}
          </p>
        </div>
        <button onClick={overview.refresh} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 border-0 cursor-pointer">↻ Refresh</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {data.sections.map((s) => (
          <div key={s.slug} className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-bold truncate">{s.title}</h3>
                <p className="text-xs text-zinc-500 mt-1">{s.ok ? s.headline : `Unavailable${s.error ? ` — ${s.error}` : ""}`}</p>
              </div>
              <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border shrink-0 ${s.ok ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border-zinc-300 dark:border-zinc-700"}`}>
                {s.ok ? "Live" : "Down"}
              </span>
            </div>
            {s.ok && s.kpis.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                {s.kpis.map((k) => (
                  <div key={k.label} className="rounded-lg bg-zinc-100 dark:bg-zinc-800/60 px-2.5 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">{k.label}</div>
                    <div className="text-sm font-bold truncate" title={k.hint ?? k.value}>{k.value}</div>
                  </div>
                ))}
              </div>
            )}
            {s.ok && s.attention.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-amber-600 dark:text-amber-300/90">
                {s.attention.map((a, i) => <li key={i}>⚠ {a}</li>)}
              </ul>
            )}
            <a href={sectionLink(s.slug)} className="inline-block mt-3 text-xs font-bold text-indigo-400 hover:text-indigo-300">Open {s.title} →</a>
          </div>
        ))}
      </div>
    </div>
  );
}
