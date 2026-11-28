// hr-holiday-calendar.test.mjs — Guard: HR holiday calendar (single day,
// timespan, day-of-week) drives the leave window, attendance banner and payroll.
//
// Founder request 2026-11-28: "For any day of a week if that day of a week or a
// timespan or a specific day is marked as holiday by the HR then the complete
// employee hirerchy and payroll should adjust as per that."
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bundleToFile, BACKEND_DIR, FRONTEND_SRC } from "./_bundle.mjs";

const be = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, "src/automations/human-resources/holidays-parse.ts"))).href);
const holidayIo = readFileSync(join(BACKEND_DIR, "src/automations/human-resources/holidays.ts"), "utf8");
const attendance = readFileSync(join(BACKEND_DIR, "src/automations/human-resources/attendance.ts"), "utf8");
const payroll = readFileSync(join(BACKEND_DIR, "src/automations/human-resources/payroll.ts"), "utf8");
const route = readFileSync(join(BACKEND_DIR, "src/worker/routes/human-resources.ts"), "utf8");
const schema = readFileSync(join(BACKEND_DIR, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(join(BACKEND_DIR, "migrations/0187_hr_holiday_calendar.sql"), "utf8");
const feTypes = readFileSync(join(FRONTEND_SRC, "hr/types.ts"), "utf8");
const feTab = readFileSync(join(FRONTEND_SRC, "components/human-resources/LeavesTab.tsx"), "utf8");

const single = { kind: "single", date: "2026-12-25", name: "Christmas" };

describe("hr holidays: the three rule kinds", () => {
  it("infers a single day from a bare date and stores start = end", () => {
    const clean = be.cleanHoliday({ date: "2026-12-25", name: "Christmas" });
    assert.equal(clean.kind, "single");
    assert.equal(clean.startDate, "2026-12-25");
    assert.equal(clean.endDate, "2026-12-25");
    assert.equal(clean.weekday, null);
  });

  it("keeps a timespan as one rule", () => {
    const clean = be.cleanHoliday({ kind: "range", startDate: "2026-10-20", endDate: "2026-10-24", name: "Diwali" });
    assert.equal(clean.kind, "range");
    assert.equal(clean.date, null);
    assert.equal(clean.startDate, "2026-10-20");
    assert.equal(clean.endDate, "2026-10-24");
  });

  it("opens a weekday rule to the whole calendar unless a window is given", () => {
    const clean = be.cleanHoliday({ kind: "weekday", weekday: 0, name: "Sunday" });
    assert.equal(clean.kind, "weekday");
    assert.equal(clean.weekday, 0);
    assert.equal(clean.startDate, be.HOLIDAY_OPEN_START);
    assert.equal(clean.endDate, be.HOLIDAY_OPEN_END);
  });

  it("rejects malformed or impossible rules with a readable message", () => {
    assert.throws(() => be.cleanHoliday({ kind: "single", date: "25-12-2026", name: "X" }), /date must be YYYY-MM-DD/);
    assert.throws(() => be.cleanHoliday({ kind: "range", startDate: "2026-10-24", endDate: "2026-10-20", name: "X" }), /endDate cannot be before startDate/);
    assert.throws(() => be.cleanHoliday({ kind: "weekday", weekday: 7, name: "X" }), /weekday must be 0/);
    assert.throws(() => be.cleanHoliday({ kind: "single", date: "2026-12-25", name: "" }), /name is required/);
  });
});

describe("hr holidays: every consumer reads the same expanded set", () => {
  it("expands a single day and a timespan, clamped to the window", () => {
    const rows = [single, { kind: "range", startDate: "2026-10-20", endDate: "2026-10-24", name: "Diwali" }];
    const set = be.holidayDatesIn(rows, "2026-10-22", "2026-12-25");
    assert.deepEqual([...set].sort(), ["2026-10-22", "2026-10-23", "2026-10-24", "2026-12-25"]);
  });

  it("expands a weekday rule only inside its own window", () => {
    const rows = [{ kind: "weekday", weekday: 0, startDate: "2026-01-01", endDate: "2026-01-31", name: "Sunday" }];
    const set = be.holidayDatesIn(rows, "2026-01-01", "2026-01-31");
    assert.deepEqual([...set].sort(), ["2026-01-04", "2026-01-11", "2026-01-18", "2026-01-25"]);
    assert.equal(be.holidayDatesIn(rows, "2026-02-01", "2026-02-28").size, 0);
  });

  it("labels each kind for the UI", () => {
    assert.equal(be.holidayLabel({ ...single, date: "2026-12-25", startDate: "2026-12-25", endDate: "2026-12-25" }), "2026-12-25");
    assert.equal(be.holidayLabel({ kind: "range", startDate: "2026-10-20", endDate: "2026-10-24" }), "2026-10-20 → 2026-10-24");
    assert.equal(be.holidayLabel({ kind: "weekday", weekday: 1, startDate: "2026-01-01", endDate: "2026-12-31" }), "Every Monday (2026-01-01 → 2026-12-31)");
  });
});

describe("hr holidays: one calendar for payslip, attendance and leave", () => {
  it("payroll and attendance no longer read the holiday table directly", () => {
    assert.match(payroll, /holidaySet\(/);
    assert.ok(!/humanResourcesHoliday\.findMany/.test(payroll), "payroll must expand through holidaySet");
    assert.match(attendance, /holidayRuleFor\(/);
  });

  it("keeps holidays paid working days in payroll", () => {
    assert.match(payroll, /holidays/);
    assert.match(payroll, /leaveHolidays/);
  });

  it("exposes the CRUD routes and a kind-aware schema", () => {
    assert.ok(route.includes("app.get('/api/human-resources/holidays'"), "GET holidays route");
    assert.ok(route.includes("app.post('/api/human-resources/holidays'"), "POST holidays route");
    assert.ok(route.includes("app.patch('/api/human-resources/holidays/:id'"), "PATCH holidays route");
    assert.ok(route.includes("app.delete('/api/human-resources/holidays/:id'"), "DELETE holidays route");
    assert.match(schema, /weekday\s+Int\?/);
    assert.match(schema, /kind\s+String\s+@default\("single"\)/);
    assert.match(migration, /_backup_hr_holidays_20261128/);
    assert.match(migration, /HumanResourcesHoliday_single_date_idx/);
  });

  it("blocks duplicate rules instead of silently shadowing one", () => {
    assert.match(holidayIo, /a holiday already exists on this date/);
    assert.match(holidayIo, /this holiday range is already defined/);
    assert.match(holidayIo, /this weekday rule is already defined for that window/);
  });

  it("renders the kind picker and the server label in the UI", () => {
    assert.match(feTypes, /kind: HrHolidayKind/);
    assert.match(feTypes, /startDate: string/);
    assert.match(feTypes, /label: string/);
    assert.match(feTab, /One day/);
    assert.match(feTab, /Timespan/);
    assert.match(feTab, /Day of week/);
    assert.match(feTab, /holiday\.label/);
    assert.match(feTab, /weekday: holiday\.weekday \?\? 0/);
  });
});
