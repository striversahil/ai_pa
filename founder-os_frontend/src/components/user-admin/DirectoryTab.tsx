"use client";

// Unified employee directory tab — view-first. One entry per non-root login:
// roster-first position + email-exact roster source links (backend
// modules/auth/routes-parts/directory.ts). HR holders get read-only width
// (canManage false → no row click, no edit affordances); managers keep the
// existing Manage drawer via onManage.
import { useEffect, useMemo, useState } from "react";
import AdminTable from "../admin/AdminTable";
import { fetchDirectory, fetchHiddenLogins, saveHiddenLogins, type DirectoryRow } from "@/auth/directory";
import { POSITION_META, POSITION_ORDER } from "@/auth/org-positions";
import { useLiveDashboard } from "@/hooks/useLiveData";

interface DirectoryTabProps {
  canManage: boolean;
  isRoot: boolean;
  onManage: (userId: string) => void;
}

export default function DirectoryTab({ canManage, isRoot, onManage }: DirectoryTabProps) {
  const dash = useLiveDashboard(() => fetchDirectory());
  const rows = useMemo(() => dash.data?.directory ?? [], [dash.data]);
  const [positionFilter, setPositionFilter] = useState("");
  const [hidden, setHidden] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (isRoot) {
      fetchHiddenLogins().then((h) => {
        setHidden(h);
        setDraft(h.join("\n"));
      }).catch(() => setHidden([]));
    }
  }, [isRoot]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.position, (m.get(r.position) ?? 0) + 1);
    return m;
  }, [rows]);

  const visible = useMemo(
    () => (positionFilter ? rows.filter((r) => r.position === positionFilter) : rows),
    [rows, positionFilter],
  );

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
      {dash.loading && !dash.data && <div className="py-12 text-center text-sm text-zinc-500 animate-pulse">Loading directory…</div>}
      {Boolean(dash.error) && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">Failed to load: {String(dash.error)}</div>}
      {dash.data && (
        <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-6">
          <AdminTable<DirectoryRow>
            rows={visible}
            rowKey={(r) => r.id}
            searchPlaceholder="Search name, email or source…"
            toSearchText={(r) => `${r.name} ${r.email} ${POSITION_META[r.position as keyof typeof POSITION_META]?.label ?? r.position} ${r.sources.map((s) => s.label).join(" ")}`}
            emptyText={rows.length === 0 ? "No logins yet." : "No logins match."}
            {...(canManage ? { onRowClick: (r: DirectoryRow) => onManage(r.id) } : {})}
            toolbarExtra={
              <select value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)}
                title="Filter by position"
                className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-2 text-xs outline-none max-w-[190px]">
                <option value="">All positions</option>
                {POSITION_ORDER.map((p) => (
                  <option key={p} value={p}>{POSITION_META[p].label} ({counts.get(p) ?? 0})</option>
                ))}
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
                key: "position", header: "Position",
                sortValue: (r) => POSITION_ORDER.indexOf(r.position as (typeof POSITION_ORDER)[number]),
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
                render: (r: DirectoryRow) => (
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
            <button onClick={saveHidden} disabled={saving}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-2 disabled:opacity-40 cursor-pointer border-0">
              {saving ? "Saving…" : `Save hidden list${hidden ? ` (${hidden.length})` : ""}`}
            </button>
            {note && <span className="text-xs text-zinc-500">{note}</span>}
          </div>
        </section>
      )}
    </div>
  );
}
