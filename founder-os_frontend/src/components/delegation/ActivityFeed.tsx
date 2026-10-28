"use client";

// HR daily activity feed: every status change and remark written on the day,
// newest first, grouped by the IST day it belongs to.
import React from "react";
import { STATUS_LABEL, type HrDelegationActivity, type TaskStatus } from "@/hr/types";
import { dayHeading, istClock } from "@/hr/delegation";

export default function ActivityFeed({
  activity, date, today, onOpenTask,
}: {
  activity: HrDelegationActivity[];
  date: string;
  today: string;
  onOpenTask: (taskId: string) => void;
}) {
  if (!activity.length) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 px-3 py-6 text-center text-xs text-zinc-500">
        No updates recorded on {dayHeading(date, today)}.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {activity.map((row) => (
        <button
          key={row.id}
          type="button"
          onClick={() => onOpenTask(row.taskId)}
          className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-left transition hover:border-indigo-500/40"
        >
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-zinc-400">
            <span>{istClock(row.createdAt)}</span>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <span className="truncate text-zinc-600 dark:text-zinc-300">{row.authorName || row.memberName || "—"}</span>
            {row.kind === "status" && row.status && (
              <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                row.status === "done"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : row.status === "in_progress"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : "bg-zinc-500/10 text-zinc-500"
              }`}>
                {STATUS_LABEL[row.status as TaskStatus]}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">{row.taskTitle}</div>
          {row.remark && <div className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500">{row.remark}</div>}
        </button>
      ))}
    </div>
  );
}
