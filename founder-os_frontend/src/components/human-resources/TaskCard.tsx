"use client";

// Shared delegated-task card. Used by the HR dashboard Delegation tab AND the
// employee Delegation board so there is exactly one task UI in the app.
//
// Writes always go through the delegation service (append-only journal):
//   * manager mode → /api/human-resources/tasks/:id (HR authority)
//   * self mode    → /api/delegation/tasks/:id (employee, scoped server-side)
// There is no Save button: status changes save immediately, remarks save on
// blur/Enter, and the parent's shared optimistic driver paints + reconciles.
// A done task can only go back to open with a reason; the reason is written as
// the remark on the status journal row.
import React, { useState } from "react";
import Modal from "../Modal";
import {
  PRIORITY_LABEL, STATUS_LABEL, TASK_STATUSES,
  type HrDelegationTask, type HrTask, type TaskStatus,
} from "@/hr/types";
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
  /** manager = HR authority; self = employee on their own board. */
  mode: "manager" | "self";
  /** IST today, for journal day headings. */
  today?: string;
  /** Roster member of the viewer (enables editing/deleting own tasks). */
  selfMemberId?: string | null;
  /** Shared optimistic writer (useHrTaskSave) — paints instantly, reconciles. */
  onSave: (task: HrTask, body: Record<string, unknown>) => Promise<unknown>;
  onEdit?: (task: HrTask | HrDelegationTask) => void;
  onDelete?: (task: HrTask | HrDelegationTask) => void;
  onOpenHistory?: (task: HrTask | HrDelegationTask) => void;
  showAssignee?: boolean;
  showHistory?: boolean;
  compact?: boolean;
}

export default function TaskCard({
  task, mode, today = "", selfMemberId = null, onSave,
  onEdit, onDelete, onOpenHistory,
  showAssignee = true, showHistory = true, compact = false,
}: TaskCardProps) {
  const status = task.status;
  const [remark, setRemark] = useState("");
  const [busyCount, setBusyCount] = useState(0);
  const busy = busyCount > 0;
  const [err, setErr] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [editing, setEditing] = useState(false);
  const [reopen, setReopen] = useState<{ status: TaskStatus; reason: string } | null>(null);

  const own = mode === "self"
    && task.origin === "self"
    && String(task.createdByMemberId ?? "") === String(selfMemberId ?? "");
  const canEdit = mode === "manager" || own;
  const canDelete = mode === "manager" || own;
  const logs = "recentLogs" in task ? task.recentLogs : [];

  const save = async (body: Record<string, unknown>): Promise<boolean> => {
    // Never drop a second action: the shared hook serializes writes per task id,
    // so a status change queues behind an in-flight remark save (and vice versa).
    setBusyCount((n) => n + 1);
    setErr(null);
    setSaveState("saving");
    try {
      await onSave(task, body);
      setSaveState("saved");
      return true;
    } catch (e) {
      setSaveState("error");
      setErr(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setBusyCount((n) => Math.max(0, n - 1));
    }
  };

  const changeStatus = (next: TaskStatus) => {
    if (next === task.status) return;
    // Reopening completed work needs an explicit reason; the modal sends status
    // and reason as one journal row.
    if (task.status === "done" && next !== "done") {
      setErr(null);
      setReopen({ status: next, reason: "" });
      return;
    }
    void save({ status: next });
  };

  const saveRemark = async () => {
    const text = remark.trim();
    if (!text) return;
    const ok = await save({ remark: text });
    // Clear only if untouched since the save started (don't wipe newer typing).
    if (ok) setRemark((cur) => (cur.trim() === text ? "" : cur));
  };

  const confirmReopen = async () => {
    if (!reopen || !reopen.reason.trim()) return;
    const ok = await save({ status: reopen.status, remark: reopen.reason.trim() });
    if (ok) setReopen(null);
  };

  const border = task.overdue ? "border-rose-500/40"
    : task.status === "done" ? "border-emerald-500/25"
    : "border-zinc-200 dark:border-zinc-800";

  const field = "rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500";

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
        <select
          value={status}
          onChange={(e) => changeStatus(e.target.value as TaskStatus)}
          className={field}
        >
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <input
          value={remark}
          onChange={(e) => { setRemark(e.target.value); setSaveState("idle"); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveRemark(); } }}
          onBlur={() => { void saveRemark(); }}
          onFocus={() => setEditing(true)}
          placeholder={editing ? "Add today's remark…" : "Add a remark (optional)"}
          className={`min-w-0 flex-1 ${field}`}
        />
        <span className="shrink-0 px-1 text-[11px] font-semibold text-zinc-400" title="Status saves immediately; remarks save on blur or Enter">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "✓ Saved" : saveState === "error" ? "⚠ Retry" : ""}
        </span>
      </div>
      {err && !reopen && <div className="text-[11px] text-rose-500">{err}</div>}

      {reopen && (
        <Modal
          title="Reopen completed task"
          subtitle={task.title}
          onClose={() => { setReopen(null); setErr(null); }}
        >
          <div className="space-y-3">
            <p className="text-xs text-zinc-500">
              A reason is required. It is added to the task history so everyone can see why this was reopened.
            </p>
            <textarea
              value={reopen.reason}
              onChange={(e) => setReopen({ ...reopen, reason: e.target.value })}
              rows={3}
              placeholder="Why is this task being reopened?"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              autoFocus
            />
            {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setReopen(null); setErr(null); }}
                disabled={busy}
                className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmReopen}
                disabled={busy || !reopen.reason.trim()}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
              >
                {busy ? "Reopening…" : "Reopen task"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
