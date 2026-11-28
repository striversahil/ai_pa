// Policy evaluation shared by payroll (money) and the Controller preview.
// Pure: no database import, so both runtimes and the guard can execute it.
import {
  excessShortLeaves, latePenaltyDays, policyApplies,
  type HrPolicy, type PolicyLeaveAllowance,
} from './policy-parse';

export interface MonthPolicyCounts {
  lateCount: number;
  policyHalfDays: number; // days deducted by the late rule
  shortLeaveCount: number;
  excessShortLeaves: number; // short leaves over the allowance (0.5 day each)
}

/** Attendance-side policy for one employee-month. Leaves are handled by
 *  `leaveDayPaid()` so payroll can split a partially paid leave. */
export function evaluateMonth(
  policy: HrPolicy,
  employmentType: string | null,
  attendance: any[],
): MonthPolicyCounts {
  const lateCount = attendance.filter((row) => String(row.status) === 'late').length;
  const shortLeaveCount = attendance.filter((row) => String(row.status) === 'short_leave').length;
  const lateRule = policy.lateRule;
  const shortRule = policy.shortLeave;
  return {
    lateCount,
    policyHalfDays: policyApplies(lateRule, employmentType) ? latePenaltyDays(lateRule, lateCount) : 0,
    shortLeaveCount,
    excessShortLeaves: policyApplies(shortRule, employmentType) ? excessShortLeaves(shortRule, shortLeaveCount) : 0,
  };
}

/** The allowance for one leave type: an employment-type row wins over the
 *  company row; no row at all means the legacy `paid` flag decides. */
export function allowanceFor(
  policy: HrPolicy,
  leaveType: string,
  employmentType: string | null,
): PolicyLeaveAllowance | null {
  const rows = policy.leaveAllowances.filter((row) => row.leaveType === leaveType);
  return rows.find((row) => row.employmentType && row.employmentType === employmentType)
    ?? rows.find((row) => !row.employmentType)
    ?? null;
}

/** Working days (Mon–Sat, holidays excluded) between the leave start and the
 *  given date, i.e. the 0-based index of that leave day. Sundays are the only
 *  weekly off, matching payroll's workingDatesInRange. */
function workingDaysBefore(start: string, date: string, holidays: Set<string>): number {
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = date.split('-').map(Number);
  let count = 0;
  for (let t = Date.UTC(y1, m1 - 1, d1, 12); t < Date.UTC(y2, m2 - 1, d2, 12); t += 86400000) {
    const day = new Date(t);
    if (day.getUTCDay() === 0 || holidays.has(day.toISOString().slice(0, 10))) continue;
    count++;
  }
  return count;
}

/** Is this leave day paid? Legacy rows (paidDays NULL) keep the stored flag; a
 *  decided row pays its first N WORKING days and the rest is unpaid. */
export function leaveDayPaid(leave: any, date: string, holidays: Set<string> = new Set()): boolean {
  if (leave?.paidDays === null || leave?.paidDays === undefined) return leave?.paid !== false;
  const paid = Number(leave.paidDays) || 0;
  if (paid <= 0) return false;
  if (String(leave.durationType ?? 'full_day') !== 'full_day') return paid > 0;
  return workingDaysBefore(String(leave.startDate), date, holidays) < Math.floor(paid);
}
