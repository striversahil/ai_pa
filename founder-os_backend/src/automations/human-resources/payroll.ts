import { prisma } from '../../shared/prisma';
import { HrError } from './errors';
import { clampRange, monthRange, workingDatesInRange } from './calendar';
import { cleanPayrollLinesPatch } from './payroll-parse';
import { holidaySet } from './holidays';
import { normalizeMonth } from './parse';
import { resolveSalary, round2 } from './salary';
import { invalidateHumanResourcesCache } from './cache';
import type { PayrollLine } from './types';

interface Stats {
  workingDays: number;
  eligibleDays: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  holidayDays: number;
  unmarkedDays: number;
  payableDays: number;
}

function emptyStats(): Stats {
  return {
    workingDays: 0, eligibleDays: 0, presentDays: 0, halfDays: 0,
    absentDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, holidayDays: 0,
    unmarkedDays: 0, payableDays: 0,
  };
}

function add(stats: Stats, kind: 'present' | 'half' | 'absent' | 'paidLeave' | 'unpaidLeave' | 'holiday' | 'unmarked') {
  if (kind === 'present') { stats.presentDays += 1; stats.payableDays += 1; }
  else if (kind === 'half') { stats.halfDays += 1; stats.payableDays += 0.5; }
  else if (kind === 'absent') stats.absentDays += 1;
  else if (kind === 'paidLeave') { stats.paidLeaveDays += 1; stats.payableDays += 1; }
  else if (kind === 'unpaidLeave') stats.unpaidLeaveDays += 1;
  else if (kind === 'holiday') { stats.holidayDays += 1; stats.payableDays += 1; }
  else stats.unmarkedDays += 1;
}

function computeStats(
  month: string,
  member: any,
  attendance: any[],
  leaves: any[],
  holidayDates: Set<string>,
): Stats {
  const { start, end } = monthRange(month);
  const monthWorking = workingDatesInRange(start, end, holidayDates);
  const stats = emptyStats();
  stats.workingDays = monthWorking.length;
  const joined = member.joiningDate ? String(member.joiningDate) : null;
  const exited = member.exitDate ? String(member.exitDate) : null;
  const range = clampRange(joined && joined > start ? joined : start, exited && exited < end ? exited : end, start, end);
  if (!range) return stats;
  const eligible = workingDatesInRange(range.start, range.end, holidayDates);
  stats.eligibleDays = eligible.length;
  const attendanceBy = new Map(attendance.map((r) => [String(r.date), r]));
  const leaveDates = new Set<string>();
  for (const leave of leaves) {
    for (let d = String(leave.startDate); d <= String(leave.endDate); d = nextDay(d)) {
      leaveDates.add(d);
    }
  }
  for (const date of eligible) {
    if (holidayDates.has(date)) { add(stats, 'holiday'); continue; }
    const record = attendanceBy.get(date);
    if (record) {
      if (record.status === 'half_day') add(stats, 'half');
      else if (record.status === 'absent') add(stats, 'absent');
      else if (record.status === 'holiday') add(stats, 'holiday');
      else add(stats, 'present');
      continue;
    }
    if (leaveDates.has(date)) {
      const leave = leaves.find((l) => String(l.startDate) <= date && String(l.endDate) >= date);
      add(stats, leave?.paid === false ? 'unpaidLeave' : 'paidLeave');
      continue;
    }
    add(stats, 'unmarked');
  }
  return stats;
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, 12)).toISOString().slice(0, 10);
}

function parseSnapshot(raw: unknown): any {
  try { return typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {}); }
  catch { return {}; }
}

