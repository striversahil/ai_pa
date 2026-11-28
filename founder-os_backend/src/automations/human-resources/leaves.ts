import { prisma } from '../../shared/prisma';
import { HrError } from './errors';
import { cleanLeave } from './attendance-parse';
import { leaveWorkingDays, monthRange } from './calendar';
import { holidaySet } from './holidays';
import { invalidateHumanResourcesCache } from './cache';
import { dateRangesOverlap, leaveDaysFor } from './leave-requests-parse';
import { allocatePaidDays } from './policy';
import { displayNameForLabel, employeeDisplayName, type DisplayNameIndex } from '../../shared/employee-name';
import { loadDisplayNameIndex } from '../../shared/employee-name-store';

export function leaveJson(row: any, holidays?: Set<string>, names?: DisplayNameIndex) {
  const durationType = row.durationType ?? 'full_day';
  const days = holidays
    ? leaveDaysFor(durationType, leaveWorkingDays(String(row.startDate), String(row.endDate), holidays))
    : Number(row.days) || 0;
  return {
    id: String(row.id),
    memberId: String(row.memberId),
    memberName: row.member ? employeeDisplayName(row.member) : null,
    leaveType: row.leaveType ?? 'other',
    paid: row.paid !== false,
    paidDays: row.paidDays === null || row.paidDays === undefined ? null : Number(row.paidDays),
    startDate: row.startDate ?? null,
    endDate: row.endDate ?? null,
    days,
    reason: row.reason ?? null,
    // Employee application lifecycle (migration 0153). HR-recorded rows are
    // created already approved, so older views keep their meaning.
    status: row.status ?? 'approved',
    durationType,
    requestedBy: names && row.requestedBy ? displayNameForLabel(names, row.requestedBy) : (row.requestedBy ?? null),
    fromTime: row.fromTime ?? null,
    toTime: row.toTime ?? null,
    decidedBy: names && row.decidedBy ? displayNameForLabel(names, row.decidedBy) : (row.decidedBy ?? null),
    decidedAt: row.decidedAt ?? null,
    decisionNote: row.decisionNote ?? null,
    updatedAt: row.updatedAt ?? null,
    createdAt: row.createdAt ?? null,
  };
}

export async function listLeaves(
  input: { month?: string; memberId?: string; status?: string } = {},
) {
  const where: any = { deleted: false };
  if (input.memberId) where.memberId = input.memberId;
  if (input.status && input.status !== 'all') where.status = input.status;
  const rows = await prisma.humanResourcesLeave.findMany({
    where, orderBy: [{ startDate: 'desc' }],
  }) as any[];
  const month = String(input.month ?? '').slice(0, 7);
  const filtered = month
    ? rows.filter((r) => String(r.endDate) >= `${month}-01` && String(r.startDate) <= monthRange(month).end)
    : rows;
  if (!filtered.length) return [];
  const memberIds = [...new Set(filtered.map((r) => String(r.memberId)))];
  const members = await prisma.humanResourcesMember.findMany({ where: { id: { in: memberIds } } }) as any[];
  const byId = new Map(members.map((m) => [String(m.id), m]));
  const names = await loadDisplayNameIndex();
  const start = filtered.reduce((min, r) => String(r.startDate) < min ? String(r.startDate) : min, String(filtered[0].startDate));
  const end = filtered.reduce((max, r) => String(r.endDate) > max ? String(r.endDate) : max, String(filtered[0].endDate));
  const holidays = await holidaySet(start, end);
  return filtered.map((r) => leaveJson({ ...r, member: byId.get(String(r.memberId)) }, holidays, names));
}

/** Overlap + working-day validation shared by HR recording and employee
 *  applications. Rejected rows never block a new request. */
export async function validateLeave(
  input: { memberId: string; startDate: string; endDate: string; durationType: string },
  exceptId?: string,
): Promise<number> {
  const member: any = await prisma.humanResourcesMember.findUnique({ where: { id: input.memberId } });
  if (!member || member.deleted) throw new HrError('employee not found');
  const rows = await prisma.humanResourcesLeave.findMany({
    where: { memberId: input.memberId, deleted: false },
  }) as any[];
  const overlap = rows.find((r) => String(r.id) !== String(exceptId ?? '')
    && String(r.status ?? 'approved') !== 'rejected'
    && dateRangesOverlap(input, r));
  if (overlap) {
    throw new HrError(String(overlap.status ?? 'approved') === 'pending'
      ? 'a leave request for these dates is already awaiting an HR decision'
      : 'this employee already has leave approved on these dates');
  }
  const holidays = await holidaySet(input.startDate, input.endDate);
  const workingDays = leaveWorkingDays(input.startDate, input.endDate, holidays);
  if (workingDays <= 0 && input.durationType !== 'short') {
    throw new HrError('leave has no working days (only weekly offs/holidays)');
  }
  return leaveDaysFor(input.durationType, workingDays);
}

/** HR records leave directly: it is approved on the spot, exactly like before
 *  migration 0153 (status default kept for old clients). */
export async function createLeave(input: Record<string, any>, actor: string | null) {
  const data = cleanLeave(input);
  const days = await validateLeave(data);
  const member: any = await prisma.humanResourcesMember.findUnique({ where: { id: data.memberId } });
  const paidDays = await allocatePaidDays({
    ...data, days, employmentType: member?.employmentType ?? null,
  });
  const row: any = await prisma.humanResourcesLeave.create({
    data: {
      ...data,
      days,
      paidDays,
      status: 'approved',
      decidedBy: actor,
      decidedAt: new Date(),
      createdBy: actor,
      updatedBy: actor,
    },
  });
  await invalidateHumanResourcesCache();
  return leaveJson(row);
}

export async function updateLeave(id: string, input: Record<string, any>, actor: string | null) {
  const current: any = await prisma.humanResourcesLeave.findUnique({ where: { id } });
  if (!current || current.deleted) throw new HrError('leave not found', 404);
  const data = cleanLeave(input);
  const days = await validateLeave(data, id);
  const member: any = await prisma.humanResourcesMember.findUnique({ where: { id: data.memberId } });
  const paidDays = await allocatePaidDays({
    ...data, days, employmentType: member?.employmentType ?? null, exceptId: id,
  });
  const row: any = await prisma.humanResourcesLeave.update({
    where: { id }, data: { ...data, days, paidDays, updatedBy: actor },
  });
  await invalidateHumanResourcesCache();
  return leaveJson(row);
}

export async function deleteLeave(id: string, actor: string | null) {
  const current: any = await prisma.humanResourcesLeave.findUnique({ where: { id } });
  if (!current || current.deleted) throw new HrError('leave not found', 404);
  await prisma.humanResourcesLeave.update({ where: { id }, data: { deleted: true, updatedBy: actor } });
  await invalidateHumanResourcesCache();
}
