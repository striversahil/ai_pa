"use client";

// Full journal for one task — the day-by-day trail behind a task card.
import React from "react";
import Modal from "@/components/Modal";
import { useLiveQuery } from "@/hooks/useLiveData";
import { fetchTaskHistory } from "@/hr/api";
import { dayHeading, groupLogsByDay, istClock } from "@/hr/delegation";
import { dateLabel, timeLabel } from "@/hr/format";
import { STATUS_LABEL, type HrTaskLog, type TaskStatus } from "@/hr/types";

export default function TaskHistoryModal({
  taskId, title, today, onClose,
}: {
  taskId: string;
  title: string;
  today: string;
  onClose: () => void;
}) {
  const q = useLiveQuery(
    () => fetchTaskHistory(taskId),
    { deps: [taskId], pollMs: 60000 },
  );
  const days = groupLogsByDay((q.data?.logs ?? []) as HrTaskLog[]);
  const task = q.data?.task;

  return (
    <Modal title={title} subtitle="Daily update history" onClose={onClose}>
      <div className="space-y-3 overflow-y-auto px-5 pb-5">
        {task && (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-300">
            <b>{task.assignedToName ?? "Unassigned"}</b>
            {" · "}
            {dateLabel(task.dueDate)}
            {task.dueTime ? ` · ${timeLabel(task.dueTime)}` : ""}
            {" · "}
            {STATUS_LABEL[task.status]}
            {task.description ? <div className="mt-1 whitespace-pre-wrap text-zinc-500">{task.description}</div> : null}
          </div>
        )}

        {q.loading && !q.data && <div className="py-6 text-center text-xs text-zinc-500">Loading history…</div>}
        {!!q.error && !q.data && <div className="py-6 text-center text-xs text-rose-500">Could not load history.</div>}
        {!q.loading && !days.length && (
          <div className="py-6 text-center text-xs text-zinc-500">No updates recorded yet.</div>
        )}

        {days.map((day) => (
          <div key={day.date} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">{dayHeading(day.date, today)}</span>
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              <span className="text-[10px] font-bold text-zinc-400">{day.rows.length}</span>
            </div>
            {day.rows.map((log) => (
              <div key={log.id} className="flex items-start gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5">
                <span className="mt-0.5 shrink-0 text-[10px] font-bold text-zinc-400">{istClock(log.createdAt)}</span>
                <div className="min-w-0 flex-1 text-[11px] text-zinc-600 dark:text-zinc-300">
                  {log.kind === "status" && log.status && (
                    <span className="mr-1 font-bold text-zinc-800 dark:text-zinc-100">→ {STATUS_LABEL[log.status as TaskStatus]}</span>
                  )}
                  <span className="whitespace-pre-wrap">{log.remark ?? ""}</span>
                </div>
                {log.authorName && <span className="shrink-0 text-[10px] text-zinc-400">{log.authorName}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