export function slipJson(row: any) {
  const snapshot = parseSnapshot(row.snapshot);
  return {
    id: String(row.id),
    memberId: String(row.memberId),
    month: row.month,
    status: row.status ?? 'draft',
    employee: snapshot.employee ?? {
      name: row.employeeName, employeeCode: row.employeeCode,
      designation: row.designation, department: row.department,
    },
    employeeName: row.employeeName,
    employeeCode: row.employeeCode ?? null,
    designation: row.designation ?? null,
    department: row.department ?? null,
    workingDays: Number(row.workingDays) || 0,
    eligibleDays: Number(row.eligibleDays) || 0,
    payableDays: Number(row.payableDays) || 0,
    presentDays: Number(row.presentDays) || 0,
    halfDays: Number(row.halfDays) || 0,
    absentDays: Number(row.absentDays) || 0,
    paidLeaveDays: Number(row.paidLeaveDays) || 0,
    unpaidLeaveDays: Number(row.unpaidLeaveDays) || 0,
    holidayDays: Number(row.holidayDays) || 0,
    unmarkedDays: Number(row.unmarkedDays) || 0,
    perDay: Number(row.perDay) || 0,
    monthlyGross: Number(row.monthlyGross) || 0,
    earnedGross: Number(row.earnedGross) || 0,
    absenceDeduction: Number(row.absenceDeduction) || 0,
    componentDeductions: Number(row.componentDeductions) || 0,
    manualDeductions: Number(row.manualDeductions) || 0,
    totalDeductions: Number(row.totalDeductions) || 0,
    netPay: Number(row.netPay) || 0,
    earnings: Array.isArray(snapshot.earnings) ? snapshot.earnings : [],
    deductions: Array.isArray(snapshot.deductions) ? snapshot.deductions : [],
    fullMonthlyGross: Number(snapshot.fullMonthlyGross) || Number(row.monthlyGross) || 0,
    notes: row.notes ?? null,
    finalizedAt: row.finalizedAt ?? null,
    paidAt: row.paidAt ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

function buildSlip(
  member: any,
  month: string,
  stats: Stats,
  holidayDates: Set<string>,
) {
  const components = member.salaryComponents ?? [];
  const resolved = resolveSalary(components, {
    inputMode: member.salaryInputMode ?? null,
    inputAmount: member.salaryInputAmount ?? null,
  });
  if (resolved.gross <= 0) throw new HrError('add earning salary components first');
  if (stats.eligibleDays <= 0) throw new HrError('employee is not employed in this month');
  const perDay = round2(resolved.gross / stats.workingDays);
  const ratio = stats.eligibleDays / stats.workingDays;
  const proratedGross = round2(resolved.gross * ratio);
  const unpaidEquivalent = stats.absentDays + stats.unpaidLeaveDays + stats.halfDays * 0.5 + stats.unmarkedDays;
  const absenceDeduction = round2(perDay * unpaidEquivalent);
  const earnedGross = round2(proratedGross - absenceDeduction);
  const componentDeductions = round2(resolved.deductions.reduce((sum, line) => sum + line.amount, 0));
  const totalDeductions = round2(absenceDeduction + componentDeductions);
  const netPay = round2(earnedGross - componentDeductions);
  const snapshot = {
    employee: {
      id: String(member.id),
      name: member.name,
      employeeCode: member.employeeCode ?? null,
      designation: member.designation ?? null,
      department: member.department ?? null,
      joiningDate: member.joiningDate ?? null,
      photoUrl: member.photoUrl ?? null,
    },
    earnings: resolved.earnings,
    deductions: resolved.deductions,
    basic: resolved.basic,
    fullMonthlyGross: resolved.gross,
    proratedGross,
    eligibleRatio: ratio,
    workingDays: stats.workingDays,
    eligibleDays: stats.eligibleDays,
    salaryInputMode: resolved.inputMode,
    salaryInputAmount: resolved.inputAmount,
    salaryTemplateId: member.salaryTemplateId ? String(member.salaryTemplateId) : null,
    leaveHolidays: [...holidayDates].filter((d) => d >= monthRange(month).start && d <= monthRange(month).end),
  };
  return {
    ...stats,
    perDay,
    monthlyGross: proratedGross,
    earnedGross,
    absenceDeduction,
    componentDeductions,
    totalDeductions,
    netPay,
    snapshot: JSON.stringify(snapshot),
  };
}

export async function listPayroll(monthInput: unknown) {
  const month = normalizeMonth(monthInput);
  const [slips, members, components] = await Promise.all([
    prisma.humanResourcesSalarySlip.findMany({
      where: { month }, orderBy: [{ status: 'asc' }, { employeeName: 'asc' }],
    }) as Promise<any[]>,
    prisma.humanResourcesMember.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } }) as Promise<any[]>,
    prisma.humanResourcesSalaryComponent.findMany({ where: { deleted: false } }) as Promise<any[]>,
  ]);
  const byMember = new Map<string, any[]>();
  for (const c of components) {
    const list = byMember.get(String(c.memberId)) ?? [];
    list.push(c);
    byMember.set(String(c.memberId), list);
  }
  const employees = members.map((m) => {
    let gross = 0;
    try {
      gross = resolveSalary(byMember.get(String(m.id)) ?? [], {
        inputMode: m.salaryInputMode ?? null,
        inputAmount: m.salaryInputAmount ?? null,
      }).gross;
    } catch { /* incomplete */ }
    return {
      id: String(m.id), name: m.name, employeeCode: m.employeeCode ?? null,
      designation: m.designation ?? null, department: m.department ?? null,
      photoUrl: m.photoUrl ?? null, active: m.active !== false,
      joiningDate: m.joiningDate ?? null, exitDate: m.exitDate ?? null,
      hasSalary: gross > 0, grossSalary: round2(gross),
    };
  });
  const rows = slips.map(slipJson);
  return {
    month,
    slips: rows,
    employees,
    summary: {
      employeeCount: employees.filter((e) => e.active).length,
      slipCount: rows.length,
      draftCount: rows.filter((s) => s.status === 'draft').length,
      finalizedCount: rows.filter((s) => s.status === 'finalized').length,
      paidCount: rows.filter((s) => s.status === 'paid').length,
      totalNet: round2(rows.reduce((sum, s) => sum + s.netPay, 0)),
      totalDeductions: round2(rows.reduce((sum, s) => sum + s.totalDeductions, 0)),
    },
  };
}

