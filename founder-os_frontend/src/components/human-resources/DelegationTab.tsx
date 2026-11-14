"use client";

import React, { useState } from "react";
import ConfirmDialog from "../ui/ConfirmDialog";
import TaskFormModal from "./TaskFormModal";
import TaskBoard from "../delegation/TaskBoard";
import { type HrDashboardData, type HrTask } from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";

// Manager-side task board inside the HR dashboard. The employee-facing board
// (/delegation) shares TaskBoard/TaskCard with this tab, so both stay identical —
// see components/delegation/DelegationView.tsx.
export default function DelegationTab({ data, onRefresh, onSaveTask, onManageEmployees, onOpenBoard }: {
  data: HrDashboardData;
  onRefresh: () => void;
  onSaveTask: (task: HrTask, body: Record<string, unknown>) => Promise<unknown>;
  onManageEmployees: () => void;
  /** Navigate to the full Delegation board (employee day view + activity). */
  onOpenBoard?: () => void;
}) {
  const canManage = data.meta.canManage;
  const [taskForm, setTaskForm] = useState<{ open: boolean; task: HrTask | null }>({ open: false, task: null });
  const [deleting, setDeleting] = useState<HrTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openNew = () => {
    if (data.roster.length === 0) { onManageEmployees(); return; }
    setTaskForm({ open: true, task: null });
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true); setErr(null);
    try {
      const res = await jsonRequest(`/api/human-resources/tasks/${deleting.id}`, "DELETE");
      if (!res.ok) throw new Error(await readError(res));
      setDeleting(null);
      onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally { setBusy(false); }
  };

  // The backend buckets completed rows to the last 30 days; flatten them for
  // the shared board, which re-derives its own filter sections.
  const allTasks = [
    ...data.tasks.overdue,
    ...data.tasks.today,
    ...data.tasks.upcoming,
    ...data.tasks.completed,
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">
          Status changes save immediately. Reopening a completed task needs a reason.
        </p>
        <div className="flex items-center gap-2">
          {onOpenBoard && (
            <button onClick={onOpenBoard} className="rounded-lg bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-500 hover:bg-indigo-500/20">Daily board</button>
          )}
          {canManage && (
            <>
              <button onClick={onManageEmployees} className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700">Manage employees</button>
              <button onClick={openNew} className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-bold text-white">New task</button>
            </>
          )}
        </div>
      </div>

      {data.meta.unmatched && !canManage && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          Your login is not linked to an HR team member yet. Ask an HR user to add you to the HR roster using the same name or email.
        </div>
      )}
      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}

      <TaskBoard
        tasks={allTasks}
        mode="manager"
        today={data.meta.today}
        onSave={onSaveTask}
        onEdit={(task) => setTaskForm({ open: true, task: task as HrTask })}
        onDelete={(task) => setDeleting(task as HrTask)}
        doneTitle="Completed · last 30 days"
        emptyDone="No completed tasks in the last 30 days."
      />

      {taskForm.open && (
        <TaskFormModal
          task={taskForm.task}
          roster={data.roster}
          onClose={() => setTaskForm({ open: false, task: null })}
          onSaved={onRefresh}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete delegated task?"
        message={<>Delete <b>{deleting?.title}</b>? This removes it from the HR task list.</>}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
