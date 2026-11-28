// Company leave + attendance policy (migration 0188). ONE policy row holds
// three sections, all validated here on every read and write:
//   lateRule        — late check-ins allowed per month, then a half/full day
//                     deduction (or just a warning).
//   leaveAllowances — per leave type: paid days per month, optional total cap,
//                     and what happens to the excess.
//   shortLeave      — short leaves allowed per month, then a half day unpaid
//                     (or just a warning).
// Defaults reproduce the pre-0188 behaviour exactly: no deductions at all.
import { HrError } from './errors';
import { LEAVE_TYPES, type LeaveType } from './types';

export const POLICY_LATE_ACTIONS = ['half_day', 'full_day', 'warn'] as const;
export const POLICY_APPLY_TO = ['once', 'each'] as const;
export const POLICY_LEAVE_EXCESS = ['unpaid', 'block'] as const;
export const POLICY_SHORT_EXCESS = ['unpaid_half_day', 'warn'] as const;

export type PolicyLateAction = (typeof POLICY_LATE_ACTIONS)[number];
export type PolicyApplyTo = (typeof POLICY_APPLY_TO)[number];
export type PolicyLeaveExcess = (typeof POLICY_LEAVE_EXCESS)[number];
export type PolicyShortExcess = (typeof POLICY_SHORT_EXCESS)[number];

export interface PolicyLateRule {
  allowedLates: number;
  action: PolicyLateAction;
  applyTo: PolicyApplyTo;
  employmentType: string | null;
}

export interface PolicyLeaveAllowance {
  leaveType: LeaveType;
  paidDaysPerMonth: number;
  maxDaysPerMonth: number; // 0 = no total cap
  excess: PolicyLeaveExcess;
  employmentType: string | null;
}

export interface PolicyShortLeave {
  maxPerMonth: number;
  excess: PolicyShortExcess;
  employmentType: string | null;
}

export interface HrPolicy {
  lateRule: PolicyLateRule;
  leaveAllowances: PolicyLeaveAllowance[];
  shortLeave: PolicyShortLeave;
}

export const DEFAULT_HR_POLICY: HrPolicy = {
  lateRule: { allowedLates: 0, action: 'warn', applyTo: 'once', employmentType: null },
  leaveAllowances: [],
  shortLeave: { maxPerMonth: 0, excess: 'warn', employmentType: null },
};

function wholeNumber(value: unknown, field: string, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.round(n) !== n || n < min || n > max) {
    throw new HrError(field + ' must be a whole number from ' + min + ' to ' + max);
  }
  return n;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback: T): T {
  if (value === undefined || value === null || value === '') return fallback;
  const text = String(value);
  if (!(allowed as readonly string[]).includes(text)) {
    throw new HrError(field + ' must be one of: ' + allowed.join(', '));
  }
  return text as T;
}

function scope(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (text.length > 40) throw new HrError(field + ' is too long');
  return text || null;
}

function cleanLateRule(raw: any): PolicyLateRule {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    allowedLates: wholeNumber(source.allowedLates, 'lateRule.allowedLates', 0, 31, DEFAULT_HR_POLICY.lateRule.allowedLates),
    action: oneOf(source.action, POLICY_LATE_ACTIONS, 'lateRule.action', DEFAULT_HR_POLICY.lateRule.action),
    applyTo: oneOf(source.applyTo, POLICY_APPLY_TO, 'lateRule.applyTo', DEFAULT_HR_POLICY.lateRule.applyTo),
    employmentType: scope(source.employmentType, 'lateRule.employmentType'),
  };
}

function cleanAllowance(raw: any, index: number): PolicyLeaveAllowance {
  const source = raw && typeof raw === 'object' ? raw : {};
  const leaveType = oneOf(source.leaveType, LEAVE_TYPES, 'leaveAllowances[' + index + '].leaveType', 'other');
  const paidDaysPerMonth = wholeNumber(source.paidDaysPerMonth, 'leaveAllowances[' + index + '].paidDaysPerMonth', 0, 31, 0);
  const maxDaysPerMonth = wholeNumber(source.maxDaysPerMonth, 'leaveAllowances[' + index + '].maxDaysPerMonth', 0, 62, 0);
  if (maxDaysPerMonth > 0 && paidDaysPerMonth > maxDaysPerMonth) {
    throw new HrError('paid days cannot exceed the total cap for ' + leaveType);
  }
  return {
    leaveType,
    paidDaysPerMonth,
    maxDaysPerMonth,
    excess: oneOf(source.excess, POLICY_LEAVE_EXCESS, 'leaveAllowances[' + index + '].excess', 'unpaid'),
    employmentType: scope(source.employmentType, 'leaveAllowances[' + index + '].employmentType'),
  };
}

function cleanShortLeave(raw: any): PolicyShortLeave {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    maxPerMonth: wholeNumber(source.maxPerMonth, 'shortLeave.maxPerMonth', 0, 31, DEFAULT_HR_POLICY.shortLeave.maxPerMonth),
    excess: oneOf(source.excess, POLICY_SHORT_EXCESS, 'shortLeave.excess', DEFAULT_HR_POLICY.shortLeave.excess),
    employmentType: scope(source.employmentType, 'shortLeave.employmentType'),
  };
}

export function cleanPolicy(raw: unknown): HrPolicy {
  const source = raw && typeof raw === 'object' ? raw as any : {};
  if (source.leaveAllowances !== undefined && !Array.isArray(source.leaveAllowances)) {
    throw new HrError('leaveAllowances must be a list');
  }
  const list: PolicyLeaveAllowance[] = (source.leaveAllowances ?? []).map(cleanAllowance);
  if (list.length > 24) throw new HrError('too many leave allowances');
  const seen = new Set<string>();
  for (const row of list) {
    const key = row.leaveType + '|' + (row.employmentType ?? '');
    if (seen.has(key)) {
      throw new HrError('the same leave allowance is defined twice for ' + row.leaveType
        + (row.employmentType ? ' (' + row.employmentType + ')' : ''));
    }
    seen.add(key);
  }
  return {
    lateRule: cleanLateRule(source.lateRule),
    leaveAllowances: list,
    shortLeave: cleanShortLeave(source.shortLeave),
  };
}

/** Most-specific section wins: an employment-type rule only applies to that
 *  type; a rule with no employmentType applies to everyone. */
export function policyApplies(rule: { employmentType: string | null }, employmentType: string | null): boolean {
  return !rule.employmentType || rule.employmentType === employmentType;
}

/** Days of unpaid work created by the late rule this month (0.5 per half day). */
export function latePenaltyDays(rule: PolicyLateRule, lateCount: number): number {
  if (!Number.isFinite(lateCount) || lateCount <= 0) return 0;
  const excess = Math.max(0, lateCount - Math.max(0, rule.allowedLates || 0));
  if (excess <= 0 || rule.action === 'warn') return 0;
  const units = rule.applyTo === 'once' ? 1 : excess;
  return rule.action === 'half_day' ? units * 0.5 : units;
}

export function excessShortLeaves(rule: PolicyShortLeave, shortLeaveCount: number): number {
  if (!Number.isFinite(shortLeaveCount) || shortLeaveCount <= 0) return 0;
  const excess = Math.max(0, shortLeaveCount - Math.max(0, rule.maxPerMonth || 0));
  return rule.excess === 'unpaid_half_day' ? excess : 0;
}
