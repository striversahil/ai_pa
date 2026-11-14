// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.
import type { HrSelf, HrScope } from "../types";
import { prisma } from "../../../shared/prisma";
import { istTimeStr, taskSort, isValidDate, istDateStr, normalizeMonth, istMonthStr, cleanMemberCreate, cleanMemberPatch, cleanTaskCreate, cleanTaskPatch, cleanExpenseCreate, cleanExpensePatch, cleanFundTxnCreate, cleanFundTxnPatch } from "../parse";
import { getInventorySnapshot } from "../inventory";
import { taskJson } from "../task-json";
import { cached } from "../../../shared/cache";
import { DATA_CACHE_PREFIX, DATA_TTL_MS, invalidateHumanResourcesCache } from "../cache";
import { createWithEmployeeCode } from "../employee-codes";
import { mirrorRosterRow } from "../../../modules/core/sync";
import { HrError } from "../errors";
import { appendTaskLog, completedInWindow } from "../task-logs";
import { reopenRequiresReason } from "../delegation-parse";
import { normId, emailTokens, expenseJson, fundTxnJson, splitTaskBuckets } from "./pure";

export async function resolveSelfHumanResourcesMember(
  asId: unknown,
  me: { user?: { email?: string | null; name?: string | null } } | null,
): Promise<HrSelf | null> {
  const roster = (await prisma.humanResourcesMember.findMany({
    where: { deleted: false }, orderBy: { order: 'asc' },
  })) as any[];
  if (asId) {
    const hit = roster.find((r) => String(r.id) === String(asId));
    if (hit) {
      return {
        selfId: String(hit.id), selfName: String(hit.name),
        designation: hit.designation ?? null, matchedBy: 'as',
      };
    }
  }
  if (!me) return null;
  const email = normId(me.user?.email);
  if (email) {
    // 1. Explicit login email wins (may differ from the contact email).
    const loginHits = roster.filter((r) => emailTokens(r.loginEmail).includes(email));
    if (loginHits.length === 1) {
      const h = loginHits[0];
      return {
        selfId: String(h.id), selfName: String(h.name),
        designation: h.designation ?? null, matchedBy: 'loginEmail',
      };
    }
    // 2. Contact email (a cell may hold several addresses).
    const mailHits = roster.filter((r) => emailTokens(r.email).includes(email));
    if (mailHits.length === 1) {
      const h = mailHits[0];
      return {
        selfId: String(h.id), selfName: String(h.name),
        designation: h.designation ?? null, matchedBy: 'email',
      };
    }
  }
  const name = normId(me.user?.name);
  if (name.length >= 3) {
    const hits = roster.filter((r) => {
      const rn = normId(r.name);
      return rn && (rn === name || rn.startsWith(name) || name.startsWith(rn));
    });
    if (hits.length === 1) {
      const h = hits[0];
      return {
        selfId: String(h.id), selfName: String(h.name),
        designation: h.designation ?? null, matchedBy: 'name',
      };
    }
  }
  return null;
}

