// mirror: founder-os_backend/src/automations/human-resources/policy-parse.ts
// Keep these calculations identical to the backend — the preview HR sees must
// be the money payroll will actually deduct.
import type {
  HrPolicy, HrPolicyLateRule, HrPolicyLeaveAllowance, HrPolicyShortLeave,
} from "./types";

export function policyApplies(
  rule: { employmentType: string | null },
  employmentType: string | null,
): boolean {
  return !rule.employmentType || rule.employmentType === employmentType;
}

export function latePenaltyDays(rule: HrPolicyLateRule, lateCount: number): number {
  if (!Number.isFinite(lateCount) || lateCount <= 0) return 0;
  const excess = Math.max(0, lateCount - Math.max(0, rule.allowedLates || 0));
  if (excess <= 0 || rule.action === "warn") return 0;
  const units = rule.applyTo === "once" ? 1 : excess;
  return rule.action === "half_day" ? units * 0.5 : units;
}

export function excessShortLeaves(rule: HrPolicyShortLeave, shortLeaveCount: number): number {
  if (!Number.isFinite(shortLeaveCount) || shortLeaveCount <= 0) return 0;
  const excess = Math.max(0, shortLeaveCount - Math.max(0, rule.maxPerMonth || 0));
  return rule.excess === "unpaid_half_day" ? excess : 0;
}

export function allowanceFor(
  policy: HrPolicy,
  leaveType: string,
  employmentType: string | null,
): HrPolicyLeaveAllowance | null {
  const rows = policy.leaveAllowances.filter((row) => row.leaveType === leaveType);
  return rows.find((row) => row.employmentType && row.employmentType === employmentType)
    ?? rows.find((row) => !row.employmentType)
    ?? null;
}
