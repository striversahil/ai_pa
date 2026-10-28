// Employee delegation board: the employee-facing view of HR delegated tasks.
//
// Design notes
//  * One task model (HumanResourcesTask) serves both the HR dashboard and this
//    board — no parallel task system. HR keeps its existing CRUD endpoints;
//    this module adds the self-service reads/writes employees need.
//  * Every status change / remark is journalled in HumanResourcesTaskLog by the
//    shared task-logs writer, so HR edits and employee updates produce one
//    timeline (see service.updateTask).
//  * Reads are session-scoped here, never in the UI: a non-manager can only
//    ever receive rows assigned to their own roster member.
// Mirrors founder-os_frontend/src/hr/delegation.ts for the pure section rules.
import { prisma } from '../../shared/prisma';
import { HrError } from './errors';
import { cleanTaskCreate, cleanTaskPatch, istDateStr, istTimeStr } from './parse';
import { taskJson } from './task-json';
import { appendTaskLog, listLogsForDay, listLogsForTasks } from './task-logs';
import { invalidateHumanResourcesCache, resolveSelfHumanResourcesMember } from './service';
import {
  dayCounts, delegationDate, groupLogsByTask, isSelfEditable, needsUpdateToday,
} from './delegation-parse';
import type { HrSelf } from './types';

const TASK_TAKE = 500;
const LOG_TAKE = 500;

export function isHrManager(me: any): boolean {
  const scopes = (me?.scopes ?? []) as string[];
  return !!me?.isAdmin || scopes.includes('mis') || scopes.includes('human-resources');
}

function normEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function emailTokens(value: unknown): string[] {
  return String(value ?? '')
    .split(/[,;/\s]+/)
    .map((part) => normEmail(part).replace(/[^a-z0-9@._+-]/g, ''))
    .filter(Boolean);
}

function asDate(value: unknown): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? '' : istDateStr(d);
}

function rosterLite(row: any, known: Set<string>) {
  const loginTokens = emailTokens(row.loginEmail);
  const mailTokens = emailTokens(row.email);
  const byLogin = loginTokens.some((t) => known.has(t));
  const byEmail = mailTokens.some((t) => known.has(t));
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    designation: row.designation ?? null,
    department: row.department ?? null,
    employeeCode: row.employeeCode ?? null,
    photoUrl: row.photoUrl ?? null,
    active: row.active !== false,
    order: Number(row.order) || 0,
    email: row.email ?? null,
    loginEmail: row.loginEmail ?? null,
    linked: byLogin || byEmail,
    matchedBy: byLogin ? 'loginEmail' : byEmail ? 'email' : null,
  };
}