export async function generatePayroll(monthInput: unknown, actor: string | null) {
  const month = normalizeMonth(monthInput);
  const { start, end } = monthRange(month);
  const [members, allComponents, attendance, leaves, holidays, existingSlips] = await Promise.all([
    prisma.humanResourcesMember.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } }) as Promise<any[]>,
    prisma.humanResourcesSalaryComponent.findMany({ where: { deleted: false } }) as Promise<any[]>,
    prisma.humanResourcesAttendance.findMany({
      where: { date: { gte: start, lte: end }, deleted: false },
    }) as Promise<any[]>,
    prisma.humanResourcesLeave.findMany({ where: { deleted: false } }) as Promise<any[]>,
    prisma.humanResourcesHoliday.findMany({ where: { date: { gte: start, lte: end } } }) as Promise<any[]>,
    prisma.humanResourcesSalarySlip.findMany({ where: { month } }) as Promise<any[]>,
  ]);
  const holidayDates = new Set(holidays.map((h: any) => String(h.date)));
  const componentsBy = new Map<string, any[]>();
  for (const c of allComponents) {
    const list = componentsBy.get(String(c.memberId)) ?? [];
    list.push(c);
    componentsBy.set(String(c.memberId), list);
  }
  const slipBy = new Map(existingSlips.map((s: any) => [String(s.memberId), s]));
  let created = 0;
  let updated = 0;
  const skipped: { name: string; reason: string }[] = [];
  for (const member of members) {
    const memberAttendance = attendance.filter((a: any) => String(a.memberId) === String(member.id));
    const memberLeaves = leaves.filter((l: any) => String(l.memberId) === String(member.id)
      && String(l.endDate) >= start && String(l.startDate) <= end);
    const existing = slipBy.get(String(member.id));
    if (existing && ['finalized', 'paid'].includes(String(existing.status))) {
      skipped.push({ name: member.name, reason: `${existing.status} slip locked` });
      continue;
    }
    if (!member.active && !existing && memberAttendance.length === 0 && memberLeaves.length === 0) {
      continue;
    }
    try {
      const stats = computeStats(month, member, memberAttendance, memberLeaves, holidayDates);
      if (stats.eligibleDays <= 0) continue;
      const built = buildSlip({ ...member, salaryComponents: componentsBy.get(String(member.id)) ?? [] }, month, stats, holidayDates);
      const data = {
        memberId: String(member.id), month, status: 'draft',
        employeeName: member.name, employeeCode: member.employeeCode ?? null,
        designation: member.designation ?? null, department: member.department ?? null,
        ...built, createdBy: actor, updatedBy: actor,
      };
      if (existing) {
        await prisma.humanResourcesSalarySlip.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await prisma.humanResourcesSalarySlip.create({ data });
        created += 1;
      }
    } catch (e) {
      skipped.push({ name: member.name, reason: e instanceof Error ? e.message : 'could not generate' });
    }
  }
  await invalidateHumanResourcesCache();
  return { created, updated, skipped, ...(await listPayroll(month)) };
}

