"use client";

// accounts-dashboard/ThreadList — the task list: ONE row per task × lane.
//
// Search, frequency filter and the "unexplained only" switch replace the old
// per-day card grid and its two-click-deep backlog tabs. Root can fill the
// financial year once ("Sync year"), after which every due day exists and
// unlogged days are already recorded as "Task not done on <date>".
import React, { useMemo, useState } from "react";
import type { RosterRow, TaskItem, ThreadRow, UnscheduledItem } from "./types";
import { TaskThreadRow } from "./TaskThreadRow";
import { FreqChip } from "./FreqChip";
import { syncThreadWindow } from "./api";
import { FREQS } from "./helpers";

const slotKey = (templateId: string, slot: string) => `${templateId}::${slot}`;

export function ThreadList({
  rows, items, roster, identity, showLane, isAdmin, todayLabel,
  onSave, onAttach, onDetach, onRefresh, unscheduled,
}: {
  rows: ThreadRow[];
  items: TaskItem[];
  roster: RosterRow[];
  identity: { id: string; name: string | null; as: string };
  showLane: boolean;
  isAdmin: boolean;
  todayLabel: string;
  onSave: (logId: string, body: Record<string, unknown>, patch: Partial<TaskItem>) => Promise<unknown>;
  onAttach: (logId: string, file: File) => Promise<unknown>;
  onDetach: (logId: string, fileId: string) => Promise<unknown>;
  onRefresh: () => void;
  unscheduled?: UnscheduledItem[];
}) {
  const [q, setQ] = useState("");
  const [freq, setFreq] = useState("");
  const [onlyUnresolved, setOnlyUnresolved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const todayByKey = useMemo(() => {
    const m = new Map<string, TaskItem>();
    for (const it of items) {
      if (!it.templateId) continue;
      m.set(slotKey(it.templateId, it.slot || "main"), it);
    }
    return m;
  }, [items]);

  const flat = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: Array<{ row: ThreadRow; slot: string; slotRow: ThreadRow["slots"][number] }> = [];
    for (const row of rows) {
      const hay = `${row.shortTitle ?? ""} ${row.title} ${row.rawText ?? ""}`.toLowerCase();
      if (needle && !hay.includes(needle)) continue;
      if (freq && row.frequency !== freq) continue;
      for (const s of row.slots) {
        if (onlyUnresolved && s.counts.unresolved === 0) continue;
        out.push({ row, slot: s.slot, slotRow: s });
      }
    }
    return out;
  }, [rows, q, freq, onlyUnresolved]);

  const unresolvedTotal = useMemo(
    () => rows.reduce((n, r) => n + r.slots.reduce((m, s) => m + s.counts.unresolved, 0), 0),
    [rows],
  );

  const runSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await syncThreadWindow();
      setSyncMsg(`Filled ${r.from} → ${r.to}: ${r.created} day(s) instanced, ${r.missed} recorded as not done.`);
      onRefresh();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a task…"
          aria-label="Search tasks"
          className="min-w-[180px] flex-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950"
        />
        <select
          value={freq}
          onChange={(e) => setFreq(e.target.value)}
          aria-label="Filter by frequency"
          className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
        >
          <option value="">All frequencies</option>
          {FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button
          onClick={() => setOnlyUnresolved((v) => !v)}
          aria-pressed={onlyUnresolved}
          className={`rounded-full border px-3 py-1.5 text-[11px] font-bold cursor-pointer ${onlyUnresolved ? "border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-300" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"}`}
          title="Only tasks with days the engine recorded as missed and nobody explained"
        >
          ⏳ Unexplained only ({unresolvedTotal})
        </button>
        <span className="text-[11px] text-zinc-400">{flat.length} row{flat.length === 1 ? "" : "s"}</span>
        {isAdmin && (
          <button
            onClick={runSync}
            disabled={syncing}
            className="ml-auto rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-[11px] font-bold text-indigo-600 hover:bg-indigo-500/20 disabled:opacity-50 dark:text-indigo-300 cursor-pointer"
            title="Create this financial year's due-day entries once (idempotent) and record the missed days"
          >
            {syncing ? "Syncing…" : "Sync year"}
          </button>
        )}
      </div>
      {syncMsg && <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-3 py-2 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">{syncMsg}</div>}

      <div className="space-y-2">
        {flat.map(({ row, slot, slotRow }) => (
          <TaskThreadRow
            key={slotKey(row.templateId, slot)}
            row={row}
            slotRow={slotRow}
            slot={slot}
            today={todayByKey.get(slotKey(row.templateId, slot))}
            todayLabel={todayLabel}
            identity={identity}
            roster={roster}
            showLane={showLane}
            onSave={onSave}
            onAttach={onAttach}
            onDetach={onDetach}
            onLogged={onRefresh}
          />
        ))}
        {flat.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            {rows.length === 0 ? "No tasks for this view yet — root adds them from the Controller tab." : "Nothing matches these filters."}
          </div>
        )}
      </div>

      {(unscheduled ?? []).length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-500">📌 No fixed date — reference ({unscheduled!.length})</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {unscheduled!.map((u) => (
              <div key={u.templateId} className="rounded-xl border border-dashed border-zinc-300 p-3 text-xs dark:border-zinc-700">
                <div className="font-semibold text-zinc-800 dark:text-zinc-200">{u.title}</div>
                {(u.note || u.dueLabel) && <div className="mt-0.5 text-zinc-500">{[u.note, u.dueLabel].filter(Boolean).join(" · ")}</div>}
                <div className="mt-1.5 flex gap-1.5">
                  <FreqChip f={u.frequency} />
                  <span title={u.employeeRaw ? `Sheet: ${u.employeeRaw}` : undefined} className="inline-flex items-center rounded-full border border-zinc-300 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 dark:border-zinc-700">{u.isShared ? "👥 shared" : u.ownerRole}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
