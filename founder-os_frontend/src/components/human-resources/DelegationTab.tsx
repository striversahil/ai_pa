"use client";

import React, { useState } from "react";
import ConfirmDialog from "../ui/ConfirmDialog";
import TaskFormModal from "./TaskFormModal";
import {
  TASK_STATUSES, STATUS_LABEL, PRIORITY_LABEL,
  type HrDashboardData, type HrTask, type TaskStatus,
} from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { dateLabel, timeLabel, initials } from "@/hr/format";

function PriorityChip({ p }: { p: HrTask["priority"] }) {
  const cls = p === "urgent" ? "bg-rose-500/10 text-rose-500 border-rose-500/30"
    : p === "high" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
    : p === "low" ? "bg-zinc-500/10 text-zinc-500 border-zinc-500/30"
    : "bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border-indigo-500/30";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${cls}`}>{PRIORITY_LABEL[p]}</span>;
}

function TaskCard({ task, canManage, onRefresh, onEdit, onDelete }: {
  task: HrTask;
  canManage: boolean;
  onRefresh: () => void;
  onEdit: (t: HrTask) => void;
  onDelete: (t: HrTask) => void;
}) {
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [remark, setRemark] = useState(task.remark ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = status !== task.status || remark !== (task.remark ?? "");

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await jsonRequest(`/api/human-resources/tasks/${task.id}`, "PATCH", {
        status,
        remark: remark.trim() || null,
      });
      if (!res.ok) throw new Error(await readError(res));
      onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const border = task.overdue ? "border-rose-500/40" : task.status === "done" ? "border-emerald-500/25" : "border-zinc-200 dark:border-zinc-800";

  return (
    <div className={`rounded-xl border ${border} bg-white dark:bg-zinc-950 p-3 space-y-2`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className={`text-sm font-bold ${task.status === "done" ? "line-through text-zinc-400" : "text-zinc-900 dark:text-zinc-100"}`}>{task.title}</h4>
            <PriorityChip p={task.priority} />
            {task.overdue && <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-500">Overdue</span>}
          </div>
          {task.description && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap">{task.description}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1 font-semibold text-zinc-700 dark:text-zinc-300">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/10 text-[9px] font-extrabold text-indigo-500">{initials(task.assignedToName)}</span>
              {task.assignedToName ?? "Unassigned"}
            </span>
            <span>{dateLabel(task.dueDate)}{task.dueTime ? ` · ${timeLabel(task.dueTime)}` : ""}</span>
            {task.createdBy && <span>by {task.createdBy}</span>}
          </div>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => onEdit(task)} title="Edit task" className="rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Edit</button>
            <button onClick={() => onDelete(task)} title="Delete task" className="rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10">Delete</button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
        <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500">
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Remark (optional)" className="min-w-0 flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500" />
        <button onClick={save} disabled={busy || !dirty} className="rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-xs font-bold text-white dark:text-zinc-900 disabled:opacity-30">{busy ? "Saving…" : "Save"}</button>
      </div>
      {err && <div className="text-[11px] text-rose-500">{err}</div>}
    </div>
  );
}

function Section({ title, count, tone, empty, children }: {
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
      {count === 0 ? <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">{empty}</div> : <div className="grid gap-2 lg:grid-cols-2">{children}</div>}
    </section>
  );
}

export default function DelegationTab({ data, onRefresh, onManageEmployees }: { data: HrDashboardData; onRefresh: () => void; onManageEmployees: () => void }) {
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

  const counts = data.meta.counts;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
          <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-rose-500">Overdue {counts.overdue}</span>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-600 dark:text-amber-400">Today {counts.today}</span>
          <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-indigo-500 dark:text-indigo-400">Upcoming {counts.upcoming}</span>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-600 dark:text-emerald-400">Done {counts.completed}</span>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button onClick={onManageEmployees} className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700">Manage employees</button>
            <button onClick={openNew} className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-bold text-white">New task</button>
          </div>
        )}
      </div>

      {data.meta.unmatched && !canManage && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          Your login is not linked to an HR team member yet. Ask an HR/MIS user to add you to the HR roster using the same name or email.
        </div>
      )}
      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}

      <Section title="Overdue" count={data.tasks.overdue.length} tone="rose" empty="Nothing overdue.">
        {data.tasks.overdue.map((t) => <TaskCard key={t.id} task={t} canManage={canManage} onRefresh={onRefresh} onEdit={(task) => setTaskForm({ open: true, task })} onDelete={setDeleting} />)}
      </Section>

      <Section title="Today" count={data.tasks.today.length} tone="amber" empty="No tasks due today.">
        {data.tasks.today.map((t) => <TaskCard key={t.id} task={t} canManage={canManage} onRefresh={onRefresh} onEdit={(task) => setTaskForm({ open: true, task })} onDelete={setDeleting} />)}
      </Section>

      <Section title="Upcoming" count={data.tasks.upcoming.length} tone="indigo" empty="No upcoming tasks.">
        {data.tasks.upcoming.map((t) => <TaskCard key={t.id} task={t} canManage={canManage} onRefresh={onRefresh} onEdit={(task) => setTaskForm({ open: true, task })} onDelete={setDeleting} />)}
      </Section>

      <Section title="Completed · last 30 days" count={data.tasks.completed.length} tone="emerald" empty="No completed tasks in the last 30 days.">
        {data.tasks.completed.map((t) => <TaskCard key={t.id} task={t} canManage={canManage} onRefresh={onRefresh} onEdit={(task) => setTaskForm({ open: true, task })} onDelete={setDeleting} />)}
      </Section>

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
