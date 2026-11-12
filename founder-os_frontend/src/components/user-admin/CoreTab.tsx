"use client";

// Core tab — read-only unified people view. One entry per non-root login: the
// ASSIGNED designation from locked core tables (GET /api/auth/core-assignments)
// next to the roster-derived suggestion (GET /api/auth/directory). Assignment
// writes arrive with core sign-off (proposal:
// docs/core-change-requests/2026-11-12-core-assignment-write.md) — until then
// HR sees suggestions read-only. Managers keep the existing Manage drawer via
// onManage; HR holders get no edit affordances (canManage false).
import { useMemo, useState } from "react";
import AdminTable from "../admin/AdminTable";
import {
  fetchDirectory, fetchCoreAssignments, fetchHiddenLogins, saveHiddenLogins,
} from "@/auth/api";
import type { DirectoryRow } from "@/auth/directory";
import type { CoreAssignmentRow } from "@/auth/core";
import { POSITION_META } from "@/auth/org-positions";
import { useLiveDashboard } from "@/hooks/useLiveData";

interface CoreTabProps {
  canManage: boolean;
  isRoot: boolean;
  onManage: (userId: string) => void;
}

interface CorePerson extends DirectoryRow {
  assigned?: CoreAssignmentRow | null;
}

export default function CoreTab({ canManage, isRoot, onManage }: CoreTabProps) {
  const dash = useLiveDashboard(async () => {
    const [dir, core] = await Promise.all([fetchDirectory(), fetchCoreAssignments()]);
    const rows: CorePerson[] = dir.directory.map((r) => ({
      ...r,
      assigned: core.assignments[r.id] ?? null,
    }));
    return { rows, canManage: dir.canManage, catalog: core.catalog, coreUnavailable: core.coreUnavailable };
  });
  const rows = useMemo(() => dash.data?.rows ?? [], [dash.data]);
  const catalog = useMemo(() => dash.data?.catalog?.departments ?? [], [dash.data]);
  const [deptFilter, setDeptFilter] = useState("");
  const [hidden, setHidden] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const assignedCount = useMemo(() => rows.filter((r) => r.assigned).length, [rows]);

  const visible = useMemo(() => {
    if (!deptFilter) return rows;
    return rows.filter((r) => {
      const deptName = r.assigned?.department;
      if (deptName) return deptName === deptFilter;
      // Unassigned rows group under their roster-derived department.
      const pos = POSITION_META[r.position as keyof typeof POSITION_META];
      return pos?.label && deptFilter === pos.department;
    });
  }, [rows, deptFilter]);

  const saveHidden = async () => {
    setSaving(true);
    setNote(null);
    try {
      const list = draft.split("\n").map((s) => s.trim()).filter(Boolean);
      const saved = await saveHiddenLogins(list);
      setHidden(saved);
      setDraft(saved.join("\n"));
      dash.refresh();
      setNote(`Hidden list saved (${saved.length} emails). Takes effect immediately.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {dash.loading && !dash.data && <div className="py-12 text-center text-sm text-zinc-500 animate-pulse">Loading core people…</div>}
      {Boolean(dash.error) && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">Failed to load: {String(dash.error)}</div>}
      {dash.data?.coreUnavailable && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-500">Assignment data unavailable — showing roster positions only.</div>
      )}
      {dash.data && (
        <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-6">
          <p className="text-xs text-zinc-500 mb-4">
            {assignedCount} of {rows.length} logins have an assigned designation.
            Assignment writes arrive with core sign-off — until then this tab is read-only.
          </p>
          <AdminTable<CorePerson>
            rows={visible}
            rowKey={(r) => r.id}
            searchPlaceholder="Search name, email, designation…"
            toSearchText={(r) => `${r.name} ${r.email} ${r.assigned?.designation ?? ""} ${POSITION_META[r.position as keyof typeof POSITION_META]?.label ?? r.position} ${r.sources.map((s) => s.label).join(" ")}`}
            emptyText={rows.length === 0 ? "No logins yet." : "No logins match."}
            {...(canManage ? { onRowClick: (r: CorePerson) => onManage(r.id) } : {})}
            toolbarExtra={
              <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
                title="Filter by department"
                className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-2 text-xs outline-none max-w-[190px]">
                <option value="">All departments</option>
                {catalog.map((d) => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
                <option value="sales">sales</option>
                <option value="operations">operations</option>
              </select>
            }
            columns={[
              {
                key: "person", header: "Person",
                sortValue: (r) => (r.name || r.email).toLowerCase(),
                render: (r) => (
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">{((r.name || r.email || "U")).charAt(0).toUpperCase()}</span>
                    <span className="min-w-0">
                      <span className="block font-semibold truncate">{r.name || r.email}
                        {r.hidden && <span className="ml-1.5 text-[10px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded" title="Root-hidden login — visible to root only">HIDDEN</span>}
                      </span>
                      <span className="block text-[11px] text-zinc-500 truncate">{r.email}</span>
                    </span>
                  </span>
                ),
              },
              {
                key: "assigned", header: "Designation",
                sortValue: (r) => r.assigned?.designation ?? `~${r.position}`,
                render: (r) => (
                  r.assigned
                    ? <span className="inline-block rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-emerald-500 dark:text-emerald-400" title={`${r.assigned.department} · ${r.assigned.positionCode}`}>{r.assigned.designation}</span>
                    : <span className="text-[11px] text-zinc-500" title="No assigned designation yet">— unassigned</span>
                ),
              },
              {
                key: "suggested", header: "Suggested",
                sortValue: (r) => POSITION_META[r.position as keyof typeof POSITION_META]?.label ?? r.position,
                render: (r) => (
                  <span title={r.via || undefined} className="inline-block rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                    {POSITION_META[r.position as keyof typeof POSITION_META]?.label ?? r.position}
                  </span>
                ),
              },
              {
                key: "sources", header: "Roster links",
                sortValue: (r) => r.sources.length,
                render: (r) => {
                  if (r.sources.length === 0) return <span className="text-[11px] text-zinc-500" title="No roster match — fix the roster email">— unmapped</span>;
                  return (
                    <span className="flex flex-wrap gap-1">
                      {r.sources.slice(0, 3).map((s) => (
                        <span key={`${s.kind}:${s.id}`} title={s.id} className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-500 dark:text-sky-400">
                          {s.label}
                        </span>
                      ))}
                      {r.sources.length > 3 && <span className="text-[11px] text-zinc-500">+{r.sources.length - 3}</span>}
                    </span>
                  );
                },
              },
              ...(canManage ? [{
                key: "action", header: "", className: "text-right",
                render: (r: CorePerson) => (
                  <button onClick={(e) => { e.stopPropagation(); onManage(r.id); }}
                    className="rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-1.5 cursor-pointer border-0 whitespace-nowrap">
                    Manage
                  </button>
                ),
              }] : []),
            ]}
          />
        </section>
      )}

      {isRoot && (
        <section className="bg-zinc-50 dark:bg-zinc-900 border border-amber-500/30 rounded-xl p-4 sm:p-6">
          <h3 className="text-sm font-bold">Hidden logins <span className="font-normal text-zinc-500">(root only — invisible to everyone else, HR included)</span></h3>
          <p className="text-xs text-zinc-500 mt-1 mb-3">One email per line. Hidden logins keep working; they just never appear outside this page.</p>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} spellCheck={false}
            placeholder={"name@example.com"}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs font-mono outline-none focus:border-indigo-500" />
          <div className="mt-2 flex items-center gap-2">
            <button onClick={async () => {
              try {
                const h = await fetchHiddenLogins();
                setHidden(h);
                setDraft(h.join("\n"));
              } catch { setHidden([]); }
            }}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-bold px-3 py-2 cursor-pointer bg-white dark:bg-zinc-950">
              Load current{hidden ? ` (${hidden.length})` : ""}
            </button>
            <button onClick={saveHidden} disabled={saving}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-2 disabled:opacity-40 cursor-pointer border-0">
              {saving ? "Saving…" : "Save hidden list"}
            </button>
            {note && <span className="text-xs text-zinc-500">{note}</span>}
          </div>
        </section>
      )}
    </div>
  );
}
