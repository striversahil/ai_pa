"use client";

// OrganizationTab — the organization chart as a node graph (first HR tab).
//
// React Flow canvas (positions as nodes, reportsToId as edges) + inspector
// rail: click a node to see who sits there and who has logged in. HR can add,
// edit and delete chart positions here; people are still edited in the person
// drawer. Dashboard access lives ONLY in Users & Permissions.
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { deleteChartPosition, fetchOrgChart, fetchOrgPeople, fetchOrgRegions, type OrgChartPosition, type OrgPerson } from "@/org/api";
import OrgInspector from "@/org/OrgInspector";
import OrgPersonDrawer from "@/org/OrgPersonDrawer";
import ChartPositionModal from "./ChartPositionModal";

const OrgGraphCanvas = dynamic(() => import("@/org/OrgGraphCanvas"), { ssr: false });

export default function OrganizationTab({ department }: { department?: string } = {}) {
  const dash = useLiveDashboard(async () => {
    const [org, chart, regionCatalog] = await Promise.all([
      fetchOrgPeople(department ?? null),
      fetchOrgChart(),
      fetchOrgRegions().catch(() => ({ regions: [], allotment: {} })),
    ]);
    return { ...org, chart, regionCatalog };
  }, { events: ["human-resources", "telecalling"], deps: [department ?? ""], pollMs: 60000 });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrgPerson | null>(null);
  const [positionForm, setPositionForm] = useState<{ open: boolean; position: OrgChartPosition | null }>({ open: false, position: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const people: OrgPerson[] = dash.data?.people ?? [];
  const positions: OrgChartPosition[] = dash.data?.chart.positions ?? [];
  const regionCatalog = dash.data?.regionCatalog ?? { regions: [], allotment: {} };
  const canManageChart = !!dash.data?.chart.canManage;

  const peopleByTitle = useMemo(() => {
    const map = new Map<string, OrgPerson[]>();
    for (const p of people) {
      const key = String(p.employee.designation ?? "").trim();
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return map;
  }, [people]);

  const chartTitles = useMemo(() => new Set(positions.map((p) => p.title)), [positions]);
  const scoped = department ? positions.filter((p) => p.department === department) : positions;
  const selectedPosition = selected ? scoped.find((p) => p.id === selected) ?? null : null;
  const selectedPeople = selectedPosition ? (peopleByTitle.get(selectedPosition.title) ?? []) : [];
  const scopedTitles = new Set(scoped.map((p) => p.title));
  const activeSeats = people.filter((p) => p.employee.active && scopedTitles.has(String(p.employee.designation ?? "").trim())).length;
  const filledPositions = scoped.filter(
    (p) => !p.isTop && (peopleByTitle.get(p.title) ?? []).some((x) => x.employee.active),
  ).length;
  const legacy = useMemo(
    () => people.filter((p) => p.employee.active && String(p.employee.designation ?? "").trim() && !chartTitles.has(String(p.employee.designation ?? "").trim())),
    [people, chartTitles],
  );

  const removePosition = async (position: OrgChartPosition) => {
    if (!confirm('Delete chart position "' + position.title + '"? Reporting lines and role standards must be cleared first.')) return;
    setBusy(true); setErr(null);
    try {
      await deleteChartPosition(position.id);
      setSelected(null);
      dash.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Chart positions" value={String(scoped.filter((p) => !p.isTop).length)} />
        <Stat label="Filled" value={filledPositions + "/" + scoped.filter((p) => !p.isTop).length} tone="emerald" />
        <Stat label="Active seats" value={String(activeSeats)} />
        <Stat label="Logins linked" value={String(people.filter((p) => p.login).length)} tone="sky" />
      </div>

      {canManageChart && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-zinc-500">Add a role, change who reports to whom, or delete an empty position. Active seats must be moved first.</p>
          <button onClick={() => setPositionForm({ open: true, position: null })}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500">+ Add position</button>
        </div>
      )}

      {dash.loading && !dash.data && <div className="py-12 text-center text-sm text-zinc-500 animate-pulse">Loading the organization chart…</div>}
      {Boolean(dash.error) && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">
          Chart failed to load: {String(dash.error)}
          <button onClick={() => dash.refresh()} className="ml-2 underline">retry</button>
        </div>
      )}
      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}

      {dash.data && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <OrgGraphCanvas positions={scoped} people={people} selected={selected} onSelect={setSelected} />
            <p className="mt-1.5 text-[11px] text-zinc-500">
              Click a position to see who sits there and who has logged in · drag to pan · scroll to zoom
              {dash.data.chart.source === "seed" ? " · showing the bundled seed until the chart table is seeded" : ""}
            </p>
          </div>
          {selectedPosition && (
            <OrgInspector
              position={selectedPosition}
              positions={positions}
              people={selectedPeople}
              canManage={canManageChart}
              onEdit={setEditing}
              onEditPosition={(p) => setPositionForm({ open: true, position: p })}
              onDeletePosition={removePosition}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      )}

      {legacy.length > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <h3 className="mb-1 text-sm font-bold text-amber-700 dark:text-amber-400">Not on the chart ({legacy.length})</h3>
          <p className="mb-1.5 text-[11px] text-amber-700/80 dark:text-amber-400/80">Open the person and pick a chart position to seat them.</p>
          <div className="flex flex-wrap gap-1.5">
            {legacy.map((p) => (
              <button
                key={p.employee.id}
                onClick={() => setEditing(p)}
                className="rounded-full border border-amber-500/30 bg-white px-2 py-0.5 text-[11px] dark:bg-zinc-950"
              >
                <span className="font-semibold text-zinc-700 dark:text-zinc-200">{p.employee.displayName || p.employee.name}</span>
                <span className="text-zinc-400"> · {p.employee.designation}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {editing && (
        <OrgPersonDrawer
          person={editing}
          positions={positions}
          regions={regionCatalog.regions}
          allotment={regionCatalog.allotment}
          onClose={() => setEditing(null)}
          onSaved={() => dash.refresh()}
        />
      )}
      {positionForm.open && (
        <ChartPositionModal
          position={positionForm.position}
          positions={positions}
          onClose={() => setPositionForm({ open: false, position: null })}
          onSaved={() => dash.refresh()}
        />
      )}
      {busy && <div className="sr-only">Working…</div>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "sky" }) {
  const color = tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : tone === "sky" ? "text-sky-600 dark:text-sky-400" : "text-zinc-800 dark:text-zinc-100";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={"text-base font-extrabold " + color}>{value}</div>
    </div>
  );
}
