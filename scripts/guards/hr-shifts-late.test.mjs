// hr-shifts-late.test.mjs — Guard: HR shift windows + automatic late marking.
//
// Founder request 2026-11-28: "From the controller let HR mark individual
// employee type define check in and check out time slots and on the basis of
// that assign an employee a valid checkin and checkout time" + "if the
// employee was logged late automatically he should be marked as late" +
// "In the status add some more selection i.e. Short Leave and remove Holiday".
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bundleToFile, BACKEND_DIR, FRONTEND_SRC } from "./_bundle.mjs";

const be = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, "src/automations/human-resources/shifts-parse.ts"))).href);
const types = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, "src/automations/human-resources/types.ts"))).href);

const shifts = readFileSync(join(BACKEND_DIR, "src/automations/human-resources/shifts.ts"), "utf8");
const attendance = readFileSync(join(BACKEND_DIR, "src/automations/human-resources/attendance.ts"), "utf8");
const payroll = readFileSync(join(BACKEND_DIR, "src/automations/human-resources/payroll.ts"), "utf8");
const route = readFileSync(join(BACKEND_DIR, "src/worker/routes/human-resources.ts"), "utf8");
const migration = readFileSync(join(BACKEND_DIR, "migrations/0186_hr_shifts.sql"), "utf8");
const feTypes = readFileSync(join(FRONTEND_SRC, "hr/types.ts"), "utf8");
const feApi = readFileSync(join(FRONTEND_SRC, "hr/api.ts"), "utf8");
const feTab = readFileSync(join(FRONTEND_SRC, "components/human-resources/AttendanceTab.tsx"), "utf8");
const feForm = readFileSync(join(FRONTEND_SRC, "components/human-resources/EmployeeFormModal.tsx"), "utf8");
const feController = readFileSync(join(FRONTEND_SRC, "components/human-resources/ControllerTab.tsx"), "utf8");
const feShiftSection = readFileSync(join(FRONTEND_SRC, "components/human-resources/ShiftSection.tsx"), "utf8");

