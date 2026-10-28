"use client";

// Shared delegated-task card. Used by the HR dashboard Delegation tab AND the
// employee Delegation board so there is exactly one task UI in the app.
//
// Writes always go through the delegation service (append-only journal):
//   * manager mode → /api/human-resources/tasks/:id (HR/MIS authority)
//   * self mode    → /api/delegation/tasks/:id (employee, scoped server-side)
// The remark box is append-only: it starts empty and adds one journal entry per
// save, so a task accumulates a day-by-day trail instead of overwriting history.
import React, { useState } from "react";
import {
  PRIORITY_LABEL, STATUS_LABEL, TASK_STATUSES,
  type HrDelegationTask, type HrTask, type TaskStatus,
} from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { dateLabel, timeLabel, initials } from "@/hr/format";
import { dayHeading, istClock } from "@/hr/delegation";

export function PriorityChip({ p }: { p: HrTask["priority"] }) {
  const cls = p === "urgent" ? "bg-rose-500/10 text-rose-500 border-rose-500/30"
    : p === "high" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
    : p === "low" ? "bg-zinc-500/10 text-zinc-500 border-zinc-500/30"
    : "bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border-indigo-500/30";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${cls}`}>{PRIORITY_LABEL[p]}</span>;
}

export function Section({ title, count, tone, empty, children }: {
  title: string;
  count: number;
  tone: "rose" | "amber" | "indigo" | "emerald";
  empty: string;
  children: React.ReactNode;
}) {
  const dot = tone === "rose" ? "bg-rose-500" : tone === "amber" ? "bg-amber-500" : tone === "indigo" ? "bg-indigo-500" : "bg-emerald-500";
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">{title}</h3>
        <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-500">{count}</span>
      </div>
      {count === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">{empty}</div>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">{children}</div>
      )}
    </section>
  );
}

/** Journal rows grouped by IST day — the "what happened each day" trail. */
export function LogList({ logs, today, limit = 4 }: {
  logs: HrDelegationTask["recentLogs"];
  today: string;
  limit?: number;
}) {
  const rows = (logs ?? []).slice(0, limit);
  if (!rows.length) return null;
  return (
    <div className="space-y-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900/60 px-2.5 py-2">
      {rows.map((log) => (
        <div key={log.id} className="flex items-start gap-2 text-[11px] leading-snug">
          <span className="mt-0.5 shrink-0 rounded bg-white px-1.5 py-0.5 text-[9px] font-bold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {dayHeading(log.logDate, today)} · {istClock(log.createdAt)}
          </span>
          <span className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-300">
            {log.kind === "status" && log.status && (
              <span className="mr-1 font-bold text-zinc-800 dark:text-zinc-200">
                → {STATUS_LABEL[log.status as TaskStatus]}
              </span>
            )}
            {log.remark ?? ""}
          </span>
          {log.authorName && <span className="shrink-0 text-[10px] text-zinc-400">{log.authorName}</span>}
        </div>
      ))}
    </div>
  );
}

export interface TaskCardProps {
  task: HrTask | HrDelegationTask;
  /** manager = HR/MIS authority; self = employee on their own board. */
  mode: "manager" | "self";
  /** IST today, for journal day headings. */
  today?: string;
  /** Roster member of the viewer (enables editing/deleting own tasks). */
  selfMemberId?: string | null;
  onChanged: () => void;
  onEdit?: (task: HrTask | HrDelegationTask) => void;
  onDelete?: (task: HrTask | HrDelegationTask) => void;
  onOpenHistory?: (task: HrTask | HrDelegationTask) => void;
  showAssignee?: boolean;
  showHistory?: boolean;
  compact?: boolean;
}

export default function TaskCard({
  task, mode, today = "", selfMemberId = null, onChanged,
  onEdit, onDelete, onOpenHistory,
  showAssignee = true, showHistory = true, compact = false,
}: TaskCardProps) {
  // The staged status is a local override; null = "show server truth" so a live
  // refresh never needs a setState-in-effect to stay in sync.
  const [statusOverride, setStatusOverride] = useState<TaskStatus | null>(null);
  const status = statusOverride ?? task.status;
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const own = mode === "self"
    && task.origin === "self"
    && String(task.createdByMemberId ?? "") === String(selfMemberId ?? "");
  const canEdit = mode === "manager" || own;
  const canDelete = mode === "manager" || own;
  const dirty = status !== task.status || remark.trim().length > 0;
  const logs = "recentLogs" in task ? task.recentLogs : [];

  const save = async () => {
    if (!dirty) return;
    setBusy(true);
    setErr(null);
    // Only send what actually changed: a pure remark writes a remark row, a
    // status change writes a status row (with the remark attached).
    const body: Record<string, unknown> = {};
    if (status !== task.status) body.status = status;
    if (remark.trim()) body.remark = remark.trim();
    try {
      const url = mode === "manager"
        ? `/api/human-resources/tasks/${task.id}`
        : `/api/delegation/tasks/${task.id}`;
      const res = await jsonRequest(url, "PATCH", body);
      if (!res.ok) throw new Error(await readError(res));
      setRemark("");
      setStatusOverride(null);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const border = task.overdue ? "border-rose-500/40"
    : task.status === "done" ? "border-emerald-500/25"
    : "border-zinc-200 dark:border-zinc-800";

  return (
    <div className={`rounded-xl border ${border} bg-white dark:bg-zinc-950 ${compact ? "p-2.5" : "p-3"} space-y-2`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className={`text-sm font-bold ${task.status === "done" ? "line-through text-zinc-400" : "text-zinc-900 dark:text-zinc-100"}`}>{task.title}</h4>
            <PriorityChip p={task.priority} />
            {mode === "self" && task.origin === "self" && (
              <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-500">Self</span>
            )}
            {task.overdue && <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-500">Overdue</span>}
            {"needsUpdate" in task && task.needsUpdate && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">Update today</span>
            )}
          </div>
          {task.description && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap">{task.description}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
            {showAssignee && (
              <span className="inline-flex items-center gap-1 font-semibold text-zinc-700 dark:text-zinc-300">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/10 text-[9px] font-extrabold text-indigo-500">{initials(task.assignedToName)}</span>
                {task.assignedToName ?? "Unassigned"}
              </span>
            )}
            <span>{dateLabel(task.dueDate)}{task.dueTime ? ` · ${timeLabel(task.dueTime)}` : ""}</span>
            {task.status !== "pending" && (
              <span className={task.status === "done" ? "font-bold text-emerald-600 dark:text-emerald-400" : "font-bold text-amber-600 dark:text-amber-400"}>
                {STATUS_LABEL[task.status]}
              </span>
            )}
            {task.createdBy && <span>by {task.createdBy}</span>}
          </div>
        </div>
        {(canEdit || canDelete || (onOpenHistory && logs.length)) && (
          <div className="flex shrink-0 items-center gap-1">
            {canEdit && onEdit && (
              <button onClick={() => onEdit(task)} title="Edit task" className="rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Edit</button>
            )}
            {onOpenHistory && logs.length > 0 && (
              <button onClick={() => onOpenHistory(task)} title="Full history" className="rounded-lg px-2 py-1 text-[11px] font-semibold text-indigo-500 hover:bg-indigo-500/10">History</button>
            )}
            {canDelete && onDelete && (
              <button onClick={() => onDelete(task)} title="Delete task" className="rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10">Delete</button>
            )}
          </div>
        )}
      </div>

      {showHistory && logs.length > 0 && <LogList logs={logs} today={today} />}

      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
        <select value={status} onChange={(e) => setStatusOverride(e.target.value as TaskStatus)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500">
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <input
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }}
          onFocus={() => setEditing(true)}
          placeholder={editing ? "Add today's remark…" : "Add a remark (optional)"}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
        />
        <button onClick={save} disabled={busy || !dirty} className="rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-xs font-bold text-white dark:text-zinc-900 disabled:opacity-30">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {err && <div className="text-[11px] text-rose-500">{err}</div>}
    </div>
  );
}
