import { prisma } from '../../shared/prisma';
import { HrError } from './errors';
import { cleanHoliday, holidayDatesIn, holidayLabel } from './holidays-parse';
import { invalidateHumanResourcesCache } from './cache';

export function holidayJson(row: any) {
  return {
    id: String(row.id),
    kind: String(row.kind ?? 'single'),
    date: row.date ?? null,
    startDate: row.startDate ?? row.date ?? null,
    endDate: row.endDate ?? row.date ?? null,
    weekday: row.weekday == null ? null : Number(row.weekday),
    label: holidayLabel(row),
    name: row.name ?? '',
  };
}

function yearWindow(year?: string): { start: string; end: string } | null {
  const y = String(year ?? '').slice(0, 4);
  if (!/^\d{4}$/.test(y)) return null;
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

export async function listHolidays(year?: string) {
  const rows = await prisma.humanResourcesHoliday.findMany({ orderBy: { startDate: 'asc' } }) as any[];
  const window = yearWindow(year);
  return rows
    .filter((r) => {
      if (!window) return true;
      const from = String(r.startDate ?? r.date ?? '');
      const to = String(r.endDate ?? r.date ?? '');
      return from && to && from <= window.end && to >= window.start;
    })
    .map(holidayJson);
}

/** Every holiday date inside [start, end]; ranges and weekday rules expand
 *  here, so payroll/attendance/leave all see the same calendar. */
export async function holidaySet(start: string, end: string): Promise<Set<string>> {
  const rows = await prisma.humanResourcesHoliday.findMany({
    where: { startDate: { lte: end }, endDate: { gte: start } },
  }) as any[];
  return holidayDatesIn(rows, start, end);
}

/** The holiday rule covering one date (single, range or weekday), if any. */
export async function holidayRuleFor(date: string) {
  const rows = await prisma.humanResourcesHoliday.findMany({
    where: { startDate: { lte: date }, endDate: { gte: date } },
    orderBy: { startDate: 'asc' },
  }) as any[];
  const hit = rows.find((row) => holidayDatesIn([row], date, date).size > 0);
  return hit ? holidayJson(hit) : null;
}

function sameRule(a: any, data: any): boolean {
  if (String(a.kind ?? 'single') !== data.kind) return false;
  if (data.kind === 'single') return String(a.date ?? '') === String(data.date);
  if (data.kind === 'range') {
    return String(a.startDate ?? '') === data.startDate && String(a.endDate ?? '') === data.endDate;
  }
  return Number(a.weekday) === Number(data.weekday)
    && String(a.startDate ?? '') === data.startDate
    && String(a.endDate ?? '') === data.endDate;
}

async function assertUnique(data: any, id?: string) {
  const rows = await prisma.humanResourcesHoliday.findMany({}) as any[];
  const hit = rows.find((r) => String(r.id) !== String(id ?? '') && sameRule(r, data));
  if (!hit) return;
  if (data.kind === 'single') throw new HrError('a holiday already exists on this date');
  if (data.kind === 'range') throw new HrError('this holiday range is already defined');
  throw new HrError('this weekday rule is already defined for that window');
}

export async function createHoliday(input: Record<string, any>) {
  const data = cleanHoliday(input);
  await assertUnique(data);
  const row: any = await prisma.humanResourcesHoliday.create({ data });
  await invalidateHumanResourcesCache();
  return holidayJson(row);
}

export async function updateHoliday(id: string, input: Record<string, any>) {
  const data = cleanHoliday(input);
  const current: any = await prisma.humanResourcesHoliday.findUnique({ where: { id } });
  if (!current) throw new HrError('holiday not found', 404);
  await assertUnique(data, id);
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