function feList(name) {
  const m = new RegExp("export const " + name + " = \\[([^\\]]*)\\]").exec(feTypes);
  assert.ok(m, name + " missing in hr/types.ts");
  return m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

describe("hr shifts: the status list is late-aware and holiday-free", () => {
  it("mirrors the backend statuses exactly, without holiday", () => {
    assert.deepEqual([...types.ATTENDANCE_STATUSES], ["present", "late", "half_day", "short_leave", "absent"]);
    assert.deepEqual(feList("ATTENDANCE_STATUSES"), [...types.ATTENDANCE_STATUSES]);
    assert.ok(!types.ATTENDANCE_STATUSES.includes("holiday"));
  });

  it("labels every status in the UI", () => {
    for (const status of types.ATTENDANCE_STATUSES) {
      assert.match(feTypes, new RegExp(status + ': "'), status);
    }
    assert.match(feTypes, /short_leave: "Short leave"/);
    assert.match(feTypes, /late: "Late"/);
  });

  it("retires the holiday attendance rows instead of leaving them behind", () => {
    assert.match(migration, /_backup_hr_attendance_holiday_20261128/);
    assert.match(migration, /DELETE FROM HumanResourcesAttendance WHERE status = 'holiday'/);
    assert.match(attendance, /status !== 'holiday'/);
    assert.match(attendance, /warnings\.push/);
  });
});

describe("hr shifts: shift windows", () => {
  const day = { startTime: "09:30", endTime: "18:30", graceMinutes: 10 };
  const night = { startTime: "22:00", endTime: "06:00", graceMinutes: 10 };

  it("marks a check-in past shift start + grace late, on time otherwise", () => {
    assert.equal(be.lateMinutes("09:40", day), 0);
    assert.equal(be.lateMinutes("09:41", day), 1);
    assert.equal(be.lateMinutes("10:00", day), 20);
    assert.equal(be.lateMinutes("09:00", day), 0);
    assert.equal(be.lateMinutes(null, day), null);
  });

  it("treats an end at/before the start as an overnight shift", () => {
    assert.deepEqual(be.shiftWindow(night), { start: 1320, end: 1800, overnight: true });
    assert.equal(be.lateMinutes("22:05", night), 0);
    assert.equal(be.lateMinutes("22:20", night), 10);
    assert.equal(be.lateMinutes("00:30", night), 140);
    assert.equal(be.earlyMinutes("05:30", night), 30);
    assert.equal(be.earlyMinutes("06:00", night), 0);
  });

  it("reports an early check-out for a day shift", () => {
    assert.equal(be.earlyMinutes("18:30", day), 0);
    assert.equal(be.earlyMinutes("17:30", day), 60);
    assert.equal(be.earlyMinutes(null, day), null);
  });

  it("only upgrades present to late; an explicit status is kept", () => {
    assert.equal(be.deriveAttendanceStatus("present", 12), "late");
    assert.equal(be.deriveAttendanceStatus("present", 0), "present");
    assert.equal(be.deriveAttendanceStatus("half_day", 12), "half_day");
    assert.equal(be.deriveAttendanceStatus("absent", 12), "absent");
    assert.equal(be.deriveAttendanceStatus("short_leave", 12), "short_leave");
  });
});

describe("hr shifts: assignment + storage", () => {
  it("prefers the employment-type shift, then the company default", () => {
    const rows = [
      { id: "all", employmentType: null, order: 0 },
      { id: "ft", employmentType: "full_time", order: 1 },
      { id: "off", employmentType: "contract", active: false, order: 2 },
    ];
    assert.equal(be.pickShift(rows, "full_time").id, "ft");
    assert.equal(be.pickShift(rows, "intern").id, "all");
    assert.equal(be.pickShift(rows, "contract").id, "all");
    assert.equal(be.pickShift([rows[2]], "contract"), null);
  });

  it("an employee's own shift wins over the type default", () => {
    assert.match(shifts, /export function effectiveShift\(member: any, shifts: any\[\]\)/);
    assert.match(shifts, /String\(row\.id\) === String\(member\.shiftId\)/);
    assert.match(shifts, /own \?\? pickShift\(shifts, member\?\.employmentType \?\? null\)/);
  });

  it("validates a shift window and caps the grace", () => {
    assert.deepEqual(be.cleanShift({ name: "General", startTime: "09:30", endTime: "18:30" }), {
      name: "General", employmentType: null, startTime: "09:30", endTime: "18:30", graceMinutes: 10, active: true, order: 0,
    });
    assert.throws(() => be.cleanShift({ name: "", startTime: "09:30", endTime: "18:30" }), /shift name is required/);
    assert.throws(() => be.cleanShift({ name: "X", startTime: "9:30", endTime: "18:30" }), /HH:mm/);
    assert.throws(() => be.cleanShift({ name: "X", startTime: "09:30", endTime: "18:30", graceMinutes: 999 }), /graceMinutes/);
    assert.equal(be.cleanShift({ name: "Night", startTime: "22:00", endTime: "06:00" }).endTime, "06:00");
  });

  it("refuses to delete a shift employees are still on", () => {
    assert.match(shifts, /humanResourcesMember\.count/);
    assert.match(shifts, /on this shift — assign them another shift first/);
    assert.match(shifts, /409/);
  });

  it("saves the derived late status and validates the window against the shift", () => {
    assert.match(attendance, /deriveAttendanceStatus\(row\.status, lateMinutes\(row\.inTime, shift\)\)/);
    assert.match(attendance, /outTime must be after inTime for this shift/);
    assert.match(attendance, /humanResourcesAttendance\.create\(\{\s*data: \{ \.\.\.row, status/);
  });
});

describe("hr shifts: surface", () => {
  it("exposes CRUD endpoints", () => {
    for (const verb of ["get", "post", "patch", "delete"]) {
      assert.match(route, new RegExp("app\\." + verb + "\\(\'/api/human-resources/shifts"), verb);
    }
    assert.match(route, /deleteShift\(c\.req\.param\('id'/);
  });

  it("attendance carries the expected window, late minutes and a derived status", () => {
    assert.match(attendance, /shift: shift \? shiftJson\(shift\) : null/);
    assert.match(attendance, /lateMinutes: late/);
    assert.match(attendance, /effectiveStatus/);
    assert.match(attendance, /PRESENT_STATUSES = \['present', 'late', 'short_leave'\]/);
  });

  it("payroll counts late/short_leave as present and has no holiday status branch", () => {
    assert.match(payroll, /record\.status === 'absent'/);
    assert.doesNotMatch(payroll, /record\.status === 'holiday'/);
  });

  it("the UI shows the expected window and the late chip, and never offers Holiday", () => {
    assert.match(feTab, />Expected</);
    assert.match(feTab, /Late by \{minutesLabel\(row\.attendance\.lateMinutes\)\}/);
    assert.match(feTab, /row\.shift\.startTime/);
    assert.match(feTab, /Company holiday ·/);
    assert.match(feTab, /holidayDay/);
    assert.doesNotMatch(feTab, /holiday: "Holiday"/);
  });

  it("HR defines shifts in the Controller and assigns one on the employee form", () => {
    assert.match(feController, /<ShiftSection \/>/);
    assert.match(feShiftSection, /Add shift/);
    assert.match(feShiftSection, /ConfirmDialog/);
    assert.match(feShiftSection, /deleteShift\(pending\.id\)/);
    assert.match(feForm, /Shift \(check-in window\)/);
    assert.match(feForm, /Employment-type default/);
    assert.match(feApi, /export async function listShifts\(\): Promise<HrShift\[\]>/);
    assert.match(feApi, /export async function saveShift\(payload: Record<string, unknown>, id\?: string\)/);
    assert.match(feApi, /export async function deleteShift\(id: string\)/);
  });
});
