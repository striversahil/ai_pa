import { prisma } from '../../shared/prisma';
import { HrError } from './errors';
import { cleanLeave } from './attendance-parse';
import { leaveWorkingDays, monthRange } from './calendar';
import { holidaySet } from './holidays';
import { invalidateHumanResourcesCache } from './cache';

export function leaveJson(row: any, holidays?: Set<string>) {
  const days = holidays
    ? leaveWorkingDays(String(row.startDate), String(row.endDate), holidays)
    : Number(row.days) || 0;
  return {
    id: String(row.id),
    memberId: String(row.memberId),
    memberName: row.member?.name ?? null,
    leaveType: row.leaveType ?? 'other',
    paid: row.paid !== false,
    startDate: row.startDate ?? null,
    endDate: row.endDate ?? null,
    days,
    reason: row.reason ?? null,
    createdAt: row.createdAt ?? null,
  };
}

export async function listLeaves(input: { month?: string; memberId?: string } = {}) {
  const where: any = { deleted: false };
  if (input.memberId) where.memberId = input.memberId;
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
  const start = filtered.reduce((min, r) => String(r.startDate) < min ? String(r.startDate) : min, String(filtered[0].startDate));
  const end = filtered.reduce((max, r) => String(r.endDate) > max ? String(r.endDate) : max, String(filtered[0].endDate));
  const holidays = await holidaySet(start, end);
  return filtered.map((r) => leaveJson({ ...r, member: byId.get(String(r.memberId)) }, holidays));
}

async function validateLeave(input: ReturnType<typeof cleanLeave>, exceptId?: string) {
  const member: any = await prisma.humanResourcesMember.findUnique({ where: { id: input.memberId } });
  if (!member || member.deleted) throw new HrError('employee not found');
  const rows = await prisma.humanResourcesLeave.findMany({
    where: { memberId: input.memberId, deleted: false },
  }) as any[];
  const overlap = rows.find((r) => String(r.id) !== String(exceptId ?? '')
    && input.startDate <= String(r.endDate) && input.endDate >= String(r.startDate));
  if (overlap) throw new HrError('this leave overlaps an existing leave');
  const holidays = await holidaySet(input.startDate, input.endDate);
  const days = leaveWorkingDays(input.startDate, input.endDate, holidays);
  if (days <= 0) throw new HrError('leave has no working days (only weekly offs/holidays)');
  return days;
}

export async function createLeave(input: Record<string, any>, actor: string | null) {
  const data = cleanLeave(input);
  const days = await validateLeave(data);
  const row: any = await prisma.humanResourcesLeave.create({
    data: { ...data, days, createdBy: actor, updatedBy: actor },
  });
  await invalidateHumanResourcesCache();
  return leaveJson(row);
}

export async function updateLeave(id: string, input: Record<string, any>, actor: string | null) {
  const current: any = await prisma.humanResourcesLeave.findUnique({ where: { id } });
  if (!current || current.deleted) throw new HrError('leave not found', 404);
  const data = cleanLeave(input);
  const days = await validateLeave(data, id);
  const row: any = await prisma.humanResourcesLeave.update({
    where: { id }, data: { ...data, days, updatedBy: actor },
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