export async function computeDashboard(today: string, month: string, scope: HrScope | null) {
  const nowTime = istTimeStr();
  const isAdmin = !scope || scope.isAdmin;
  const self = scope?.scope ?? null;
  const [rosterRaw, taskRaw, expenseRaw, fundRaw, lifetimeOfficeRaw, inventory] = await Promise.all([
    prisma.humanResourcesMember.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } }) as Promise<any[]>,
    prisma.humanResourcesTask.findMany({
      where: { deleted: false },
      include: { assignedTo: true },
      orderBy: [{ dueDate: 'asc' }, { dueTime: 'asc' }],
      take: 1000,
    }).catch(() => []) as Promise<any[]>,
    prisma.humanResourcesExpense.findMany({
      where: { deleted: false, expenseMonth: month },
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
    }).catch(() => []) as Promise<any[]>,
    // Lifetime funding ledger (never month-scoped — funding isn't monthly).
    prisma.humanResourcesFundTxn.findMany({
      where: { deleted: false },
      orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
    }).catch(() => []) as Promise<any[]>,
    // Lifetime office spend: fixed + variable only; field_staff never touches the balance.
    prisma.humanResourcesExpense.findMany({
      where: { deleted: false, expenseType: { in: ['fixed', 'variable'] } },
      take: 5000,
    }).catch(() => []) as Promise<any[]>,
    getInventorySnapshot(month).catch(() => ({ month, items: [], summary: { itemCount: 0, lowStockCount: 0, outOfStockCount: 0, movementCount: 0, stockValue: 0 } })),
  ]);

  const visibleTasks = taskRaw
    .filter((t) => isAdmin || (!!self && String(t.assignedToId) === String(self.selfId)))
    .map((t) => taskJson(t, today, nowTime))
    .sort(taskSort);

  // "Completed · last 30 days" keys on the completion day, never dueDate.
  const doneWindow = await completedInWindow(visibleTasks, today);
  const windowedTasks = visibleTasks.filter(
    (t) => t.status !== 'done' || doneWindow.has(String(t.id)),
  );
  const { overdue, today: dueToday, upcoming, completed } = splitTaskBuckets(
    windowedTasks, today, (id) => doneWindow.get(id)?.at ?? '',
  );

  const fixed = expenseRaw.filter((e) => e.expenseType === 'fixed').map(expenseJson);
  const variable = expenseRaw.filter((e) => e.expenseType === 'variable').map(expenseJson);
  const fieldStaff = expenseRaw.filter((e) => e.expenseType === 'field_staff').map(expenseJson);
  const fixedTotal = fixed.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const variableTotal = variable.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const fieldStaffTotal = fieldStaff.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  // Office balance (lifetime): all funding received minus all fixed+variable
  // spend. Derived, never stored — editing either side corrects it.
  const topups = fundRaw.map(fundTxnJson);
  const topupTotal = topups.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const officeTotal = lifetimeOfficeRaw.reduce((sum, e) => sum + (Number(e?.amount) || 0), 0);

  const roster = rosterRaw
    .filter((r) => r.active !== false)
    .map((r) => ({
      id: String(r.id),
      name: r.name,
      designation: r.designation ?? null,
      department: r.department ?? null,
      employeeCode: r.employeeCode ?? null,
      photoUrl: r.photoUrl ?? null,
      order: r.order ?? 0,
      ...(isAdmin ? { email: r.email ?? null, phone: r.phone ?? null } : {}),
    }));

  return {
    meta: {
      today,
      month,
      self,
      isAdmin,
      canManage: isAdmin,
      unmatched: !isAdmin && !self,
      counts: {
        overdue: overdue.length,
        today: dueToday.length,
        upcoming: upcoming.length,
        open: overdue.length + dueToday.length + upcoming.length,
        completed: completed.length,
      },
    },
    roster,
    employees: {
      activeCount: rosterRaw.filter((r) => r.active !== false).length,
      inactiveCount: rosterRaw.filter((r) => r.active === false).length,
      totalCount: rosterRaw.length,
    },
    tasks: { overdue, today: dueToday, upcoming, completed },
    expenses: {
      month,
      fixed,
      variable,
      fieldStaff,
      summary: {
        fixedTotal: Math.round(fixedTotal * 100) / 100,
        variableTotal: Math.round(variableTotal * 100) / 100,
        fieldStaffTotal: Math.round(fieldStaffTotal * 100) / 100,
        total: Math.round((fixedTotal + variableTotal + fieldStaffTotal) * 100) / 100,
        fixedCount: fixed.length,
        variableCount: variable.length,
        fieldStaffCount: fieldStaff.length,
      },
    },
    fund: {
      topups,
      summary: {
        topupTotal: Math.round(topupTotal * 100) / 100,
        officeTotal: Math.round(officeTotal * 100) / 100,
        balance: Math.round((topupTotal - officeTotal) * 100) / 100,
        topupCount: topups.length,
      },
    },
    inventory,
  };
}