export async function getDelegationBoard(opts: {
  me: any;
  date?: string;
  knownLogins?: Set<string>;
}) {
  const today = istDateStr();
  const nowTime = istTimeStr();
  const date = delegationDate(opts.date);
  const isManager = isHrManager(opts.me);
  const known = opts.knownLogins ?? new Set<string>();
  const self = await resolveSelfHumanResourcesMember(null, opts.me);

  const rosterRows = (await prisma.humanResourcesMember.findMany({
    where: { deleted: false }, orderBy: { order: 'asc' },
  })) as any[];
  const rosterById = new Map(rosterRows.map((row) => [String(row.id), row]));
  const roster = rosterRows
    .filter((row) => row.active !== false)
    .map((row) => {
      const lite = rosterLite(row, known);
      return {
        id: lite.id, name: lite.name, designation: lite.designation,
        department: lite.department, employeeCode: lite.employeeCode,
        photoUrl: lite.photoUrl, order: lite.order,
      };
    });

  // ── Tasks visible to this viewer ────────────────────────────────────────
  const where: any = { deleted: false };
  if (!isManager) {
    if (!self) {
      return {
        meta: {
          date, today, isManager, linked: false, self: null,
          counts: { overdue: 0, today: 0, upcoming: 0, doneToday: 0, open: 0 },
        },
        tasks: [],
      };
    }
    where.assignedToId = self.selfId;
  }
  const taskRows = (await prisma.humanResourcesTask.findMany({
    where,
    include: { assignedTo: true },
    orderBy: [{ dueDate: 'asc' }, { dueTime: 'asc' }],
    take: TASK_TAKE,
  })) as any[];
  const tasks = taskRows.map((row) => taskJson(row, today, nowTime));
  const taskById = new Map(taskRows.map((row) => [String(row.id), row]));

  // Recent journal entries inlined on each card (last 5, newest first).
  const recentLogs = await listLogsForTasks(tasks.map((t) => t.id), 400);
  const logsByTask = groupLogsByTask(recentLogs, 5);

  // Today's journal — the "did they update it today" signal.
  const logsToday = isManager ? await listLogsForDay(date, LOG_TAKE) : [];
  const doneTodayIds = new Set<string>(
    (isManager
      ? logsToday.filter((l) => l.kind === 'status' && l.status === 'done')
      : recentLogs.filter((l) => l.kind === 'status' && l.status === 'done' && l.logDate === date)
    ).map((l) => String(l.taskId)),
  );
  // A task completed today without an explicit status log still counts.
  for (const row of taskRows) {
    if (String(row.status) === 'done' && asDate(row.updatedAt) === date) doneTodayIds.add(String(row.id));
  }

  const loggedToday = new Set<string>(
    (isManager ? logsToday : recentLogs.filter((l) => l.logDate === date))
      .map((l) => String(l.taskId)),
  );

  const payloadTasks = tasks.map((task) => ({
    ...task,
    recentLogs: (logsByTask.get(String(task.id)) ?? []).map((row) => ({
      id: String(row.id),
      taskId: String(row.taskId),
      logDate: String(row.logDate ?? ''),
      kind: row.kind === 'status' ? 'status' : 'remark',
      status: row.status ?? null,
      remark: row.remark ?? null,
      authorName: row.authorName ?? null,
      createdAt: row.createdAt ?? null,
    })),
    needsUpdate: !isManager ? needsUpdateToday(task, today, nowTime, loggedToday) : false,
  }));

  const counts = dayCounts(tasks, today, nowTime, doneTodayIds);
  const selfRow = self ? rosterById.get(String(self.selfId)) : null;
  const meta = {
    date,
    today,
    isManager,
    linked: !!self,
    self: self
      ? {
        id: self.selfId,
        name: self.selfName,
        designation: self.designation,
        matchedBy: self.matchedBy ?? null,
        email: selfRow?.email ?? null,
        loginEmail: selfRow?.loginEmail ?? null,
      }
      : null,
    counts,
  };

  if (!isManager) return { meta, tasks: payloadTasks };

  // ── Manager extras: roster, per-member day cards, activity feed, logins ──
  const activityTaskIds = [...new Set(logsToday.map((row) => String(row.taskId)))];
  const activityTasks = activityTaskIds.length
    ? (await prisma.humanResourcesTask.findMany({
      where: { id: { in: activityTaskIds.slice(0, 500) } },
      take: 500,
    })) as any[]
    : [];
  const activityTaskById = new Map(activityTasks.map((row) => [String(row.id), row]));

  const team = rosterRows
    .filter((row) => row.active !== false)
    .map((row) => {
      const id = String(row.id);
      const mine = taskRows.filter((task) => String(task.assignedToId) === id);
      const open = mine.filter((task) => String(task.status) !== 'done');
      const updates = logsToday.filter((log) => String(log.memberId) === id);
      const doneOnDate = new Set<string>(
        updates.filter((log) => log.kind === 'status' && log.status === 'done').map((log) => String(log.taskId)),
      );
      for (const task of mine) {
        if (String(task.status) === 'done' && asDate(task.updatedAt) === date) doneOnDate.add(String(task.id));
      }
      return {
        memberId: id,
        name: String(row.name ?? ''),
        designation: row.designation ?? null,
        photoUrl: row.photoUrl ?? null,
        open: open.length,
        dueOnDate: open.filter((task) => String(task.dueDate ?? '') === date).length,
        overdue: open.filter((task) => String(task.dueDate ?? '') < today).length,
        doneOnDate: doneOnDate.size,
        updates: updates.length,
        lastUpdateAt: updates[0]?.createdAt ?? null,
      };
    });

  const activity = logsToday.map((log) => {
    const task = activityTaskById.get(String(log.taskId)) ?? taskById.get(String(log.taskId));
    return {
      id: String(log.id),
      taskId: String(log.taskId),
      taskTitle: task?.title ?? 'Task',
      memberId: log.memberId ?? null,
      memberName: log.memberId ? String(rosterById.get(String(log.memberId))?.name ?? '') : '',
      kind: log.kind === 'status' ? 'status' : 'remark',
      status: log.status ?? null,
      remark: log.remark ?? null,
      authorName: log.authorName ?? null,
      logDate: String(log.logDate ?? ''),
      createdAt: log.createdAt ?? null,
    };
  });

  return {
    meta,
    tasks: payloadTasks,
    roster,
    team,
    activity,
    logins: rosterRows.map((row) => rosterLite(row, known)),
  };
}

async function memberSelf(me: any): Promise<HrSelf> {
  const self = await resolveSelfHumanResourcesMember(null, me);
  if (!self) {
    throw new HrError(
      'Your login is not linked to an HR employee record. Ask HR to set your login email.',
      403,
    );
  }
  return self;
}

async function taskRow(id: string) {
  const row: any = await (prisma as any).humanResourcesTask.findFirst({
    where: { id: String(id) }, include: { assignedTo: true },
  });
  if (!row || row.deleted) throw new HrError('task not found', 404);
  return row;
}

