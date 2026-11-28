// shifts-parse.ts — pure shift/attendance-window logic (no DB import, so the
// guard suite bundles it directly).
//
// Founder request 2026-11-28: HR defines employee types with their own
// check-in / check-out slot, assigns a shift, and anyone who logs in after the
// shift start + grace is marked late automatically.
import { HrError } from './errors';
import { nonNegative, oneOf, text } from './parse';
import { EMPLOYMENT_TYPES, type AttendanceStatus, type ShiftInput, type ShiftPatch } from './types';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** HH:mm -> minutes since midnight (null for anything else). */
export function timeMinutes(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!TIME_RE.test(raw)) return null;
  const [h, m] = raw.split(':').map(Number);
  return h * 60 + m;
}

function clock(value: unknown, field: string): string {
  const raw = String(value ?? '').trim();
  if (!TIME_RE.test(raw)) throw new HrError(`${field} must be HH:mm (24-hour)`);
  return raw;
}

function optionalEmploymentType(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  return oneOf(value, EMPLOYMENT_TYPES, 'employmentType');
}

export function cleanShift(input: Record<string, any>): ShiftInput {
  const name = text(input.name, 80);
  if (!name) throw new HrError('shift name is required');
  return {
    name,
    employmentType: optionalEmploymentType(input.employmentType),
    startTime: clock(input.startTime, 'startTime'),
    endTime: clock(input.endTime, 'endTime'),
    graceMinutes: Math.floor(nonNegative(input.graceMinutes ?? 10, 'graceMinutes', 240)),
    active: input.active === undefined ? true : Boolean(input.active),
    order: Math.floor(nonNegative(input.order ?? 0, 'order', 9999)),
  };
}

export function cleanShiftPatch(input: Record<string, any>): ShiftPatch {
  const out: ShiftPatch = {};
  if (input.name !== undefined) {
    const name = text(input.name, 80);
    if (!name) throw new HrError('shift name cannot be empty');
    out.name = name;
  }
  if (input.employmentType !== undefined) out.employmentType = optionalEmploymentType(input.employmentType);
  if (input.startTime !== undefined) out.startTime = clock(input.startTime, 'startTime');
  if (input.endTime !== undefined) out.endTime = clock(input.endTime, 'endTime');
  if (input.graceMinutes !== undefined) out.graceMinutes = Math.floor(nonNegative(input.graceMinutes, 'graceMinutes', 240));
  if (input.active !== undefined) out.active = Boolean(input.active);
  if (input.order !== undefined) out.order = Math.floor(nonNegative(input.order, 'order', 9999));
  return out;
}

export interface ShiftWindow { start: number; end: number; overnight: boolean }

/** Shift window in minutes; an end at/before the start runs past midnight. */
export function shiftWindow(shift: any): ShiftWindow | null {
  const start = timeMinutes(shift?.startTime);
  const end = timeMinutes(shift?.endTime);
  if (start === null || end === null) return null;
  const overnight = end <= start;
  return { start, end: overnight ? end + 1440 : end, overnight };
}

/** Minutes past shift start + grace (0 = on time, null = nothing to compare). */
export function lateMinutes(checkIn: unknown, shift: any): number | null {
  const window = shiftWindow(shift);
  const at = timeMinutes(checkIn);
  if (!window || at === null) return null;
  const minute = window.overnight && at < window.start ? at + 1440 : at;
  const late = minute - (window.start + Math.max(0, Number(shift?.graceMinutes ?? 0)));
  return late > 0 ? late : 0;
}

/** Minutes before shift end (0 = full shift, null = nothing to compare). */
export function earlyMinutes(checkOut: unknown, shift: any): number | null {
  const window = shiftWindow(shift);
  const at = timeMinutes(checkOut);
  if (!window || at === null) return null;
  const minute = at < window.start ? at + 1440 : at;
  const early = window.end - minute;
  return early > 0 ? early : 0;
}

/** 'present' becomes 'late' when the check-in is past the grace window; every
 *  other status is an explicit HR choice and is kept as typed. */
export function deriveAttendanceStatus(status: AttendanceStatus, late: number | null): AttendanceStatus {
  if (status === 'present' && late !== null && late > 0) return 'late';
  return status;
}

/** The shift an employee gets: their own, else the employment-type default,
 *  else the company default (employmentType NULL). Caller sorts by order. */
export function pickShift(shifts: any[], employmentType?: string | null): any | null {
  const active = (shifts || []).filter((row) => row && row.active !== false);
  if (!active.length) return null;
  const type = employmentType ? String(employmentType) : null;
  const specific = type ? active.find((row) => String(row.employmentType ?? '') === type) : null;
  return specific ?? active.find((row) => !row.employmentType) ?? null;
}
