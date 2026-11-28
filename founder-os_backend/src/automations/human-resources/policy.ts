// Persistence for the company policy singleton (migration 0188) and the
// decision-time paid-day allocation for one leave request.
import { prisma } from '../../shared/prisma';
import { HrError } from './errors';
import { monthRange } from './calendar';
import { invalidateHumanResourcesCache } from './cache';
import { cleanPolicy, DEFAULT_HR_POLICY, type HrPolicy } from './policy-parse';
import { allowanceFor } from './policy-eval';
import { round2 } from './salary';

export const POLICY_ID = 'company';

export function parsePolicyConfig(raw: unknown): HrPolicy {
  try {
    return cleanPolicy(typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw ?? {}));
  } catch {
    return DEFAULT_HR_POLICY;
  }
}

export async function getPolicy(): Promise<HrPolicy> {
  const row: any = await prisma.humanResourcesPolicy.findUnique({ where: { id: POLICY_ID } });
  if (!row) return DEFAULT_HR_POLICY;
  return parsePolicyConfig(row.config);
}

export async function policyPayload() {
  const [policy, row] = await Promise.all([
    getPolicy(),
    prisma.humanResourcesPolicy.findUnique({ where: { id: POLICY_ID } }) as Promise<any>,
  ]);
  return {
    policy,
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

export async function savePolicy(input: unknown, actor: string | null) {
  const policy = cleanPolicy(input);
  await prisma.humanResourcesPolicy.upsert({
    where: { id: POLICY_ID },
    create: { id: POLICY_ID, config: JSON.stringify(policy), updatedBy: actor },
    update: { config: JSON.stringify(policy), updatedBy: actor },
  });
  await invalidateHumanResourcesCache();
  return policyPayload();
}

/** Paid days for one leave row, capped by the month's allowance. Returns NULL
 *  when no allowance exists for that type (legacy `paid` flag decides). A
 *  `block` allowance refuses the approval instead of silently going unpaid. */
export async function allocatePaidDays(input: {
  memberId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  durationType: string;
  paid: boolean;
  employmentType: string | null;
  exceptId?: string;
}): Promise<number | null> {
  const policy = await getPolicy();
  const allowance = allowanceFor(policy, input.leaveType, input.employmentType);
  if (!allowance) return null;
  const days = round2(Number(input.days) || 0);
  if (days <= 0) return 0;
  const month = String(input.startDate).slice(0, 7);
  const { start, end } = monthRange(month);
  const rows = (await prisma.humanResourcesLeave.findMany({
    where: {
      memberId: input.memberId, leaveType: input.leaveType, deleted: false,
      status: 'approved', startDate: { gte: start, lte: end },
    },
  })) as any[];
  const others = rows.filter((row) => String(row.id) !== String(input.exceptId ?? ''));
  const usedPaid = others.reduce((sum, row) => sum
    + (row.paidDays === null || row.paidDays === undefined
      ? (row.paid !== false ? Number(row.days) || 0 : 0)
      : Number(row.paidDays) || 0), 0);
  const usedTotal = others.reduce((sum, row) => sum + (Number(row.days) || 0), 0);
  const cap = allowance.maxDaysPerMonth;
  if (cap > 0 && usedTotal + days > cap && allowance.excess === 'block') {
    throw new HrError('this month\'s ' + input.leaveType + ' leave cap is ' + cap
      + ' day(s) and ' + round2(usedTotal) + ' is already approved');
  }
  const paid = round2(Math.min(days, Math.max(0, allowance.paidDaysPerMonth - usedPaid)));
  if (allowance.excess === 'block' && paid < days) {
    throw new HrError('this month\'s paid ' + input.leaveType
      + ' allowance is used up — reject the request or record it as unpaid');
  }
  return paid;
}
