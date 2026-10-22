"use client";

import React, { useState } from "react";
import Modal from "../Modal";
import {
  TASK_PRIORITIES, TASK_STATUSES, PRIORITY_LABEL, STATUS_LABEL,
  type HrMember, type HrTask, type TaskPriority, type TaskStatus,
} from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { todayIST } from "@/hr/format";

export default function TaskFormModal({ task, roster, onClose, onSaved }: {
  task?: HrTask | null;
  roster: HrMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!task;
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [assignedToId, setAssignedToId] = useState(task?.assignedToId ?? roster[0]?.id ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? todayIST());
  const [dueTime, setDueTime] = useState(task?.dueTime ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "normal");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "pending");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setErr("Title is required"); return; }
    if (!assignedToId) { setErr("Choose an assignee"); return; }
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || null,
        assignedToId,
        dueDate,
        dueTime: dueTime || null,
        priority,
      };
      if (editing) body.status = status;
      const res = editing
        ? await jsonRequest(`/api/human-resources/tasks/${task!.id}`, "PATCH", body)
        : await jsonRequest("/api/human-resources/tasks", "POST", body);
      if (!res.ok) throw new Error(await readError(res));
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500";
  const label = "block text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1";

  return (
    <Modal
      title={editing ? "Edit delegated task" : "Delegate a task"}
      subtitle={editing ? task?.assignedToName ?? undefined : "Assign an HR task with a due date and time"}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={label}>Task</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Share offer letters with the new hires" className={field} autoFocus />
        </div>
        <div>
          <label className={label}>Details</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Optional context, links or expected output" className={field} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Assign to</label>
            <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className={field}>
              {roster.length === 0 && <option value="">Add a team member first</option>}
              {roster.map((m) => (
                <option key={m.id} value={m.id}>{m.name}{m.designation ? ` · ${m.designation}` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={field}>
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Due date</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={field} />
          </div>
          <div>
            <label className={label}>Due time (optional)</label>
            <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={field} />
          </div>
          {editing && (
            <div>
              <label className={label}>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={field}>
                {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
          )}
        </div>
        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy || roster.length === 0} className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{busy ? "Saving…" : editing ? "Save changes" : "Delegate task"}</button>
        </div>
      </form>
    </Modal>
  );
}
