// Pure JSON mapping for delegated HR tasks and their daily journal rows.
// Shared by the HR dashboard payload (service.ts) and the employee delegation
// board (delegation.ts) so both always expose the same shape.
// Mirrors founder-os_frontend/src/hr/types.ts (HrTask / HrTaskLog).
import { isTaskOverdue } from './parse';

export function taskJson(row: any, today: string, nowTime: string) {
  return {
    id: String(row.id),
    title: row.title ?? '',
    description: row.description ?? null,
    assignedToId: row.assignedToId ?? null,
    assignedToName: row.assignedTo?.name ?? null,
    assignedToDesignation: row.assignedTo?.designation ?? null,
    dueDate: row.dueDate ?? null,
    dueTime: row.dueTime ?? null,
    priority: row.priority ?? 'normal',
    status: row.status ?? 'pending',
    remark: row.remark ?? null,
    origin: row.origin === 'self' ? 'self' : 'hr',
    createdByMemberId: row.createdByMemberId ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    overdue: isTaskOverdue(row, today, nowTime),
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

export function taskLogJson(row: any) {
  if (!row) return null;
  return {
    id: String(row.id),
    taskId: String(row.taskId),
    memberId: row.memberId ?? null,
    logDate: String(row.logDate ?? ''),
    kind: row.kind === 'status' ? 'status' : 'remark',
    status: row.status ?? null,
    remark: row.remark ?? null,
    authorName: row.authorName ?? null,
    authorMemberId: row.authorMemberId ?? null,
    createdAt: row.createdAt ?? null,
  };
}
