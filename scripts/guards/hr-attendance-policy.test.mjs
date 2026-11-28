// hr-attendance-policy.test.mjs — Guard: company leave + attendance policy.
//
// Founder request 2026-11-28: "i want to make leaves and policy highly
// customizable and intuitive and simple for HR department to define employee
// leaves and policy" — late threshold → auto half-day, monthly paid/unpaid
// leave allowances and short-leave allowances, all in one editor.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bundleToFile, BACKEND_DIR, FRONTEND_SRC } from "./_bundle.mjs";

const policy = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, "src/automations/human-resources/policy-parse.ts"))).href);
const evalModule = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, "src/automations/human-resources/policy-eval.ts"))).href);
const fePolicy = await import(pathToFileURL(bundleToFile(join(FRONTEND_SRC, "hr/policy.ts"))).href);

const payroll = readFileSync(join(BACKEND_DIR, "src/automations/human-resources/payroll.ts"), "utf8");
const leaves = readFileSync(join(BACKEND_DIR, "src/automations/human-resources/leaves.ts"), "utf8");
const decide = readFileSync(join(BACKEND_DIR, "src/automations/human-resources/leave-requests.ts"), "utf8");
const store = readFileSync(join(BACKEND_DIR, "src/automations/human-resources/policy.ts"), "utf8");
const route = readFileSync(join(BACKEND_DIR, "src/worker/routes/human-resources.ts"), "utf8");
const schema = readFileSync(join(BACKEND_DIR, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(join(BACKEND_DIR, "migrations/0188_hr_policy.sql"), "utf8");
const feTypes = readFileSync(join(FRONTEND_SRC, "hr/types.ts"), "utf8");
const feApi = readFileSync(join(FRONTEND_SRC, "hr/api.ts"), "utf8");
const feTab = readFileSync(join(FRONTEND_SRC, "components/human-resources/LeavesTab.tsx"), "utf8");
const fePolicyTab = readFileSync(join(FRONTEND_SRC, "components/human-resources/PolicyTab.tsx"), "utf8");
const feDashboard = readFileSync(join(FRONTEND_SRC, "components/HumanResourcesDashboard.tsx"), "utf8");

const lateRule = (patch = {}) => ({ ...policy.DEFAULT_HR_POLICY.lateRule, ...patch });
const shortRule = (patch = {}) => ({ ...policy.DEFAULT_HR_POLICY.shortLeave, ...patch });

describe("hr policy: defaults leave every rupee where it was", () => {
  it("warn-only defaults never deduct", () => {
    assert.equal(policy.latePenaltyDays(policy.DEFAULT_HR_POLICY.lateRule, 99), 0);
    assert.equal(policy.excessShortLeaves(policy.DEFAULT_HR_POLICY.shortLeave, 99), 0);
    assert.deepEqual([...policy.DEFAULT_HR_POLICY.leaveAllowances], []);
  });

  it("evaluateMonth reads only late/short_leave attendance", () => {
    const counts = evalModule.evaluateMonth(policy.DEFAULT_HR_POLICY, "full_time", [
      { status: "present" }, { status: "late" }, { status: "late" },
      { status: "short_leave" }, { status: "absent" },
    ]);
    assert.equal(counts.lateCount, 2);
    assert.equal(counts.shortLeaveCount, 1);
    assert.equal(counts.policyHalfDays, 0);
    assert.equal(counts.excessShortLeaves, 0);
  });
});

describe("hr policy: late threshold", () => {
  it("deducts once or for every late after the allowance", () => {
    const half = lateRule({ allowedLates: 3, action: "half_day", applyTo: "once" });
    assert.equal(policy.latePenaltyDays(half, 3), 0);
    assert.equal(policy.latePenaltyDays(half, 4), 0.5);
    assert.equal(policy.latePenaltyDays(half, 9), 0.5);
    const each = lateRule({ allowedLates: 3, action: "half_day", applyTo: "each" });
    assert.equal(policy.latePenaltyDays(each, 9), 3);
    const full = lateRule({ allowedLates: 0, action: "full_day", applyTo: "each" });
    assert.equal(policy.latePenaltyDays(full, 2), 2);
    assert.equal(policy.latePenaltyDays(lateRule({ action: "warn" }), 50), 0);
  });

  it("honours the employment-type scope", () => {
    const forInterns = lateRule({ allowedLates: 0, action: "full_day", employmentType: "intern" });
    assert.equal(policy.policyApplies(forInterns, "intern"), true);
    assert.equal(policy.policyApplies(forInterns, "full_time"), false);
    const counts = evalModule.evaluateMonth(
      { ...policy.DEFAULT_HR_POLICY, lateRule: forInterns }, "full_time", [{ status: "late" }, { status: "late" }],
    );
    assert.equal(counts.policyHalfDays, 0);
    assert.equal(evalModule.evaluateMonth(
      { ...policy.DEFAULT_HR_POLICY, lateRule: forInterns }, "intern", [{ status: "late" }],
    ).policyHalfDays, 1);
  });
});

describe("hr policy: leave + short-leave allowances", () => {
  it("excess short leaves become half days only when configured", () => {
    assert.equal(policy.excessShortLeaves(shortRule({ maxPerMonth: 2, excess: "warn" }), 6), 0);
    assert.equal(policy.excessShortLeaves(shortRule({ maxPerMonth: 2, excess: "unpaid_half_day" }), 6), 4);
    assert.equal(policy.excessShortLeaves(shortRule({ maxPerMonth: 2, excess: "unpaid_half_day" }), 1), 0);
  });

  it("picks the employment-type allowance first, else the company row", () => {
    const parsed = policy.cleanPolicy({
      leaveAllowances: [
        { leaveType: "casual", paidDaysPerMonth: 2, excess: "unpaid" },
        { leaveType: "casual", paidDaysPerMonth: 1, employmentType: "intern" },
      ],
    });
    assert.equal(evalModule.allowanceFor(parsed, "casual", "intern").paidDaysPerMonth, 1);
    assert.equal(evalModule.allowanceFor(parsed, "casual", "full_time").paidDaysPerMonth, 2);
    assert.equal(evalModule.allowanceFor(parsed, "sick", "intern"), null);
  });

  it("rejects duplicate allowances and impossible caps", () => {
    assert.throws(() => policy.cleanPolicy({ leaveAllowances: [
      { leaveType: "casual", paidDaysPerMonth: 1 },
      { leaveType: "casual", paidDaysPerMonth: 2 },
    ] }), /defined twice/);
    assert.throws(() => policy.cleanPolicy({ leaveAllowances: [
      { leaveType: "casual", paidDaysPerMonth: 5, maxDaysPerMonth: 2 },
    ] }), /cannot exceed/);
    assert.throws(() => policy.cleanPolicy({ lateRule: { action: "disappear" } }), /must be one of/);
  });

  it("splits a partially paid leave day by day", () => {
    const leave = { durationType: "full_day", startDate: "2026-11-02", paidDays: 2, paid: true };
    assert.equal(evalModule.leaveDayPaid(leave, "2026-11-02"), true);
    assert.equal(evalModule.leaveDayPaid(leave, "2026-11-03"), true);
    assert.equal(evalModule.leaveDayPaid(leave, "2026-11-04"), false);
    assert.equal(evalModule.leaveDayPaid({ ...leave, paidDays: null, paid: false }, "2026-11-02"), false);
    assert.equal(evalModule.leaveDayPaid({ paidDays: null, paid: true }, "2026-11-02"), true);
  });
});

describe("hr policy: payroll + leave decisions use it", () => {
  it("payroll deducts the policy half-days and excess short leaves", () => {
    assert.match(payroll, /getPolicy\(\)/);
    assert.match(payroll, /evaluateMonth\(policy, member\.employmentType/);
    assert.match(payroll, /stats\.policyHalfDays \+ stats\.excessShortLeaves \* 0\.5/);
    assert.match(payroll, /leaveDayPaid\(leave, date\)/);
    assert.match(payroll, /policy: \{\n\s+lateCount/);
  });

  it("a decision and an HR-recorded leave both store paidDays", () => {
    assert.match(store, /allocatePaidDays/);
    assert.match(decide, /allocatePaidDays\(/);
    assert.match(decide, /paidDays,/);
    assert.match(leaves, /allocatePaidDays\(/);
    assert.match(leaves, /paidDays/);
  });

  it("a block allowance refuses the approval instead of going unpaid", () => {
    assert.match(store, /allowance\.excess === 'block'/);
    assert.match(store, /allowance is used up/);
    assert.match(store, /leave cap is/);
  });
});

describe("hr policy: routes + storage", () => {
  it("exposes GET and a manager-only PUT", () => {
    assert.ok(route.includes("app.get('/api/human-resources/policy'"));
    assert.ok(route.includes("app.put('/api/human-resources/policy'"));
    assert.match(route, /only HR can change the policy/);
  });

  it("stores one singleton row and a nullable paidDays", () => {
    assert.match(schema, /model HumanResourcesPolicy/);
    assert.match(schema, /paidDays\s+Float\?/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS "HumanResourcesPolicy"/);
    assert.match(migration, /ALTER TABLE "HumanResourcesLeave" ADD COLUMN "paidDays" REAL/);
  });
});

describe("hr policy: the frontend mirror is the same maths", () => {
  it("matches the backend on every branch", () => {
    const cases = [
      [lateRule({ allowedLates: 2, action: "half_day", applyTo: "once" }), 2],
      [lateRule({ allowedLates: 2, action: "half_day", applyTo: "once" }), 9],
      [lateRule({ allowedLates: 1, action: "half_day", applyTo: "each" }), 6],
      [lateRule({ allowedLates: 0, action: "full_day", applyTo: "each" }), 3],
      [lateRule({ action: "warn" }), 12],
    ];
    for (const [rule, count] of cases) {
      assert.equal(fePolicy.latePenaltyDays(rule, count), policy.latePenaltyDays(rule, count));
    }
    for (const rule of [
      shortRule({ maxPerMonth: 0, excess: "warn" }),
      shortRule({ maxPerMonth: 2, excess: "unpaid_half_day" }),
    ]) {
      for (const count of [0, 2, 7]) {
        assert.equal(fePolicy.excessShortLeaves(rule, count), policy.excessShortLeaves(rule, count));
      }
    }
    assert.match(readFileSync(join(FRONTEND_SRC, "hr/policy.ts"), "utf8"), /mirror: founder-os_backend.*policy-parse\.ts/);
  });

  it("renames the tab and mounts the editor", () => {
    assert.ok(feDashboard.includes('label: "Leaves & Policy"'));
    assert.ok(!feDashboard.includes('Leaves & holidays'));
    assert.ok(feTab.includes('{ key: "policy", label: "Policy" }'));
    assert.ok(feTab.includes("<PolicyTab />"));
    assert.ok(fePolicyTab.includes("Save policy"));
    assert.ok(feApi.includes("/api/human-resources/policy"));
    assert.match(feTypes, /export interface HrPolicy/);
  });
});
