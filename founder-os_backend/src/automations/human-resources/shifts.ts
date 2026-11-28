// shifts.ts — HR shift store (Worker + D1 shim). Pure cleaning/derivation
// lives in shifts-parse.ts so the guard suite can bundle it without a DB.
import { prisma } from '../../shared/prisma';
import { HrError } from './errors';
import { cleanShift, cleanShiftPatch, pickShift } from './shifts-parse';
import { invalidateHumanResourcesCache } from './cache';

export function shiftJson(row: any) {
  return {
    id: String(row.id),
    name: row.name ?? '',
    employmentType: row.employmentType ?? null,
    startTime: row.startTime ?? '',
    endTime: row.endTime ?? '',
    graceMinutes: Number(row.graceMinutes ?? 10),
    active: row.active !== false,
    order: Number(row.order) || 0,
  };
}

export async function listShifts() {
  const rows = await prisma.humanResourcesShift.findMany({ orderBy: { order: 'asc' } }) as any[];
  return rows.map(shiftJson);
}

async function duplicateName(name: string, exceptId?: string): Promise<boolean> {
  const rows = await prisma.humanResourcesShift.findMany({}) as any[];
  const key = name.trim().toLowerCase();
  return rows.some((row) => String(row.name ?? '').trim().toLowerCase() === key
    && (!exceptId || String(row.id) !== String(exceptId)));
}

export async function createShift(input: Record<string, any>) {
  const data = cleanShift(input);
  if (await duplicateName(data.name)) throw new HrError('a shift with this name already exists');
  const row: any = await prisma.humanResourcesShift.create({ data });
  await invalidateHumanResourcesCache();
  return shiftJson(row);
}

export async function updateShift(id: string, input: Record<string, any>) {
  const current: any = await prisma.humanResourcesShift.findUnique({ where: { id } });
  if (!current) throw new HrError('shift not found', 404);
  const data = cleanShiftPatch(input);
  if (data.name && await duplicateName(data.name, id)) {
    throw new HrError('a shift with this name already exists');
  }
  const row: any = await prisma.humanResourcesShift.update({ where: { id }, data });
  await invalidateHumanResourcesCache();
  return shiftJson(row);
}

export async function deleteShift(id: string) {
  const row: any = await prisma.humanResourcesShift.findUnique({ where: { id } });
  if (!row) throw new HrError('shift not found', 404);
  const assigned = Number(await prisma.humanResourcesMember.count({
    where: { shiftId: id, deleted: false },
  }));
  if (assigned > 0) {
    throw new HrError(`${assigned} employee${assigned === 1 ? ' is' : 's are'} on this shift — assign them another shift first`, 409);
  }
  await prisma.humanResourcesShift.delete({ where: { id } });
  await invalidateHumanResourcesCache();
}

/** Validate a member's shiftId before saving the employee master row. */
export async function assertShift(shiftId: string | null) {
  if (!shiftId) return null;
  const row: any = await prisma.humanResourcesShift.findUnique({ where: { id: shiftId } });
  if (!row) throw new HrError('shift not found', 404);
  return shiftJson(row);
}

/** The shift that actually applies to an employee: their own shift, else the
 *  employment-type default, else the company default. */
export function effectiveShift(member: any, shifts: any[]): any | null {
  const own = member?.shiftId
    ? (shifts || []).find((row) => String(row.id) === String(member.shiftId))
    : null;
  return own ?? pickShift(shifts, member?.employmentType ?? null);
}
