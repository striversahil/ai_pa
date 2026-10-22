import { prisma } from '../../shared/prisma';
import { HrError } from './errors';
import { cleanAttendanceRows } from './attendance-parse';
import { monthRange } from './calendar';
import { holidaySet } from './holidays';
import { invalidateHumanResourcesCache } from './cache';

function memberLite(row: any) {
  return {
    id: String(row.id), name: row.name, employeeCode: row.employeeCode ?? null,
    designation: row.designation ?? null, department: row.department ?? null,
    photoUrl: row.photoUrl ?? null, active: row.active !== false,
  };
}

function attendanceJson(row: any) {
  return {
    id: String(row.id),
    memberId: String(row.memberId),
    date: row.date ?? null,
    inTime: row.inTime ?? null,
    outTime: row.outTime ?? null,
    status: row.status ?? 'present',
    notes: row.notes ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

export function hoursBetween(inTime: string | null, outTime: string | null): number {
  if (!inTime || !outTime) return 0;
  const [ih, im] = inTime.split(':').map(Number);
  const [oh, om] = outTime.split(':').map(Number);
  const mins = (oh * 60 + om) - (ih * 60 + im);
  return mins > 0 ? Math.round((mins / 60) * 100) / 100 : 0;
}

export async function listAttendance(date: string) {
  const [employees, records, leaves, holiday] = await Promise.all([
    prisma.humanResourcesMember.findMany({
      where: { deleted: false, active: true }, orderBy: { order: 'asc' },
    }) as Promise<any[]>,
    prisma.humanResourcesAttendance.findMany({ where: { date, deleted: false } }) as Promise<any[]>,
    prisma.humanResourcesLeave.findMany({ where: { deleted: false } }) as Promise<any[]>,
    prisma.humanResourcesHoliday.findFirst({ where: { date } }) as Promise<any>,
  ]);
  const recordBy = new Map(records.map((r) => [String(r.memberId), r]));
  const leaveBy = new Map<string, any>();
  for (const leave of leaves) {
    if (String(leave.startDate) <= date && String(leave.endDate) >= date) {
      leaveBy.set(String(leave.memberId), leave);
    }
  }
  const rows = employees.map((emp) => {
    const record = recordBy.get(String(emp.id));
    const leave = leaveBy.get(String(emp.id));
    return {
      member: memberLite(emp),
      attendance: record ? attendanceJson(record) : null,
      leave: leave ? {
        id: String(leave.id), leaveType: leave.leaveType, paid: leave.paid !== false,
        startDate: leave.startDate, endDate: leave.endDate, reason: leave.reason ?? null,
      } : null,
      holiday: holiday ? { id: String(holiday.id), name: holiday.name } : null,
    };
  });
  return {
    date,
    holiday: holiday ? { id: String(holiday.id), name: holiday.name } : null,
    rows,
    summary: {
      total: rows.length,
      marked: rows.filter((r) => !!r.attendance).length,
      present: rows.filter((r) => r.attendance?.status === 'present').length,
      halfDay: rows.filter((r) => r.attendance?.status === 'half_day').length,
      absent: rows.filter((r) => !r.leave && r.attendance?.status === 'absent').length,
      leave: rows.filter((r) => !!r.leave).length,
    },
  };
}

export async function saveAttendance(input: unknown, actor: string | null) {
  const rows = cleanAttendanceRows(input);
  if (!rows.length) return { saved: 0 };
  const memberIds = [...new Set(rows.map((r) => r.memberId))];
  const members = await prisma.humanResourcesMember.findMany({
    where: { id: { in: memberIds }, deleted: false },
  }) as any[];
  if (members.length !== memberIds.length) throw new HrError('one or more employees were not found');
  for (const row of rows) {
    const existing: any = await prisma.humanResourcesAttendance.findFirst({
      where: { memberId: row.memberId, date: row.date },
    });
    if (existing) {
      await prisma.humanResourcesAttendance.update({
        where: { id: existing.id },
        data: { ...row, deleted: false, updatedBy: actor },
      });
    } else {
      await prisma.humanResourcesAttendance.create({
        data: { ...row, createdBy: actor, updatedBy: actor },
      });
    }
  }
  await invalidateHumanResourcesCache();
  return { saved: rows.length };
}

export async function attendanceSummary(month: string) {
  const { start, end } = monthRange(month);
  const [employees, records, leaves, holidays] = await Promise.all([
    prisma.humanResourcesMember.findMany({
      where: { deleted: false, active: true }, orderBy: { order: 'asc' },
    }) as Promise<any[]>,
    prisma.humanResourcesAttendance.findMany({
      where: { date: { gte: start, lte: end }, deleted: false },
    }) as Promise<any[]>,
    prisma.humanResourcesLeave.findMany({ where: { deleted: false } }) as Promise<any[]>,
    prisma.humanResourcesHoliday.findMany({ where: { date: { gte: start, lte: end } } }) as Promise<any[]>,
  ]);
  const holidayDates = new Set(holidays.map((h) => String(h.date)));
  return employees.map((emp) => {
    const mine = records.filter((r) => String(r.memberId) === String(emp.id));
    const leaveDays = leaves.filter((l) => String(l.memberId) === String(emp.id)
      && String(l.endDate) >= start && String(l.startDate) <= end)
      .reduce((sum, l) => sum + Number(l.days || 0), 0);
    return {
      member: memberLite(emp),
      present: mine.filter((r) => r.status === 'present').length,
      halfDay: mine.filter((r) => r.status === 'half_day').length,
      absent: mine.filter((r) => r.status === 'absent').length,
      holiday: mine.filter((r) => r.status === 'holiday').length || holidayDates.size,
      leaveDays,
      hours: Math.round(mine.reduce((sum, r) => sum + hoursBetween(r.inTime, r.outTime), 0) * 100) / 100,
      marked: mine.length,
    };
  });
}
