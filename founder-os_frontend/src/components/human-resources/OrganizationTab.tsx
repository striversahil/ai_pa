"use client";

// OrganizationTab — the organization chart as a node graph (first HR tab).
//
// React Flow canvas (positions as nodes, reports_to as edges) + inspector
// rail: click a node to see who sits there, who has logged in, and which
// dashboards each login holds. Edit opens the person drawer — one save for
// position, sales fields, access and active state.
//
// Mounted twice with zero props difference: HR mounts it unfiltered, the
// Sales Controller mounts <OrganizationTab department="Sales" /> (Team &
// Access). The server scopes the read, so nothing is filtered client-side.
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { fetchOrgPeople, backfillOrgEmployees, type OrgPerson } from "@/org/api";
import OrgInspector from "@/org/OrgInspector";
import OrgPersonDrawer from "@/org/OrgPersonDrawer";
import { isOrgTitle, ORG_POSITIONS } from "@/hr/organization";

const OrgGraphCanvas = dynamic(() => import("@/org/OrgGraphCanvas"), { ssr: false });

export default function OrganizationTab({ department }: { department?: string } = {}) {
  const dash = useLiveDashboard(
    () => fetchOrgPeople(department ?? null),
    { events: ["human-resources", "telecalling"], deps: [department ?? ""], pollMs: 60000 },
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrgPerson | null>(null);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);

  const people: OrgPerson[] = dash.data?.people ?? [];
  const unlinkedLogins = dash.data?.unlinkedLogins ?? [];
  const unlinkedRoster = dash.data?.unlinkedRoster ?? [];

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

  const selectedPeople = selected ? (peopleByTitle.get(selected) ?? []) : [];
  const activeSeats = people.filter((p) => p.employee.active && isOrgTitle(p.employee.designation)).length;
  const filledPositions = ORG_POSITIONS.filter(
    (p) => (peopleByTitle.get(p.title) ?? []).some((x) => x.employee.active),
  ).length;
  const legacy = useMemo(
    () => people.filter((p) => p.employee.active && String(p.employee.designation ?? "").trim() && !isOrgTitle(p.employee.designation)),
    [people],
  );

  const runBackfill = async () => {
    setBackfillBusy(true);
    setBackfillMsg(null);
    try {
      const r = await backfillOrgEmployees();
      setBackfillMsg(`Created ${r.created} employee record${r.created === 1 ? "" : "s"} · ${r.skipped} already linked`);
      dash.refresh();
    } catch (e) {
      setBackfillMsg(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setBackfillBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Chart positions" value={String(department ? ORG_POSITIONS.filter((p) => p.department === department).length : ORG_POSITIONS.length)} />
        <Stat label="Filled" value={`${filledPositions}/${ORG_POSITIONS.length}`} tone="emerald" />
        <Stat label="Active seats" value={String(activeSeats)} />
        <Stat label="Logins linked" value={String(people.filter((p) => p.login).length)} tone="sky" />
      </div>

      {dash.loading && !dash.data && <div className="py-12 text-center text-sm text-zinc-500 animate-pulse">Loading the organization chart…</div>}
      {Boolean(dash.error) && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">
          Chart failed to load: {String(dash.error)}
          <button onClick={() => dash.refresh()} className="ml-2 underline">retry</button>
        </div>
      )}

      {dash.data && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <OrgGraphCanvas people={people} selected={selected} onSelect={setSelected} />
            <p className="mt-1.5 text-[11px] text-zinc-500">
              Click a position to see who sits there, who has logged in, and which dashboards they hold · drag to pan · scroll to zoom
            </p>
          </div>
          {selected && (
            <OrgInspector
              title={selected}
              people={selectedPeople}
              onEdit={setEditing}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      )}

      {unlinkedRoster.length > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-amber-700 dark:text-amber-400">
              Roster rows without an employee record ({unlinkedRoster.length})
            </h3>
            <button
              onClick={runBackfill}
              disabled={backfillBusy}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-amber-500 disabled:opacity-40"
            >
              {backfillBusy ? "Creating…" : "Create employee records"}
            </button>
          </div>
          <p className="mb-1.5 text-[11px] text-amber-700/80 dark:text-amber-400/80">
            These leaderboard rows are invisible to the chart until they have an employee record. One click creates them (Sales, same name + email).
          </p>
          {backfillMsg && <p className="mb-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{backfillMsg}</p>}
          <div className="flex flex-wrap gap-1.5">
            {unlinkedRoster.map((r) => (
              <span key={r.id} className="rounded-full border border-amber-500/30 bg-white px-2 py-0.5 text-[11px] dark:bg-zinc-950">
                <span className="font-semibold text-zinc-700 dark:text-zinc-200">{r.name}</span>
                {r.email && <span className="text-zinc-400"> · {r.email}</span>}
              </span>
            ))}
          </div>
        </section>
      )}

      {unlinkedLogins.length > 0 && !department && (
        <section className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <h3 className="mb-1 text-sm font-bold">Logins without an employee record ({unlinkedLogins.length})</h3>
          <p className="mb-1.5 text-[11px] text-zinc-500">Add them in the HR Employees tab (match the loginEmail), then set their position here.</p>
          <div className="flex flex-wrap gap-1.5">
            {unlinkedLogins.slice(0, 40).map((u) => (
              <span key={u.id} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {u.name || u.email}
              </span>
            ))}
            {unlinkedLogins.length > 40 && <span className="text-[11px] text-zinc-400">+{unlinkedLogins.length - 40} more</span>}
          </div>
        </section>
      )}

      {legacy.length > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <h3 className="mb-1 text-sm font-bold text-amber-700 dark:text-amber-400">Not on the chart ({legacy.length})</h3>
          <p className="mb-1.5 text-[11px] text-amber-700/80 dark:text-amber-400/80">Open the person and pick a chart position.</p>
          <div className="flex flex-wrap gap-1.5">
            {legacy.map((p) => (
              <button
                key={p.employee.id}
                onClick={() => { setSelected(String(p.employee.designation ?? "")); setEditing(p); }}
                className="rounded-full border border-amber-500/30 bg-white px-2 py-0.5 text-[11px] dark:bg-zinc-950"
              >
                <span className="font-semibold text-zinc-700 dark:text-zinc-200">{p.employee.name}</span>
                <span className="text-zinc-400"> · {p.employee.designation}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {editing && (
        <OrgPersonDrawer
          person={editing}
          onClose={() => setEditing(null)}
          onSaved={() => dash.refresh()}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "sky" }) {
  const color = tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : tone === "sky" ? "text-sky-600 dark:text-sky-400" : "text-zinc-800 dark:text-zinc-100";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-base font-extrabold ${color}`}>{value}</div>
    </div>
  );
}
