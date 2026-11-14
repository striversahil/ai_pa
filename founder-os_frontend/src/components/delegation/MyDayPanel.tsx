"use client";

// Employee "my day" view: a nudge for open tasks with no update today, and the
// shared task board (own tasks + HR-delegated ones) with its horizontal filters.
import React from "react";
import TaskBoard from "./TaskBoard";
import { dateLabel } from "@/hr/format";
import type { HrDelegationBoard, HrDelegationTask, HrTask } from "@/hr/types";

export default function MyDayPanel({
  board, onSave, onAddTask, onEdit, onDelete, onOpenHistory,
}: {
  board: HrDelegationBoard;
  onSave: (task: HrTask, body: Record<string, unknown>) => Promise<unknown>;
  onAddTask: () => void;
  onEdit: (task: HrDelegationTask) => void;
  onDelete: (task: HrDelegationTask) => void;
  onOpenHistory: (task: HrDelegationTask) => void;
}) {
  const { meta, tasks } = board;
  const pending = tasks.filter((t) => t.needsUpdate);

  if (!meta.linked) {
    return (
      <div className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
        <h3 className="text-sm font-extrabold text-amber-700 dark:text-amber-400">Your login is not linked yet</h3>
        <p className="text-xs text-amber-700/80 dark:text-amber-400/80">
          Ask HR to link this email to your employee record (HR → Delegation → Logins).
          {meta.self?.matchedBy === "name" && " You were matched by name, which is not reliable enough to edit tasks."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
          <span>{dateLabel(meta.date)}</span>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <span>{meta.self?.selfName}</span>
          {meta.self?.designation && <span className="text-zinc-400">({meta.self.designation})</span>}
        </div>
        <button onClick={onAddTask} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500">
          + Add my task
        </button>
      </div>

      {pending.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <b>{pending.length}</b> open {pending.length === 1 ? "task needs" : "tasks need"} an update today:
          {" "}
          <span className="font-semibold">{pending.slice(0, 3).map((t) => t.title).join(" · ")}</span>
          {pending.length > 3 ? ` +${pending.length - 3} more` : ""}
        </div>
      )}

      <TaskBoard
        tasks={tasks}
        mode="self"
        today={meta.today}
        selfMemberId={meta.self?.selfId ?? null}
        onSave={onSave}
        onEdit={(t) => onEdit(t as HrDelegationTask)}
        onDelete={(t) => onDelete(t as HrDelegationTask)}
        onOpenHistory={(t) => onOpenHistory(t as HrDelegationTask)}
        showAssignee={false}
        doneTitle="Completed · last 30 days"
        emptyOverdue="Nothing overdue — good."
        emptyToday="No tasks due today. Add one if you have work planned."
        emptyUpcoming="No upcoming tasks."
        emptyDone="Nothing completed in the last 30 days."
      />
    </div>
  );
}
