// Task journal persistence: one append-only row per status change / remark.
// Both write paths (HR dashboard edits and employee self-service updates) call
// appendTaskLog so a task always has a single, consistent history.
import { prisma } from '../../shared/prisma';
import { addDays, istDateStr } from './parse';
import { taskLogJson } from './task-json';

export interface TaskLogInput {
  taskId: string;
  memberId: string | null;
  /** IST day the update was written. Defaults to today. */
  logDate?: string;
  kind: 'remark' | 'status';
  status?: string | null;
  remark?: string | null;
  authorName?: string | null;
  authorMemberId?: string | null;
}

export async function appendTaskLog(input: TaskLogInput) {
  const remark = String(input.remark ?? '').trim();
  const kind: 'remark' | 'status' = input.kind === 'status' ? 'status' : 'remark';
  // Never write an empty row (a status action without a note still carries the
  // status; a pure remark with no text is a no-op).
  if (kind === 'remark' && !remark) return null;
  const row: any = await (prisma as any).humanResourcesTaskLog.create({
    data: {
      taskId: String(input.taskId),
      memberId: input.memberId ?? null,
      logDate: input.logDate && /^\d{4}-\d{2}-\d{2}$/.test(input.logDate) ? input.logDate : istDateStr(),
      kind,
      status: kind === 'status' ? (input.status ?? null) : null,
      remark: remark || null,
      authorName: input.authorName ?? null,
      authorMemberId: input.authorMemberId ?? null,
    },
  });
  return taskLogJson(row);
}

export async function listTaskLogs(taskId: string, limit = 100) {
  const rows: any[] = await (prisma as any).humanResourcesTaskLog.findMany({
    where: { taskId: String(taskId) },
    orderBy: [{ createdAt: 'desc' }],
    take: Math.min(Math.max(Number(limit) || 100, 1), 300),
  });
  return rows.map(taskLogJson).filter(Boolean);
}

/** Logs for a set of tasks, newest first, capped — used to inline recent
 *  history on the delegation board without an N+1 query. */
export async function listLogsForTasks(taskIds: string[], take = 400) {
  if (!taskIds.length) return [];
  const rows: any[] = await (prisma as any).humanResourcesTaskLog.findMany({
    where: { taskId: { in: taskIds.slice(0, 500) } },
    orderBy: [{ createdAt: 'desc' }],
    take,
  });
  return rows;
}

/** Latest `done` status change per task. The completion window ("Completed ·
 *  last 30 days") must key on when the task was completed, never on dueDate —
 *  a task can be due long ago and still be completed today. */
export async function latestDoneDates(taskIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(taskIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows: any[] = await (prisma as any).humanResourcesTaskLog.findMany({
    where: { taskId: { in: ids.slice(0, 500) }, kind: 'status', status: 'done' },
    orderBy: [{ createdAt: 'desc' }],
    take: 5000,
  });
  const out = new Map<string, string>();
  for (const row of rows) {
    const key = String(row.taskId);
    if (out.has(key) || !row.createdAt) continue;
    // Normalise to ISO so callers can string-compare / sort completion dates.
    const d = row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt));
    out.set(key, Number.isNaN(d.getTime()) ? String(row.createdAt) : d.toISOString());
  }
  return out;
}

export interface CompletedWindowRow {
  /** IST day the task was completed (YYYY-MM-DD). */
  day: string;
  /** Completion timestamp, ISO — sort key for "newest completion first". */
  at: string;
}

/** Done tasks completed within `days` of `today`, keyed by task id — the
 *  "Completed · last 30 days" window. Keys on the latest done journal row
 *  (fallback `updatedAt`), never on `dueDate`, so a task due long ago but
 *  completed today still shows. Non-done rows are ignored. */
export async function completedInWindow<T extends { id: unknown; status: unknown; updatedAt?: unknown }>(
  rows: T[],
  today: string,
  days = 30,
): Promise<Map<string, CompletedWindowRow>> {
  const done = rows.filter((row) => String(row.status) === 'done');
  const dates = await latestDoneDates(done.map((row) => String(row.id)));
  const cutoff = addDays(today, -days);
  const out = new Map<string, CompletedWindowRow>();
  for (const row of done) {
    const d = new Date(String(dates.get(String(row.id)) ?? row.updatedAt ?? ''));
    if (Number.isNaN(d.getTime())) continue;
    const day = istDateStr(d);
    if (day >= cutoff) out.set(String(row.id), { day, at: d.toISOString() });
  }
  return out;
}

/** Logs written on one IST day (HR activity feed). */
export async function listLogsForDay(logDate: string, take = 500) {
  const rows: any[] = await (prisma as any).humanResourcesTaskLog.findMany({
    where: { logDate: String(logDate) },
    orderBy: [{ createdAt: 'desc' }],
    take,
  });
  return rows;
}
