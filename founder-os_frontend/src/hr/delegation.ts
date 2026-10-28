// Pure section/day rules for the Delegation board.
// Mirrors founder-os_backend/src/automations/human-resources/delegation-parse.ts
// — keep the section buckets, the sort order and the "needs an update today"
// semantics identical on both sides (same names, same behaviour).
import type { HrDelegationCounts, HrDelegationTask, HrTask, HrTaskLog } from "@/hr/types";

/** Fields an employee may edit on a task they created themselves. */
export const SELF_EDITABLE_FIELDS = [
  "title", "description", "dueDate", "dueTime", "priority", "status", "remark",
] as const;

export function isSelfEditable(field: string): boolean {
  return (SELF_EDITABLE_FIELDS as readonly string[]).includes(field);
}

/** Employees may edit content only on their own tasks; HR tasks are status+remark. */
export function canEditContent(task: HrTask, selfMemberId: string | null): boolean {
  return !!selfMemberId
    && task.origin === "self"
    && String(task.createdByMemberId ?? "") === String(selfMemberId);
}

/** Sorts within a section: due date, then due time, then priority weight. */
const PRIORITY_WEIGHT: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function taskSort(a: HrTask, b: HrTask): number {
  const da = String(a.dueDate ?? "");
  const db = String(b.dueDate ?? "");
  if (da !== db) return da.localeCompare(db);
  const ta = String(a.dueTime ?? "99:99");
  const tb = String(b.dueTime ?? "99:99");
  if (ta !== tb) return ta.localeCompare(tb);
  return (PRIORITY_WEIGHT[a.priority] ?? 9) - (PRIORITY_WEIGHT[b.priority] ?? 9);
}

export function isOverdue(task: HrTask, today: string): boolean {
  if (task.status === "done") return false;
  const due = String(task.dueDate ?? "");
  if (!due) return false;
  if (due < today) return true;
  if (due > today) return false;
  // Same-day tasks are overdue only once their due time has passed — the server
  // already computes `overdue` with IST wall-clock, so trust it for today.
  return !!task.overdue;
}

export interface DelegationSections {
  overdue: HrDelegationTask[];
  today: HrDelegationTask[];
  upcoming: HrDelegationTask[];
  done: HrDelegationTask[];
}

export function taskSections(tasks: HrDelegationTask[], today: string): DelegationSections {
  const overdue: HrDelegationTask[] = [];
  const todayList: HrDelegationTask[] = [];
  const upcoming: HrDelegationTask[] = [];
  const done: HrDelegationTask[] = [];
  for (const task of tasks ?? []) {
    if (task.status === "done") { done.push(task); continue; }
    if (isOverdue(task, today)) overdue.push(task);
    else if (String(task.dueDate ?? "") === today) todayList.push(task);
    else upcoming.push(task);
  }
  overdue.sort(taskSort);
  todayList.sort(taskSort);
  upcoming.sort(taskSort);
  done.sort((a, b) =>
    String(b.updatedAt ?? b.dueDate ?? "").localeCompare(String(a.updatedAt ?? a.dueDate ?? "")));
  return { overdue, today: todayList, upcoming, done };
}

/** Counts for the day chips: what is overdue / due today / upcoming / done today. */
export function dayCounts(
  tasks: HrDelegationTask[],
  today: string,
  logDate: string,
): HrDelegationCounts {
  const out: HrDelegationCounts = { overdue: 0, today: 0, upcoming: 0, doneToday: 0, open: 0 };
  for (const task of tasks ?? []) {
    if (task.status === "done") {
      const logsToday = (task.recentLogs ?? []).some(
        (log) => log.logDate === logDate && log.kind === "status" && log.status === "done",
      );
      const updatedToday = String(task.updatedAt ?? "").slice(0, 10) === logDate;
      if (logsToday || updatedToday) out.doneToday += 1;
      continue;
    }
    out.open += 1;
    if (isOverdue(task, today)) out.overdue += 1;
    else if (String(task.dueDate ?? "") === today) out.today += 1;
    else out.upcoming += 1;
  }
  return out;
}

/** Group journal rows by their IST day, newest day first, newest row first. */
export function groupLogsByDay(logs: HrTaskLog[]): Array<{ date: string; rows: HrTaskLog[] }> {
  const byDay = new Map<string, HrTaskLog[]>();
  for (const log of logs ?? []) {
    const key = String(log.logDate ?? "").slice(0, 10) || "unknown";
    const list = byDay.get(key) ?? [];
    list.push(log);
    byDay.set(key, list);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, rows]) => ({
      date,
      rows: rows.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))),
    }));
}

/** "2026-10-27" → "Today" / "Yesterday" / "27 Oct 2026". */
export function dayHeading(date: string, today: string): string {
  if (!date) return "";
  if (date === today) return "Today";
  const [y, m, d] = today.split("-").map(Number);
  const yest = new Date(Date.UTC(y, m - 1, d - 1, 12)).toISOString().slice(0, 10);
  if (date === yest) return "Yesterday";
  const [dy, dm, dd] = date.split("-").map(Number);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!dy || !dm || !dd) return date;
  return `${dd} ${MONTHS[dm - 1]} ${dy}`;
}

/** "14:32" from an ISO timestamp in IST. */
export function istClock(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}