export async function updateSlipLines(id: string, input: Record<string, any>, actor: string | null) {
  const slip: any = await prisma.humanResourcesSalarySlip.findUnique({ where: { id } });
  if (!slip) throw new HrError('salary slip not found', 404);
  if (slip.status !== 'draft') throw new HrError('only draft slips can be edited');
  const patch = cleanPayrollLinesPatch(input);
  const snapshot = parseSnapshot(slip.snapshot);
  const earnings: PayrollLine[] = patch.earnings ?? (snapshot.earnings ?? []);
  const deductions: PayrollLine[] = patch.deductions ?? (snapshot.deductions ?? []);
  const gross = round2(earnings.reduce((sum, line) => sum + Number(line.amount || 0), 0));
  const componentDeductions = round2(deductions.reduce((sum, line) => sum + Number(line.amount || 0), 0));
  const absenceDeduction = Number(slip.absenceDeduction) || 0;
  const totalDeductions = round2(absenceDeduction + componentDeductions);
  const earnedGross = round2(gross - absenceDeduction);
  const netPay = round2(earnedGross - componentDeductions);
  const nextSnapshot = {
    ...snapshot, earnings, deductions,
    fullMonthlyGross: gross,
    proratedGross: gross,
  };
  const row: any = await prisma.humanResourcesSalarySlip.update({
    where: { id },
    data: {
      monthlyGross: gross,
      earnedGross,
      componentDeductions,
      totalDeductions,
      netPay,
      snapshot: JSON.stringify(nextSnapshot),
      notes: patch.notes !== undefined ? patch.notes : slip.notes,
      updatedBy: actor,
    } as any,
  });
  await invalidateHumanResourcesCache();
  return slipJson(row);
}

export async function setSlipStatus(id: string, action: string, actor: string | null) {
  const slip: any = await prisma.humanResourcesSalarySlip.findUnique({ where: { id } });
  if (!slip) throw new HrError('salary slip not found', 404);
  const now = new Date();
  if (action === 'finalize') {
    if (slip.status !== 'draft') throw new HrError('only draft slips can be finalized');
    const row = await prisma.humanResourcesSalarySlip.update({
      where: { id }, data: { status: 'finalized', finalizedAt: now, updatedBy: actor },
    });
    await invalidateHumanResourcesCache();
    return slipJson(row);
  }
  if (action === 'paid') {
    if (slip.status !== 'finalized') throw new HrError('finalize the slip before marking it paid');
    const row = await prisma.humanResourcesSalarySlip.update({
      where: { id }, data: { status: 'paid', paidAt: now, updatedBy: actor },
    });
    await invalidateHumanResourcesCache();
    return slipJson(row);
  }
  if (action === 'reopen') {
    const row = await prisma.humanResourcesSalarySlip.update({
      where: { id }, data: { status: 'draft', finalizedAt: null, paidAt: null, updatedBy: actor },
    });
    await invalidateHumanResourcesCache();
    return slipJson(row);
  }
  throw new HrError('action must be finalize|paid|reopen');
}
