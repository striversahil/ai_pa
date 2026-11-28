import { prisma } from '../../shared/prisma';
import { HrError } from './errors';
import { cleanAttendanceRows } from './attendance-parse';
import { monthRange } from './calendar';
import { invalidateHumanResourcesCache } from './cache';
import { employeeDisplayName } from '../../shared/employee-name';
import { deriveAttendanceStatus, earlyMinutes, lateMinutes, shiftWindow } from './shifts-parse';
import { effectiveShift, shiftJson } from './shifts';
import type { AttendanceStatus } from './types';

function memberLite(row: any) {
  return {
    id: String(row.id), name: row.name, displayName: employeeDisplayName(row),
    employeeCode: row.employeeCode ?? null,
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

const PRESENT_STATUSES = ['present', 'late', 'short_leave'];

export async function listAttendance(date: string) {
  const [employees, records, leaves, holiday, shifts] = await Promise.all([
    prisma.humanResourcesMember.findMany({
      where: { deleted: false, active: true }, orderBy: { order: 'asc' },
    }) as Promise<any[]>,
    prisma.humanResourcesAttendance.findMany({ where: { date, deleted: false } }) as Promise<any[]>,
    // Only APPROVED leave auto-marks the day — a pending application must never
    // look like leave (migration 0153).
    prisma.humanResourcesLeave.findMany({ where: { deleted: false, status: 'approved' } }) as Promise<any[]>,
    prisma.humanResourcesHoliday.findFirst({ where: { date } }) as Promise<any>,
    prisma.humanResourcesShift.findMany({ orderBy: { order: 'asc' } }) as Promise<any[]>,
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
    const shift = effectiveShift(emp, shifts);
    const late = record ? lateMinutes(record.inTime, shift) : null;
    const early = record ? earlyMinutes(record.outTime, shift) : null;
    const status = record ? String(record.status ?? 'present') as AttendanceStatus : null;
    return {
      member: memberLite(emp),
      // The window the employee is expected in (their own shift, else the
      // employment-type default, else the company default).
      shift: shift ? shiftJson(shift) : null,
      attendance: record ? {
        ...attendanceJson(record),
        lateMinutes: late,
        earlyMinutes: early,
        // 'present' past the grace window is shown (and stored) as 'late'.
        effectiveStatus: status ? deriveAttendanceStatus(status, late) : null,
      } : null,
      leave: leave ? {
        id: String(leave.id), leaveType: leave.leaveType, paid: leave.paid !== false,
        startDate: leave.startDate, endDate: leave.endDate, reason: leave.reason ?? null,
        durationType: leave.durationType ?? 'full_day',
        fromTime: leave.fromTime ?? null, toTime: leave.toTime ?? null,
      } : null,
      holiday: holiday ? { id: String(holiday.id), name: holiday.name } : null,
    };
  });
  const statusOf = (row: any) => String(row.attendance?.effectiveStatus ?? row.attendance?.status ?? '');
  return {
    date,
    holiday: holiday ? { id: String(holiday.id), name: holiday.name } : null,
    rows,
    summary: {
      total: rows.length,
      marked: rows.filter((r) => !!r.attendance).length,
      present: rows.filter((r) => PRESENT_STATUSES.includes(statusOf(r))).length,
      late: rows.filter((r) => statusOf(r) === 'late').length,
      halfDay: rows.filter((r) => statusOf(r) === 'half_day').length,
      shortLeave: rows.filter((r) => statusOf(r) === 'short_leave').length,
      absent: rows.filter((r) => !r.leave && statusOf(r) === 'absent').length,
      leave: rows.filter((r) => !!r.leave).length,
      holiday: holiday ? 1 : 0,
    },
  };
}

export async function saveAttendance(input: unknown, actor: string | null) {
  const warnings: string[] = [];
  // 'holiday' was retired as an attendance status (migration 0186). A stale
  // screen that still posts it is skipped with a warning, never saved.
  const raw = (Array.isArray(input) ? input : []).filter((row) => {
    const status = String((row as any)?.status ?? '');
    if (status !== 'holiday') return true;
    warnings.push('Holiday is decided in the holiday calendar — the holiday attendance row was skipped');
    return false;
  });
  const rows = cleanAttendanceRows(raw);
  if (!rows.length) return { saved: 0, warnings };
  const memberIds = [...new Set(rows.map((r) => r.memberId))];
  const [members, shifts] = await Promise.all([
    prisma.humanResourcesMember.findMany({
      where: { id: { in: memberIds }, deleted: false },
    }) as Promise<any[]>,
    prisma.humanResourcesShift.findMany({ orderBy: { order: 'asc' } }) as Promise<any[]>,
  ]);
  if (members.length !== memberIds.length) throw new HrError('one or more employees were not found');
  const memberBy = new Map(members.map((row) => [String(row.id), row]));
  for (const row of rows) {
    // Auto-mark late: a 'present' check-in after the shift start + grace is
    // stored as 'late', so payroll and the monthly summary see the same fact.
    const member = memberBy.get(String(row.memberId));
    const shift = effectiveShift(member, shifts);
    const window = shiftWindow(shift);
    if (window && !window.overnight && row.inTime && row.outTime && row.outTime <= row.inTime) {
      throw new HrError(`${member?.name ?? 'employee'}: outTime must be after inTime for this shift`);
    }
    const status = deriveAttendanceStatus(row.status, lateMinutes(row.inTime, shift));
    const existing: any = await prisma.humanResourcesAttendance.findFirst({
      where: { memberId: row.memberId, date: row.date },
    });
    if (existing) {
      await prisma.humanResourcesAttendance.update({
        where: { id: existing.id },
        data: { ...row, status, deleted: false, updatedBy: actor },
      });
    } else {
      await prisma.humanResourcesAttendance.create({
        data: { ...row, status, createdBy: actor, updatedBy: actor },
      });
    }
  }
  await invalidateHumanResourcesCache();
  return { saved: rows.length, warnings };
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
    prisma.humanResourcesLeave.findMany({ where: { deleted: false, status: 'approved' } }) as Promise<any[]>,
    prisma.humanResourcesHoliday.findMany({ where: { date: { gte: start, lte: end } } }) as Promise<any[]>,
  ]);
  const holidayDates = new Set(holidays.map((h) => String(h.date)));
  return employees.map((emp) => {
    const mine = records.filter((r) => String(r.memberId) === String(emp.id));
    const leaveDays = leaves.filter((l) => String(l.memberId) === String(emp.id)
      && String(l.endDate) >= start && String(l.startDate) <= end)
      .reduce((sum, l) => sum + Number(l.days || 0), 0);
    const count = (statuses: string[]) => mine.filter((r) => statuses.includes(String(r.status))).length;
    return {
      member: memberLite(emp),
      present: count(PRESENT_STATUSES),
      late: count(['late']),
      halfDay: count(['half_day']),
      shortLeave: count(['short_leave']),
      absent: count(['absent']),
      // Holiday days are calendar facts, never attendance rows.
      holiday: holidayDates.size,
      leaveDays,
      hours: Math.round(mine.reduce((sum, r) => sum + hoursBetween(r.inTime, r.outTime), 0) * 100) / 100,
      marked: mine.length,
    };
  });
}
