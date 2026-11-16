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
  overdue: HrTask[];
  today: HrTask[];
  upcoming: HrTask[];
  done: HrTask[];
}

export function taskSections(tasks: HrTask[], today: string): DelegationSections {
  const overdue: HrTask[] = [];
  const todayList: HrTask[] = [];
  const upcoming: HrTask[] = [];
  const done: HrTask[] = [];
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
    String(b.completedAt ?? b.updatedAt ?? b.dueDate ?? "")
      .localeCompare(String(a.completedAt ?? a.updatedAt ?? a.dueDate ?? "")));
  return { overdue, today: todayList, upcoming, done };
}

/** Shallow-patch one task across the HR dashboard's four server buckets. The
 *  TaskBoard re-derives its sections from the flattened list, so an optimistic
 *  status change moves the card instantly even before the refresh reconciles. */
export interface TaskBuckets {
  overdue: HrTask[];
  today: HrTask[];
  upcoming: HrTask[];
  completed: HrTask[];
}

export function patchTaskInBuckets<T extends { tasks: TaskBuckets }>(
  prev: T | null,
  taskId: string,
  patch: Partial<HrTask>,
): T | null {
  if (!prev || !prev.tasks) return prev;
  const tasks = { ...prev.tasks };
  for (const key of ["overdue", "today", "upcoming", "completed"] as const) {
    tasks[key] = (prev.tasks[key] ?? []).map((task) =>
      String(task.id) === String(taskId) ? { ...task, ...patch } : task,
    );
  }
  return { ...prev, tasks };
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

/** "2026-11-16" — the IST calendar day of an ISO timestamp. */
export function istDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d).slice(0, 10);
}

/** Whole-day gap `a - b` between two YYYY-MM-DD strings (wall-clock, no TZ). */
function dayGap(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

/** IST wall-clock minutes since epoch — both sides shift by +05:30, so the
 *  comparison is timezone-free. */
function istWallMs(date: string, time: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1, h || 0, min || 0);
}

export type CompletionTimingKey = "before" | "ontime" | "late";

export interface CompletionTiming {
  key: CompletionTimingKey;
  /** Chip text: "Before time" · "On time" · "Late by 2d". */
  label: string;
}

/** A timed task finished within this many minutes of the promised minute still
 *  counts as On time — nobody lands on the exact minute. */
export const ONTIME_GRACE_MIN = 30;

/** How a completed task landed vs its due date/time. Date-only tasks are due by
 *  the end of their day (completed the same day = on time, a later day = late
 *  by whole days). Null for open tasks (nothing to judge yet). */
export function completionTiming(task: HrTask): CompletionTiming | null {
  if (task.status !== "done") return null;
  const doneDay = istDay(task.completedAt ?? task.updatedAt ?? "");
  const doneClock = istClock(task.completedAt ?? task.updatedAt ?? "");
  const dueDate = String(task.dueDate ?? "").slice(0, 10);
  if (!doneDay || !doneClock || !dueDate) return null;
  const dueTime = String(task.dueTime ?? "").slice(0, 5);
  if (!dueTime) {
    const days = dayGap(doneDay, dueDate);
    if (days === 0) return { key: "ontime", label: "On time" };
    if (days < 0) return { key: "before", label: "Before time" };
    return { key: "late", label: `Late by ${days}d` };
  }
  const lateMin = Math.round(
    (istWallMs(doneDay, doneClock) - istWallMs(dueDate, dueTime)) / 60000,
  );
  if (lateMin < -ONTIME_GRACE_MIN) return { key: "before", label: "Before time" };
  if (lateMin <= ONTIME_GRACE_MIN) return { key: "ontime", label: "On time" };
  if (lateMin < 60) return { key: "late", label: `Late by ${lateMin}m` };
  if (lateMin < 1440) return { key: "late", label: `Late by ${Math.floor(lateMin / 60)}h` };
  return { key: "late", label: `Late by ${Math.floor(lateMin / 1440)}d` };
}