export async function getHumanResourcesDashboardData(query: Record<string, any> = {}) {
  const today = isValidDate(query.date) ? String(query.date).slice(0, 10) : istDateStr();
  const month = normalizeMonth(query.month, istMonthStr());
  const scope = (query.scope ?? null) as HrScope | null;
  const scopeKey = !scope || scope.isAdmin ? 'all' : scope.scope ? `self:${scope.scope.selfId}` : 'unmatched';
  return cached(
    `${DATA_CACHE_PREFIX}${month}:${today}:${scopeKey}`,
    DATA_TTL_MS,
    () => computeDashboard(today, month, scope),
  );
}

export async function listMembers(includeDeleted = false) {
  return prisma.humanResourcesMember.findMany({
    where: includeDeleted ? {} : { deleted: false },
    orderBy: { order: 'asc' },
  });
}

export async function createMember(input: Record<string, any>) {
  const data = cleanMemberCreate(input);
  const row = await createWithEmployeeCode((employeeCode) =>
    prisma.humanResourcesMember.create({ data: { ...data, employeeCode } }),
  );
  await invalidateHumanResourcesCache();
  await mirrorRosterRow('human_resources_member', row);
  return row;
}

export async function updateMember(id: string, input: Record<string, any>) {
  const patch = cleanMemberPatch(input);
  const current: any = await prisma.humanResourcesMember.findUnique({ where: { id } });
  if (!current || current.deleted) throw new HrError('member not found', 404);
  const row = await prisma.humanResourcesMember.update({ where: { id }, data: patch });
  await invalidateHumanResourcesCache();
  await mirrorRosterRow('human_resources_member', row);
  return row;
}

export async function ensureAssignableMember(id: string | null) {
  if (!id) throw new HrError('assignedToId is required');
  const member: any = await prisma.humanResourcesMember.findUnique({ where: { id } });
  if (!member || member.deleted) throw new HrError('assigned member not found');
  return member;
}

export async function createTask(input: Record<string, any>, actor: string | null) {
  const data = cleanTaskCreate(input);
  const member = await ensureAssignableMember(data.assignedToId);
  const row = await prisma.humanResourcesTask.create({
    data: { ...data, assignedToId: String(member.id), createdBy: actor, updatedBy: actor },
  });
  await invalidateHumanResourcesCache();
  return row;
}

export async function updateTask(
  id: string,
  input: Record<string, any>,
  actor: string | null,
  access: { canManage: boolean; selfId: string | null },
) {
  const current: any = await prisma.humanResourcesTask.findUnique({ where: { id } });
  if (!current || current.deleted) throw new HrError('task not found', 404);

  if (!access.canManage) {
    if (!access.selfId || String(current.assignedToId) !== String(access.selfId)) {
      throw new HrError('You can only update tasks assigned to you', 403);
    }
    const extra = Object.keys(input).filter((k) => k !== 'status' && k !== 'remark');
    if (extra.length) throw new HrError('Only status and remark can be changed by HR users', 403);
  }

  const patch = cleanTaskPatch(input);
  if (reopenRequiresReason(current.status, patch)) {
    throw new HrError('A reason is required to reopen a completed task', 400);
  }
  if (patch.assignedToId !== undefined) {
    if (patch.assignedToId) await ensureAssignableMember(patch.assignedToId);
  }
  const row = await prisma.humanResourcesTask.update({
    where: { id },
    data: { ...patch, updatedBy: actor },
  });
  // Journal the change so the employee timeline and HR's daily activity feed
  // see updates made from the HR dashboard too (single history, one writer).
  if (patch.status !== undefined || patch.remark !== undefined) {
    await appendTaskLog({
      taskId: String(id),
      memberId: String(patch.assignedToId ?? current.assignedToId ?? '') || null,
      kind: patch.status !== undefined ? 'status' : 'remark',
      status: patch.status ?? null,
      remark: patch.remark ?? null,
      authorName: actor,
    }).catch(() => null);
  }
  await invalidateHumanResourcesCache();
  return row;
}

