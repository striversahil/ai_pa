"use client";

// accounts-dashboard/TaskThreadRow — ONE task, one row, the whole year behind it.
//
// Replaces the per-day card grid: a task that repeats on the 15th and 30th is a
// single row with two entries in its thread, and a day nobody logged is listed
// as "Task not done on <date>" until somebody resolves it.
//
// Today's logging is ALWAYS on the row (dense TaskRow: remark + Done / Not Done,
// time taken, proof files) so progress is logged without opening anything. The
// financial-year history is COLLAPSED by default and mounts only when the row is
// opened by hand — no auto-expand, no background thread fetch.
import React, { useCallback, useEffect, useState } from "react";
import type { RosterRow, TaskItem, ThreadDetail, ThreadRow, ThreadSlot } from "./types";
import { StatusChip } from "./StatusChip";
import { TaskRow } from "./TaskRow";
import { ThreadEntryRow } from "./ThreadEntryRow";
import { fetchThread, resolveLateWork } from "./api";
import { fmtShort } from "./helpers";

export function TaskThreadRow({
  row, slotRow, slot, today, todayLabel, identity, roster, showLane,
  onSave, onAttach, onDetach, onLogged,
}: {
  row: ThreadRow;
  slotRow: ThreadSlot;
  slot: string;
  today?: TaskItem;
  todayLabel: string;
  identity: { id: string; name: string | null; as: string };
  roster: RosterRow[];
  showLane: boolean;
  onSave: (logId: string, body: Record<string, unknown>, patch: Partial<TaskItem>) => Promise<unknown>;
  onAttach: (logId: string, file: File) => Promise<unknown>;
  onDetach: (logId: string, fileId: string) => Promise<unknown>;
  /** Called after a successful write so the parent can refetch the payload. */
  onLogged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const c = slotRow.counts;
  const notDone = c.notDone + c.missed + c.late;
  const title = row.shortTitle || row.title;
  const schedule = row.rawText || `${row.frequency}${row.dueTime ? ` · ${row.dueTime}` : ""}`;

  const loadThread = useCallback(async () => {
    try {
      setErr(null);
      setDetail(await fetchThread(row.templateId, slot));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the thread");
    }
  }, [row.templateId, slot]);

  useEffect(() => {
    if (open && !detail) void loadThread();
  }, [open, detail, loadThread]);
  // Today's row changed (remarked / done) → the open thread is stale.
  useEffect(() => { if (open && detail) void loadThread(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [today?.status, today?.remark, today?.updatedAt]);

  const resolve = async (logId: string, note: string) => {
    setBusy(true);
    try {
      await resolveLateWork(logId, note);
      await loadThread();
      onLogged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-xl border bg-white dark:bg-zinc-950 ${c.unresolved > 0 ? "border-rose-500/40" : "border-zinc-200 dark:border-zinc-800"}`}>
      {/* ── task row ─────────────────────────────────────────────────────── */}
      <div className="px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} history for ${title}`}
            className="shrink-0 rounded p-0.5 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer bg-transparent border-0"
          >
            {open ? "▾" : "▸"}
          </button>
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-zinc-900 dark:text-white" title={row.title}>{title}</span>
          {showLane && (
            <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${slot === "junior" ? "border-zinc-300 text-zinc-500 dark:border-zinc-700" : "border-indigo-500/40 bg-indigo-500/10 text-indigo-500"}`}>
              {row.isShared ? `${slot} copy` : slot}
            </span>
          )}
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{schedule}</span>
          <span className="shrink-0 rounded-full border border-zinc-200 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600 dark:border-zinc-800 dark:text-zinc-300" title="Completed in this financial year">
            {slotRow.completionPct}%
          </span>
        </div>

        {/* year summary — the thread's counts, not today's */}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-5 text-[11px] font-semibold">
          <span className="text-emerald-600 dark:text-emerald-400">✓ {c.done} done</span>
          <span className="text-zinc-500">· {notDone} not done</span>
          {c.unresolved > 0 && (
            <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-rose-600 dark:text-rose-300" title="Days the engine recorded as missed that nobody has explained yet">
              ⏳ {c.unresolved} unexplained
            </span>
          )}
          {c.late > 0 && <span className="text-amber-600 dark:text-amber-400" title="Missed days that now carry a late-work description">⚠ {c.late} explained late</span>}
          <span className="text-zinc-400">· {c.due} due so far</span>
        </div>

        {/* today — status only; logging lives in the expanded card so there is
            exactly ONE remark input per day (no second writer to wipe it) */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5">
          {today ? (
            <>
              <StatusChip status={today.status} overdue={today.overdue} incomplete={today.incomplete} />
              <span className="text-[11px] text-zinc-500">
                {today.status === "done"
                  ? `today done${today.doneBy ? ` by ${today.doneBy}` : ""}`
                  : today.status === "not_done"
                    ? "today recorded as not done"
                    : "today still open"}
              </span>
            </>
          ) : (
            <span className="text-[11px] text-zinc-500">Not due today — open the row for its history.</span>
          )}
        </div>
        {/* exactly ONE remark input per day: today's entry is logged right here,
            never inside the collapsible history (no second writer to wipe it). */}
        {today && (
          <div className="mt-2 pl-5">
            <TaskRow dense t={today} roster={roster} identity={identity} onSave={onSave} onAttach={onAttach} onDetach={onDetach} today={todayLabel} />
          </div>
        )}
        {err && <div className="mt-1.5 pl-5 text-[11px] text-rose-500">{err}</div>}
      </div>

      {/* ── history — collapsed until the user opens it ───────────────────── */}
      {open && (
        <div className="space-y-2 border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            <span>History · {detail ? `${detail.from} → ${detail.to}` : "loading…"}</span>
            <button onClick={() => void loadThread()} className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 cursor-pointer bg-transparent">Refresh</button>
          </div>
          {!detail && !err && <div className="py-4 text-center text-[11px] text-zinc-500 animate-pulse">Loading the year…</div>}
          {detail && detail.entries.length === 0 && <div className="rounded-lg border border-dashed border-zinc-300 px-3 py-4 text-center text-[11px] text-zinc-500 dark:border-zinc-700">No entries in this window yet.</div>}
          {detail && detail.entries.map((e) => (
            <ThreadEntryRow key={e.logId} entry={e} busy={busy} onResolve={resolve} />
          ))}
        </div>
      )}
    </div>
  );
}
