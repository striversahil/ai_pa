// Pure helpers for the employee delegation board. Framework-free (no DB/HTTP)
// so the Worker service and the unit-level smoke checks can share them.
// Mirrors founder-os_frontend/src/hr/delegation.ts — keep the section rules
// and the "needs an update today" semantics identical on both sides.
import { HrError } from './errors';
import { isTaskOverdue, isValidDate, istDateStr, taskSort } from './parse';

/** Fields an employee may edit on a task they created themselves. */
export const SELF_EDITABLE_FIELDS = [
  'title', 'description', 'dueDate', 'dueTime', 'priority', 'status', 'remark',
] as const;

export function delegationDate(value: unknown): string {
  const raw = String(value ?? '').slice(0, 10);
  return isValidDate(raw) ? raw : istDateStr();
}

export function isSelfEditable(field: string): boolean {
  return (SELF_EDITABLE_FIELDS as readonly string[]).includes(field);
}

export interface DayCounts {
  overdue: number;
  today: number;
  upcoming: number;
  doneToday: number;
  open: number;
}

/** Task buckets for the "my day" view. `doneToday` counts tasks completed
 *  today (status log or updatedAt), not everything completed historically. */
export function dayCounts(
  tasks: any[],
  today = istDateStr(),
  nowTime = '',
  doneTaskIds: Set<string> = new Set(),
): DayCounts {
  const out: DayCounts = { overdue: 0, today: 0, upcoming: 0, doneToday: 0, open: 0 };
  for (const task of tasks ?? []) {
    if (String(task.status) === 'done') {
      if (doneTaskIds.has(String(task.id))) out.doneToday += 1;
      continue;
    }
    out.open += 1;
    if (isTaskOverdue(task, today, nowTime)) out.overdue += 1;
    else if (String(task.dueDate ?? '') === today) out.today += 1;
    else if (String(task.dueDate ?? '') > today) out.upcoming += 1;
  }
  return out;
}

/** Splits tasks into the four visible sections, sorted like the HR dashboard. */
export function taskSections(tasks: any[], today = istDateStr(), nowTime = '') {
  const overdue: any[] = [];
  const todayList: any[] = [];
  const upcoming: any[] = [];
  const done: any[] = [];
  for (const task of tasks ?? []) {
    if (String(task.status) === 'done') { done.push(task); continue; }
    if (isTaskOverdue(task, today, nowTime)) overdue.push(task);
    else if (String(task.dueDate ?? '') === today) todayList.push(task);
    else upcoming.push(task);
  }
  overdue.sort(taskSort);
  todayList.sort(taskSort);
  upcoming.sort(taskSort);
  done.sort((a, b) =>
    String(b.updatedAt ?? b.dueDate ?? '').localeCompare(String(a.updatedAt ?? a.dueDate ?? '')));
  return { overdue, today: todayList, upcoming, done };
}

/** The task still needs an update today: it is open, already due, and has no
 *  journal entry for today yet. Drives the "needs update" chip + HR nudges. */
export function needsUpdateToday(
  task: any,
  today = istDateStr(),
  nowTime = '',
  loggedToday: Set<string> = new Set(),
): boolean {
  if (String(task.status) === 'done') return false;
  if (loggedToday.has(String(task.id))) return false;
  const dueDate = String(task.dueDate ?? '').slice(0, 10);
  if (dueDate > today) return false;
  if (dueDate < today) return true;
  return isTaskOverdue(task, today, nowTime);
}

export function groupLogsByTask(rows: any[], perTask = 5): Map<string, any[]> {
  const out = new Map<string, any[]>();
  for (const row of rows ?? []) {
    const key = String(row.taskId ?? '');
    if (!key) continue;
    const list = out.get(key) ?? [];
    if (list.length < perTask) list.push(row);
    out.set(key, list);
  }
  return out;
}

export function requireValidDate(value: unknown, field = 'date'): string {
  const raw = String(value ?? '').slice(0, 10);
  if (!isValidDate(raw)) throw new HrError(`${field} must be YYYY-MM-DD`);
  return raw;
}