/** Employee creates their own task. Assignee is forced to the caller — the
 *  client cannot hand work to someone else through this endpoint. */
export async function createSelfTask(input: Record<string, any>, me: any, actor: string | null) {
  const self = await memberSelf(me);
  const data = cleanTaskCreate({ ...input, assignedToId: self.selfId });
  const row: any = await (prisma as any).humanResourcesTask.create({
    data: {
      ...data,
      assignedToId: self.selfId,
      origin: 'self',
      createdByMemberId: self.selfId,
      createdBy: actor,
      updatedBy: actor,
    },
    include: { assignedTo: true },
  });
  await invalidateHumanResourcesCache();
  // Re-read with the assignee relation: the D1 shim ignores `include` on create.
  const full = await taskRow(String(row.id)).catch(() => row);
  return taskJson(full, istDateStr(), istTimeStr());
}

/** Employee updates their own task. HR-assigned tasks: status + remark only.
 *  Self-created tasks: any content field may also be edited. */
export async function updateDelegationTask(
  id: string,
  input: Record<string, any>,
  me: any,
  actor: string | null,
) {
  const current = await taskRow(id);
  const isManager = isHrManager(me);
  const self = isManager ? null : await memberSelf(me);

  if (!isManager) {
    if (String(current.assignedToId) !== String(self!.selfId)) {
      throw new HrError('You can only update tasks assigned to you', 403);
    }
    const isOwnTask = String(current.origin ?? 'hr') === 'self'
      && String(current.createdByMemberId ?? '') === String(self!.selfId);
    const blocked = Object.keys(input).filter((key) => {
      if (key === 'status' || key === 'remark') return false;
      if (key === 'assignedToId') return true;
      return !(isOwnTask && isSelfEditable(key));
    });
    if (blocked.length) {
      throw new HrError(
        isOwnTask
          ? `Only title, details, due date/time, priority, status and remark can be changed (blocked: ${blocked.join(', ')})`
          : 'Only status and remark can be changed on a task delegated by HR',
        403,
      );
    }
  }

  const patch = cleanTaskPatch(input);
  if (patch.assignedToId !== undefined && !isManager) delete patch.assignedToId;

  const row: any = await (prisma as any).humanResourcesTask.update({
    where: { id: String(id) },
    data: { ...patch, updatedBy: actor },
    include: { assignedTo: true },
  });

  if (patch.status !== undefined || patch.remark !== undefined) {
    await appendTaskLog({
      taskId: String(id),
      memberId: String(row.assignedToId ?? current.assignedToId ?? '') || null,
      kind: patch.status !== undefined ? 'status' : 'remark',
      status: patch.status ?? null,
      remark: patch.remark ?? null,
      authorName: actor,
      authorMemberId: isManager ? null : self?.selfId ?? null,
    }).catch(() => null);
  }

  await invalidateHumanResourcesCache();
  // Re-read with the assignee relation: the D1 shim ignores `include` on update.
  const full = await taskRow(String(id)).catch(() => row);
  return taskJson(full, istDateStr(), istTimeStr());
}

/** Soft-deletes a task. Employees may only delete tasks they created (origin
 *  'self') — HR-assigned work stays until an HR/MIS user removes it. */
export async function deleteDelegationTask(id: string, me: any, actor: string | null) {
  const current = await taskRow(id);
  const isManager = isHrManager(me);
  if (!isManager) {
    const self = await memberSelf(me);
    const own = String(current.origin ?? 'hr') === 'self'
      && String(current.createdByMemberId ?? '') === String(self.selfId);
    if (!own) throw new HrError('You can only remove tasks you created yourself', 403);
  }
  await (prisma as any).humanResourcesTask.update({
    where: { id: String(id) },
    data: { deleted: true, updatedBy: actor },
  });
  await invalidateHumanResourcesCache();
  return { ok: true };
}

/** Full journal for one task (self or manager). */
export async function getTaskHistory(id: string, me: any, limit = 100) {
  const task = await taskRow(id);
  const isManager = isHrManager(me);
  if (!isManager) {
    const self = await memberSelf(me);
    if (String(task.assignedToId) !== String(self.selfId)) {
      throw new HrError('You can only read tasks assigned to you', 403);
    }
  }
  const rows: any[] = await (prisma as any).humanResourcesTaskLog.findMany({
    where: { taskId: String(id) },
    orderBy: [{ createdAt: 'desc' }],
    take: Math.min(Math.max(Number(limit) || 100, 1), 300),
  });
  return {
    task: taskJson(task, istDateStr(), istTimeStr()),
    logs: rows.map((row) => ({
      id: String(row.id),
      logDate: String(row.logDate ?? ''),
      kind: row.kind === 'status' ? 'status' : 'remark',
      status: row.status ?? null,
      remark: row.remark ?? null,
      authorName: row.authorName ?? null,
      createdAt: row.createdAt ?? null,
    })),
  };
}
