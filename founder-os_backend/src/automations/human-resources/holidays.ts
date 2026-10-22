import { prisma } from '../../shared/prisma';
import { HrError } from './errors';
import { cleanHoliday } from './attendance-parse';
import { invalidateHumanResourcesCache } from './cache';

export function holidayJson(row: any) {
  return { id: String(row.id), date: row.date ?? null, name: row.name ?? '' };
}

export async function listHolidays(year?: string) {
  const rows = await prisma.humanResourcesHoliday.findMany({ orderBy: { date: 'asc' } }) as any[];
  const y = String(year ?? '').slice(0, 4);
  return rows
    .filter((r) => !y || String(r.date).startsWith(`${y}-`))
    .map(holidayJson);
}

export async function holidaySet(start: string, end: string): Promise<Set<string>> {
  const rows = await prisma.humanResourcesHoliday.findMany({
    where: { date: { gte: start, lte: end } },
  }) as any[];
  return new Set(rows.map((r) => String(r.date)));
}

export async function createHoliday(input: Record<string, any>) {
  const data = cleanHoliday(input);
  const hit: any = await prisma.humanResourcesHoliday.findFirst({ where: { date: data.date } });
  if (hit) throw new HrError('a holiday already exists on this date');
  const row: any = await prisma.humanResourcesHoliday.create({ data });
  await invalidateHumanResourcesCache();
  return holidayJson(row);
}

export async function updateHoliday(id: string, input: Record<string, any>) {
  const data = cleanHoliday(input);
  const current: any = await prisma.humanResourcesHoliday.findUnique({ where: { id } });
  if (!current) throw new HrError('holiday not found', 404);
  const hit: any = await prisma.humanResourcesHoliday.findFirst({ where: { date: data.date } });
  if (hit && String(hit.id) !== String(id)) throw new HrError('a holiday already exists on this date');
  const row: any = await prisma.humanResourcesHoliday.update({ where: { id }, data });
  await invalidateHumanResourcesCache();
  return holidayJson(row);
}

export async function deleteHoliday(id: string) {
  const row: any = await prisma.humanResourcesHoliday.findUnique({ where: { id } });
  if (!row) throw new HrError('holiday not found', 404);
  await prisma.humanResourcesHoliday.delete({ where: { id } });
  await invalidateHumanResourcesCache();
}