export async function deleteTask(id: string, actor: string | null) {
  const current: any = await prisma.humanResourcesTask.findUnique({ where: { id } });
  if (!current || current.deleted) throw new HrError('task not found', 404);
  await prisma.humanResourcesTask.update({
    where: { id }, data: { deleted: true, updatedBy: actor },
  });
  await invalidateHumanResourcesCache();
}

export async function createExpense(input: Record<string, any>, actor: string | null) {
  const data = cleanExpenseCreate(input);
  const row = await prisma.humanResourcesExpense.create({
    data: { ...data, createdBy: actor, updatedBy: actor },
  });
  await invalidateHumanResourcesCache();
  return row;
}

export async function updateExpense(
  id: string,
  input: Record<string, any>,
  actor: string | null,
  access: { canManage: boolean },
) {
  const current: any = await prisma.humanResourcesExpense.findUnique({ where: { id } });
  if (!current || current.deleted) throw new HrError('expense not found', 404);
  if (!access.canManage && String(current.createdBy || '') !== String(actor || '')) {
    throw new HrError('You can only edit expenses you created', 403);
  }
  const patch = cleanExpensePatch(input);
  const row = await prisma.humanResourcesExpense.update({
    where: { id }, data: { ...patch, updatedBy: actor },
  });
  await invalidateHumanResourcesCache();
  return row;
}

export async function deleteExpense(
  id: string,
  actor: string | null,
  access: { canManage: boolean },
) {
  const current: any = await prisma.humanResourcesExpense.findUnique({ where: { id } });
  if (!current || current.deleted) throw new HrError('expense not found', 404);
  if (!access.canManage && String(current.createdBy || '') !== String(actor || '')) {
    throw new HrError('You can only delete expenses you created', 403);
  }
  await prisma.humanResourcesExpense.update({
    where: { id }, data: { deleted: true, updatedBy: actor },
  });
  await invalidateHumanResourcesCache();
}

export async function createFundTxn(input: Record<string, any>, actor: string | null) {
  const data = cleanFundTxnCreate(input);
  const row = await prisma.humanResourcesFundTxn.create({
    data: { ...data, createdBy: actor, updatedBy: actor },
  });
  await invalidateHumanResourcesCache();
  return fundTxnJson(row);
}

export async function updateFundTxn(
  id: string,
  input: Record<string, any>,
  actor: string | null,
  access: { canManage: boolean },
) {
  const current: any = await prisma.humanResourcesFundTxn.findUnique({ where: { id } });
  if (!current || current.deleted) throw new HrError('funding entry not found', 404);
  if (!access.canManage && String(current.createdBy || '') !== String(actor || '')) {
    throw new HrError('You can only edit funding you recorded', 403);
  }
  const patch = cleanFundTxnPatch(input);
  const row = await prisma.humanResourcesFundTxn.update({
    where: { id }, data: { ...patch, updatedBy: actor },
  });
  await invalidateHumanResourcesCache();
  return fundTxnJson(row);
}

export async function deleteFundTxn(
  id: string,
  actor: string | null,
  access: { canManage: boolean },
) {
  const current: any = await prisma.humanResourcesFundTxn.findUnique({ where: { id } });
  if (!current || current.deleted) throw new HrError('funding entry not found', 404);
  if (!access.canManage && String(current.createdBy || '') !== String(actor || '')) {
    throw new HrError('You can only delete funding you recorded', 403);
  }
  await prisma.humanResourcesFundTxn.update({
    where: { id }, data: { deleted: true, updatedBy: actor },
  });
  await invalidateHumanResourcesCache();
}
