// Task journal persistence: one append-only row per status change / remark.
// Both write paths (HR dashboard edits and employee self-service updates) call
// appendTaskLog so a task always has a single, consistent history.
import { prisma } from '../../shared/prisma';
import { istDateStr } from './parse';
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

/** Logs written on one IST day (HR activity feed). */
export async function listLogsForDay(logDate: string, take = 500) {
  const rows: any[] = await (prisma as any).humanResourcesTaskLog.findMany({
    where: { logDate: String(logDate) },
    orderBy: [{ createdAt: 'desc' }],
    take,
  });
  return rows;
}
