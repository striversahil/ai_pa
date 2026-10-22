import { HrError } from './errors';
import {
  isValidDate, normalizeTime, nullableText, text,
} from './parse';
import {
  ATTENDANCE_STATUSES, LEAVE_TYPES,
  type AttendanceRowInput, type HolidayInput, type LeaveInput,
} from './types';

export function cleanAttendanceRow(raw: Record<string, any>): AttendanceRowInput {
  const memberId = text(raw.memberId, 100);
  if (!memberId) throw new HrError('memberId is required');
  const date = String(raw.date ?? '').slice(0, 10);
  if (!isValidDate(date)) throw new HrError('date must be YYYY-MM-DD');
  const status = (ATTENDANCE_STATUSES as readonly string[]).includes(String(raw.status))
    ? String(raw.status) as AttendanceRowInput['status']
    : 'present';
  const inTime = normalizeTime(raw.inTime);
  const outTime = normalizeTime(raw.outTime);
  if (inTime && outTime && outTime <= inTime) throw new HrError('outTime must be after inTime');
  return {
    memberId,
    date,
    inTime,
    outTime,
    status,
    notes: nullableText(raw.notes, 1000),
  };
}

export function cleanAttendanceRows(input: unknown): AttendanceRowInput[] {
  if (!Array.isArray(input)) throw new HrError('rows must be an array');
  if (input.length > 500) throw new HrError('too many attendance rows');
  return input.map((row) => cleanAttendanceRow(row || {}));
}

export function cleanLeave(raw: Record<string, any>): LeaveInput {
  const memberId = text(raw.memberId, 100);
  if (!memberId) throw new HrError('memberId is required');
  const leaveType = LEAVE_TYPES.includes(raw.leaveType) ? raw.leaveType : 'other';
  const startDate = String(raw.startDate ?? '').slice(0, 10);
  const endDate = String(raw.endDate ?? raw.startDate ?? '').slice(0, 10);
  if (!isValidDate(startDate)) throw new HrError('startDate must be YYYY-MM-DD');
  if (!isValidDate(endDate)) throw new HrError('endDate must be YYYY-MM-DD');
  if (endDate < startDate) throw new HrError('endDate cannot be before startDate');
  const paid = raw.paid === undefined ? leaveType !== 'unpaid' : Boolean(raw.paid);
  return {
    memberId,
    leaveType,
    paid,
    startDate,
    endDate,
    reason: nullableText(raw.reason, 1000),
  };
}

export function cleanHoliday(raw: Record<string, any>): HolidayInput {
  const date = String(raw.date ?? '').slice(0, 10);
  if (!isValidDate(date)) throw new HrError('date must be YYYY-MM-DD');
  const name = text(raw.name, 120);
  if (!name) throw new HrError('name is required');
  return { date, name };
}
