"use client";

import React, { useMemo, useState } from "react";
import ConfirmDialog from "../ui/ConfirmDialog";
import PdfViewer from "../PdfViewer";
import HiringPositionModal from "./HiringPositionModal";
import PositionDocSlot from "./PositionDocSlot";
import { useLiveDashboard } from "@/hooks/useLiveData";
import {
  deleteHiringPosition, importHiringPositions, listHiringPositions,
} from "@/hr/api";
import {
  filterHiringPositions, hiringPositionSuggestions, hiringStats, docsFor,
  HIRING_FILTERS, type HiringFilter,
} from "@/hr/hiring-positions";
import type { HrHiringPosition, HrPositionDoc } from "@/hr/types";

/**
 * HR hiring kit: job descriptions and SOPs per position (any number of each),
 * viewable inline.
 * HR/MIS-only (the API gate is the same as the rest of the HR dashboard).
 */
export default function HiringKitTab({ designations }: { designations: string[] }) {
  const dash = useLiveDashboard(async () => listHiringPositions(), { pollMs: 60000 });
  const positions = useMemo(() => dash.data?.positions ?? [], [dash.data]);
  const canManage = dash.data?.canManage ?? false;

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<HiringFilter>("all");
  const [modal, setModal] = useState<{ position: HrHiringPosition | null } | null>(null);
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<HrHiringPosition | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const stats = useMemo(() => hiringStats(positions), [positions]);
  const filtered = useMemo(
    () => filterHiringPositions(positions, query, filter),
    [positions, query, filter],
  );
  const suggestions = useMemo(
    () => hiringPositionSuggestions(designations, positions),
    [designations, positions],
  );

  const openDoc = (doc: HrPositionDoc) => setViewer({ url: doc.url, name: doc.title || doc.fileName });

  const importFromRoster = async () => {
    const names = Array.from(new Set(designations.map((d) => String(d ?? "").trim()).filter(Boolean)));
    if (names.length === 0) { setErr("No employee designations found to import."); return; }
    setImporting(true);
    setErr(null);
    setNotice(null);
    try {
      const out = await importHiringPositions(names);
      setNotice(`Imported ${out.created} position${out.created === 1 ? "" : "s"}${out.skipped ? ` · ${out.skipped} already existed` : ""}.`);
      dash.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const removePosition = async () => {
    if (!deleting) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteHiringPosition(deleting.id);
      setDeleting(null);
      dash.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Positions</div>
          <div className="text-lg font-extrabold">{stats.total}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Complete</div>
          <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{stats.complete}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Missing JD</div>
          <div className="text-lg font-extrabold text-amber-600 dark:text-amber-400">{stats.missingJd}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Missing SOP</div>
          <div className="text-lg font-extrabold text-amber-600 dark:text-amber-400">{stats.missingSop}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search position, document, file…"
            className="w-56 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
          {HIRING_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                filter === f.key
                  ? "border-transparent bg-indigo-600 text-white"
                  : "border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={importFromRoster}
              disabled={importing || designations.length === 0}
              title={designations.length === 0 ? "No employee designations to import yet" : "Create a position for every employee designation"}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-bold text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {importing ? "Importing…" : "Import from employees"}
            </button>
            <button
              onClick={() => setModal({ position: null })}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500"
            >
              ＋ Add position
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-emerald-500/70 hover:text-emerald-500" aria-label="Dismiss">✕</button>
        </div>
      )}
      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-500">{err}</div>}
      {dash.loading && !dash.data && <div className="py-12 text-center text-sm text-zinc-500 animate-pulse">Loading hiring kit…</div>}
      {Boolean(dash.error) && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">
          Failed to load: {String(dash.error)} <button onClick={() => dash.refresh()} className="ml-1 underline">Retry</button>
        </div>
      )}

      {dash.data && positions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-10 text-center dark:border-zinc-800">
          <div className="text-2xl">📚</div>
          <h3 className="mt-2 text-sm font-bold">No positions yet</h3>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">
            Add a position, then upload its job description and SOP PDFs — as many of each as you need, viewable right here while hiring.
          </p>
          {canManage && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                onClick={() => setModal({ position: null })}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500"
              >
                ＋ Add position
              </button>
              {designations.length > 0 && (
                <button
                  onClick={importFromRoster}
                  disabled={importing}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-bold text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {importing ? "Importing…" : "Import from employees"}
                </button>
              )}
            </div>
          )}
        </div>
      ) : positions.length > 0 && filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-3 py-10 text-center text-xs text-zinc-500 dark:border-zinc-800">
          No positions match this filter.
        </div>
      ) : (
        <div className="grid gap-2 xl:grid-cols-2">
          {filtered.map((position) => {
            const jdCount = docsFor(position, "jd").length;
            const sopCount = docsFor(position, "sop").length;
            const complete = jdCount > 0 && sopCount > 0;
            return (
              <div key={position.id} className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-extrabold">{position.name}</h3>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {jdCount} JD{jdCount === 1 ? "" : "s"} · {sopCount} SOP{sopCount === 1 ? "" : "s"}
                      {complete ? "" : ` · ${!jdCount && !sopCount ? "upload both" : !jdCount ? "JD missing" : "SOP missing"}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${complete ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
                      {complete ? "Complete" : "Incomplete"}
                    </span>
                    {canManage && (
                      <>
                        <button
                          onClick={() => setModal({ position })}
                          className="rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => setDeleting(position)}
                          className="rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <PositionDocSlot position={position} kind="jd" canManage={canManage} onView={openDoc} onChanged={() => dash.refresh()} />
                  <PositionDocSlot position={position} kind="sop" canManage={canManage} onView={openDoc} onChanged={() => dash.refresh()} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <HiringPositionModal
          position={modal.position}
          suggestions={suggestions}
          onClose={() => setModal(null)}
          onSaved={() => dash.refresh()}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Remove position?"
        message={<>Remove <b>{deleting?.name}</b> and its uploaded JD/SOP PDFs? This cannot be undone.</>}
        confirmLabel="Remove"
        busy={busy}
        onConfirm={removePosition}
        onCancel={() => setDeleting(null)}
      />

      {viewer && <PdfViewer url={viewer.url} name={viewer.name} onClose={() => setViewer(null)} />}
    </div>
  );
}
