// Pure rules for employee leave applications (full day / half day / short).
//
// No DB, no HTTP — the Worker route, the HR decision path and the unit-level
// checks all share these predicates. Day maths lives ONLY here on the server:
// the frontend never re-derives it (so there is no mirror to guard).
import { HrError } from './errors';
import { addDays, isValidDate, istDateStr, normalizeTime, oneOf, text } from './parse';
import {
  LEAVE_DURATIONS, LEAVE_TYPES,
  type LeaveDuration, type LeaveType,
} from './types';

/** How far back an employee may back-date an application. */
export const MAX_BACK_DAYS = 30;
/** How far ahead an application may be filed. */
export const MAX_AHEAD_DAYS = 90;
/** Minimum length of the mandatory purpose / decision note. */
export const MIN_NOTE_CHARS = 3;

export interface CleanLeaveRequest {
  leaveType: LeaveType;
  paid: boolean;
  durationType: LeaveDuration;
  startDate: string;
  endDate: string;
  fromTime: string | null;
  toTime: string | null;
  reason: string;
}

/** Validates an employee application. The member is never taken from the body —
 *  the route pins it to the caller's own roster record. */
export function cleanLeaveRequest(
  input: Record<string, any>,
  today = istDateStr(),
): CleanLeaveRequest {
  const durationType = oneOf(input.durationType ?? 'full_day', LEAVE_DURATIONS, 'durationType');
  const leaveType = oneOf(input.leaveType, LEAVE_TYPES, 'leaveType');
  const startDate = String(input.startDate ?? '').slice(0, 10);
  if (!isValidDate(startDate)) throw new HrError('startDate must be YYYY-MM-DD');
  const rawEnd = input.endDate === undefined || input.endDate === null || String(input.endDate).trim() === ''
    ? startDate
    : String(input.endDate).slice(0, 10);
  if (!isValidDate(rawEnd)) throw new HrError('endDate must be YYYY-MM-DD');
  if (rawEnd < startDate) throw new HrError('endDate cannot be before startDate');
  if (durationType !== 'full_day' && rawEnd !== startDate) {
    throw new HrError(durationType === 'half_day'
      ? 'A half day is applied for one date'
      : 'A short leave is applied for one date');
  }
  if (startDate < addDays(today, -MAX_BACK_DAYS)) {
    throw new HrError(`apply within ${MAX_BACK_DAYS} days of the date`);
  }
  if (rawEnd > addDays(today, MAX_AHEAD_DAYS)) {
    throw new HrError(`apply at most ${MAX_AHEAD_DAYS} days ahead`);
  }
  const fromTime = normalizeTime(input.fromTime);
  const toTime = normalizeTime(input.toTime);
  if (fromTime && toTime && toTime <= fromTime) throw new HrError('toTime must be after fromTime');
  const reason = text(input.reason, 1000);
  if (reason.length < MIN_NOTE_CHARS) throw new HrError('the purpose of the leave is required');
  const paid = leaveType === 'unpaid'
    ? false
    : input.paid === undefined || input.paid === null ? true : Boolean(input.paid);
  return { leaveType, paid, durationType, startDate, endDate: rawEnd, fromTime, toTime, reason };
}

/** Working days → payable days for a duration. `short` is 0 (recorded only),
 *  `half_day` is half of every working date in the range. */
export function leaveDaysFor(durationType: string, workingDays: number): number {
  const days = Number(workingDays) || 0;
  if (durationType === 'short') return 0;
  if (durationType === 'half_day') return Math.round(days * 50) / 100;
  return days;
}

export function isLeaveDuration(value: unknown): value is LeaveDuration {
  return (LEAVE_DURATIONS as readonly string[]).includes(String(value));
}

/** Two date ranges share at least one calendar day. */
export function dateRangesOverlap(
  a: { startDate: unknown; endDate: unknown },
  b: { startDate: unknown; endDate: unknown },
): boolean {
  return String(a.startDate) <= String(b.endDate) && String(a.endDate) >= String(b.startDate);
}

/** A rejection is never silent: HR must type the reason. */
export function decisionNoteError(action: unknown, note: unknown): string | null {
  if (String(action) !== 'reject') return null;
  return String(note ?? '').trim().length < MIN_NOTE_CHARS
    ? 'a rejection note is required — the employee sees it'
    : null;
}

/** Human-readable one-liner for the journal / audit trail. */
export function decisionLabel(action: string, note: string | null): string {
  const verb = action === 'approve' ? 'approved' : 'rejected';
  return note ? `${verb}: ${note}` : verb;
}
