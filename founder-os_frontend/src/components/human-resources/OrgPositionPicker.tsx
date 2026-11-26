"use client";

// OrgPositionPicker — browse the live organization chart and pick a seat.
//
// The old nested scroll tree was hard to scan for a long chart. This picker
// keeps the selected position visible as a summary card, then offers a flat,
// searchable card grid with department chips. Data comes from the HR-editable
// chart (GET /api/org/chart); the repo static chart is only a fallback.
import { useEffect, useMemo, useState } from "react";
import {
  buildChartTree, LOGIN_POSITION_OPTIONS, ORG_POSITIONS, ORG_TOP_POSITION, positionFromChart,
  responsibilityLine, suggestOrgTitle, wingOfDepartment, type LiveChartPosition, type OrgPosition,
} from "@/hr/organization";
import { fetchOrgChart } from "@/org/api";

function staticFallback(): LiveChartPosition[] {
  return [{
    id: "static:" + ORG_TOP_POSITION, title: ORG_TOP_POSITION, department: null, wing: "Operations",
    reportsToId: null, reportsTo: null, isTop: true, isHead: false, loginPosition: null, order: -1,
  }, ...ORG_POSITIONS.map((p) => ({
    id: "static:" + p.title,
    title: p.title,
    department: p.department,
    wing: wingOfDepartment(p.department) ?? "Operations",
    reportsToId: p.reportsTo === ORG_TOP_POSITION ? "static:" + ORG_TOP_POSITION : "static:" + p.reportsTo,
    reportsTo: p.reportsTo,
    isTop: false,
    isHead: p.isHead,
    loginPosition: LOGIN_POSITION_OPTIONS.find((o) => o.label === p.title)?.key ?? null,
    order: 0,
  }))];
}

const chip = "rounded-full px-1.5 py-0.5 text-[10px] font-bold";

export default function OrgPositionPicker({ designation, department, onChange }: {
  designation: string;
  department: string;
  onChange: (next: { title: string; department: string; loginPosition?: string | null }) => void;
}) {
  const [positions, setPositions] = useState<LiveChartPosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("All");

  useEffect(() => {
    let alive = true;
    fetchOrgChart()
      .then((chart) => { if (alive) setPositions(chart.positions); })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Chart unavailable");
        setPositions(staticFallback());
      });
    return () => { alive = false; };
  }, []);

  const rows = positions ?? [];
  const tree = useMemo(() => buildChartTree(rows), [rows]);
  const byTitle = useMemo(() => new Map(rows.map((r) => [r.title, r])), [rows]);
  const current = byTitle.get(designation.trim()) ?? null;
  const known = !!current;
  const suggested = useMemo(() => (known ? null : suggestOrgTitle(designation)), [designation, known]);
  const departments = useMemo(() => ["All", ...Array.from(new Set(rows.filter((r) => !r.isTop).map((r) => r.department ?? "Other")))], [rows]);
  const selectable = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (r.isTop) return false;
      if (dept !== "All" && (r.department ?? "Other") !== dept) return false;
      if (!q) return true;
      return [r.title, r.department, r.loginPosition].some((v) => String(v ?? "").toLowerCase().includes(q));
    }).sort((a, b) => a.order - b.order);
  }, [rows, query, dept]);

  const summary: OrgPosition | null = current ? positionFromChart(current, rows) : null;
  const hints = current?.loginPosition
    ? LOGIN_POSITION_OPTIONS.find((o) => o.key === current.loginPosition)?.label ?? current.loginPosition
    : null;

  return (
    <div className="space-y-2">
      <div className={"rounded-xl border p-3 " + (current ? "border-indigo-500/40 bg-indigo-500/[0.04]" : "border-zinc-200 dark:border-zinc-800")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-extrabold uppercase tracking-wide text-zinc-400">Selected position</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-extrabold">{current ? current.title : "No chart seat"}</span>
              {current?.isHead && <span className={chip + " bg-indigo-500/15 text-indigo-500"}>Head</span>}
              {current && !current.loginPosition && !current.isTop && <span className={chip + " bg-amber-500/15 text-amber-600 dark:text-amber-400"}>No dashboard login</span>}
            </div>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {current
                ? <>{current.department || "No department"}{summary ? " · " + responsibilityLine(summary) : ""}</>
                : designation
                  ? <>Free text <b className="text-amber-600 dark:text-amber-400">“{designation}”</b> — not seated on the chart. Pick a position below to seat this person.</>
                  : "Optional — pick the chart position this person occupies."}
            </p>
            {hints && <p className="mt-1 text-[10px] text-zinc-500">Login position: <b>{hints}</b> · all dashboard access is managed in Users &amp; Permissions.</p>}
          </div>
          {current && (
            <button type="button" onClick={() => onChange({ title: "", department: "", loginPosition: null })}
              className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Clear</button>
          )}
        </div>
      </div>

      {suggested && (
        <button type="button" onClick={() => {
          const hit = byTitle.get(suggested);
          if (hit) onChange({ title: hit.title, department: hit.department ?? "", loginPosition: hit.loginPosition });
        }}
          className="flex w-full items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-left text-[11px] text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
          <span className="font-extrabold uppercase tracking-wide">Suggested</span>
          <span>“{designation}” reads as <b>{suggested}</b> — click to use.</span>
        </button>
      )}

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 p-2 dark:border-zinc-800">
          <div className="text-[11px] font-extrabold uppercase tracking-wide text-zinc-500">Browse positions</div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search position or department…"
            className="w-56 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-[11px] outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950" />
        </div>
        <div className="flex flex-wrap gap-1 border-b border-zinc-200 p-2 dark:border-zinc-800">
          {departments.map((d) => (
            <button key={d} type="button" onClick={() => setDept(d)}
              className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + (dept === d ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300")}>
              {d}
            </button>
          ))}
        </div>
        <div className="max-h-72 overflow-y-auto p-2">
          {!positions && !error && <p className="py-6 text-center text-[11px] text-zinc-500 animate-pulse">Loading chart…</p>}
          {error && <p className="mb-2 rounded-lg bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-600">Using the bundled chart seed — {error}</p>}
          {positions && selectable.length === 0 && <p className="py-6 text-center text-[11px] text-zinc-500">No positions match this filter.</p>}
          <div className="grid gap-1.5 sm:grid-cols-2">
            {selectable.map((r) => {
              const active = current?.id === r.id;
              return (
                <button key={r.id} type="button"
                  onClick={() => onChange({ title: r.title, department: r.department ?? "", loginPosition: r.loginPosition })}
                  className={"rounded-lg border px-2.5 py-2 text-left transition-colors " + (active ? "border-indigo-500 bg-indigo-500/10" : "border-zinc-200 hover:border-indigo-400/60 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900")}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] font-bold text-zinc-800 dark:text-zinc-100">{r.title}</span>
                    {active && <span className={chip + " shrink-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"}>Current</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-zinc-500">
                    <span>{r.department || "No department"}</span>
                    <span>·</span>
                    <span>reports to {rows.find((x) => x.id === r.reportsToId)?.title ?? "—"}</span>
                    {!r.loginPosition && <span className={chip + " bg-zinc-500/10 text-zinc-500"}>no login</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {tree && <p className="text-[10px] text-zinc-400">Top of chart: {tree.title} · {rows.length} positions</p>}
    </div>
  );
}
