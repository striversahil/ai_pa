import { prisma } from '../../shared/prisma';
import { cached } from '../../shared/cache';
import { HrError } from './errors';
import { cleanEmployeeCreate, cleanEmployeePatch, cleanSalaryComponents } from './employees-parse';
import { cleanSalaryPlan } from './templates-parse';
import { resolveSalary, round2 } from './salary';
import { templateComponentsForCopy } from './templates';
import { createWithEmployeeCode } from './employee-codes';
import { DATA_CACHE_PREFIX, DATA_TTL_MS, invalidateHumanResourcesCache } from './cache';
import type { SalaryComponentInput } from './types';

function salaryOptions(row: any) {
  return {
    inputMode: row?.salaryInputMode ?? null,
    inputAmount: row?.salaryInputAmount === null || row?.salaryInputAmount === undefined
      ? null
      : Number(row.salaryInputAmount),
  };
}

function templateLite(row: any) {
  if (!row) return null;
  return {
    id: String(row.id),
    name: row.name ?? '',
    inputMode: row.inputMode === 'basic' ? 'basic' : 'gross',
    updatedAt: row.updatedAt ?? null,
  };
}

function isTemplateOutdated(row: any, template: any): boolean {
  if (!row?.salaryTemplateId || !row?.salaryTemplateAppliedAt || !template?.updatedAt) return false;
  return new Date(template.updatedAt).getTime() > new Date(row.salaryTemplateAppliedAt).getTime();
}

export function employeeJson(row: any, components: any[] = [], template: any = null) {
  let gross = 0;
  let basic = 0;
  let earnings: any[] = [];
  let deductions: any[] = [];
  try {
    const resolved = resolveSalary(components, salaryOptions(row));
    gross = resolved.gross;
    basic = resolved.basic;
    earnings = resolved.earnings.map((line) => ({ name: line.name, amount: line.amount }));
    deductions = resolved.deductions.map((line) => ({ name: line.name, amount: line.amount }));
  } catch { /* incomplete salary structure is still editable */ }
  return {
    id: String(row.id),
    name: row.name ?? '',
    employeeCode: row.employeeCode ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    designation: row.designation ?? null,
    department: row.department ?? null,
    photoUrl: row.photoUrl ?? null,
    joiningDate: row.joiningDate ?? null,
    exitDate: row.exitDate ?? null,
    employmentType: row.employmentType ?? 'full_time',
    active: row.active !== false,
    dateOfBirth: row.dateOfBirth ?? null,
    address: row.address ?? null,
    emergencyContactName: row.emergencyContactName ?? null,
    emergencyContactPhone: row.emergencyContactPhone ?? null,
    pan: row.pan ?? null,
    aadhaarLast4: row.aadhaarLast4 ?? null,
    bankName: row.bankName ?? null,
    bankAccountNumber: row.bankAccountNumber ?? null,
    bankIfsc: row.bankIfsc ?? null,
    pfNumber: row.pfNumber ?? null,
    esiNumber: row.esiNumber ?? null,
    notes: row.notes ?? null,
    salaryTemplateId: row.salaryTemplateId ? String(row.salaryTemplateId) : null,
    salaryInputMode: row.salaryInputMode === 'basic' ? 'basic' : row.salaryInputMode === 'gross' ? 'gross' : null,
    salaryInputAmount: row.salaryInputAmount === null || row.salaryInputAmount === undefined
      ? null
      : round2(Number(row.salaryInputAmount)),
    salaryTemplateAppliedAt: row.salaryTemplateAppliedAt ?? null,
    salaryTemplate: templateLite(template),
    salaryTemplateOutdated: isTemplateOutdated(row, template),
    order: Number(row.order) || 0,
    deleted: !!row.deleted,
    createdAt: row.createdAt ?? null,
    grossSalary: round2(gross),
    basicSalary: round2(basic),
    salaryComponents: (components || []).map(componentJson),
    earnings,
    deductions,
  };
}

export function componentJson(row: any) {
  return {
    id: String(row.id),
    name: row.name ?? '',
    componentType: row.componentType ?? 'earning',
    calcType: row.calcType ?? 'fixed',
    value: Number(row.value) || 0,
    formula: row.formula ?? null,
    code: row.code ?? null,
    cap: row.cap === null || row.cap === undefined ? null : Number(row.cap),
    floor: row.floor === null || row.floor === undefined ? null : Number(row.floor),
    isBasic: !!row.isBasic,
    order: Number(row.order) || 0,
  };
}

async function componentsFor(memberId: string) {
  return prisma.humanResourcesSalaryComponent.findMany({
    where: { memberId, deleted: false }, orderBy: { order: 'asc' },
  }) as Promise<any[]>;
}

async function templateFor(member: any) {
  if (!member?.salaryTemplateId) return null;
  const row: any = await prisma.humanResourcesSalaryTemplate.findUnique({ where: { id: String(member.salaryTemplateId) } });
  return row && !row.deleted ? row : null;
}

export async function listEmployees(includeDeleted = false) {
  const rows = await prisma.humanResourcesMember.findMany({
    where: includeDeleted ? {} : { deleted: false },
    orderBy: [{ active: 'desc' }, { order: 'asc' }, { name: 'asc' }],
  }) as any[];
  if (!rows.length) return [];
  const ids = rows.map((r) => String(r.id));
  const templateIds = [...new Set(rows.map((r) => r.salaryTemplateId).filter(Boolean).map(String))];
  const [components, templates] = await Promise.all([
    prisma.humanResourcesSalaryComponent.findMany({
      where: { memberId: { in: ids }, deleted: false }, orderBy: { order: 'asc' },
    }) as Promise<any[]>,
    templateIds.length
      ? prisma.humanResourcesSalaryTemplate.findMany({ where: { id: { in: templateIds }, deleted: false } }) as Promise<any[]>
      : Promise.resolve([] as any[]),
  ]);
  const templateBy = new Map(templates.map((t) => [String(t.id), t]));
  return rows.map((row) => employeeJson(
    row,
    components.filter((c) => String(c.memberId) === String(row.id)),
    row.salaryTemplateId ? templateBy.get(String(row.salaryTemplateId)) : null,
  ));
}

export async function getEmployee(id: string) {
  const row: any = await prisma.humanResourcesMember.findUnique({ where: { id } });
  if (!row || row.deleted) throw new HrError('employee not found', 404);
  return employeeJson(row, await componentsFor(id), await templateFor(row));
}

export async function createEmployee(input: Record<string, any>) {
  const data = cleanEmployeeCreate(input);
  const row: any = await createWithEmployeeCode((employeeCode) =>
    prisma.humanResourcesMember.create({ data: { ...data, employeeCode } }),
  );
  await invalidateHumanResourcesCache();
  return employeeJson(row, []);
}

export async function updateEmployee(id: string, input: Record<string, any>) {
  const patch = cleanEmployeePatch(input);
  delete patch.employeeCode;
  if (Object.keys(patch).length === 0) throw new HrError('employee code is generated automatically');
  const current: any = await prisma.humanResourcesMember.findUnique({ where: { id } });
  if (!current || current.deleted) throw new HrError('employee not found', 404);
  const joining = patch.joiningDate !== undefined ? patch.joiningDate : current.joiningDate;
  const exit = patch.exitDate !== undefined ? patch.exitDate : current.exitDate;
  if (joining && exit && exit < joining) throw new HrError('exitDate cannot be before joiningDate');
  const row: any = await prisma.humanResourcesMember.update({ where: { id }, data: patch });
  await invalidateHumanResourcesCache();
  return employeeJson(row, await componentsFor(id), await templateFor(row));
}

export async function deleteEmployee(id: string) {
  const row: any = await prisma.humanResourcesMember.findUnique({ where: { id } });
  if (!row || row.deleted) throw new HrError('employee not found', 404);
  await prisma.humanResourcesMember.update({ where: { id }, data: { deleted: true, active: false } });
  await invalidateHumanResourcesCache();
}

async function validatePlanRows(memberId: string, rows: SalaryComponentInput[], inputMode: string, inputAmount: number) {
  resolveSalary(rows, { inputMode, inputAmount });
  if (!rows.length) throw new HrError('salary structure has no components');
  if (rows.some((row) => !row.name)) throw new HrError('every salary component needs a name');
  void memberId;
}

export async function saveSalaryComponents(memberId: string, input: unknown) {
  const member: any = await prisma.humanResourcesMember.findUnique({ where: { id: memberId } });
  if (!member || member.deleted) throw new HrError('employee not found', 404);
  const rows = cleanSalaryComponents(input);
  await prisma.humanResourcesSalaryComponent.updateMany({ where: { memberId }, data: { deleted: true } });
  for (const row of rows) {
    await prisma.humanResourcesSalaryComponent.create({ data: { ...row, memberId } });
  }
  await prisma.humanResourcesMember.update({
    where: { id: memberId },
    data: { salaryTemplateId: null, salaryInputMode: null, salaryInputAmount: null, salaryTemplateAppliedAt: null },
  });
  await invalidateHumanResourcesCache();
  return employeeJson({ ...member, salaryTemplateId: null, salaryInputMode: null, salaryInputAmount: null }, await componentsFor(memberId));
}

export async function applySalaryPlan(memberId: string, input: Record<string, any>) {
  const member: any = await prisma.humanResourcesMember.findUnique({ where: { id: memberId } });
  if (!member || member.deleted) throw new HrError('employee not found', 404);
  const template: any = await prisma.humanResourcesSalaryTemplate.findUnique({ where: { id: String(input.templateId ?? '') } });
  if (!template || template.deleted) throw new HrError('salary template not found', 404);
  const mode = template.inputMode === 'basic' ? 'basic' : 'gross';
  const plan = cleanSalaryPlan(input, mode);
  const templateRows = templateComponentsForCopy({
    components: await prisma.humanResourcesSalaryTemplateComponent.findMany({
      where: { templateId: String(template.id), deleted: false }, orderBy: { order: 'asc' },
    }) as any[],
  });
  const rows = plan.components ?? templateRows;
  await validatePlanRows(memberId, rows, mode, plan.inputAmount);
  const appliedAt = new Date();
  await prisma.humanResourcesSalaryComponent.updateMany({ where: { memberId }, data: { deleted: true } });
  for (const row of rows) {
    await prisma.humanResourcesSalaryComponent.create({
      data: {
        ...row,
        memberId,
        templateId: String(template.id),
        formula: row.formula ?? null,
        code: row.code ?? null,
        cap: row.cap ?? null,
        floor: row.floor ?? null,
      },
    });
  }
  const updated: any = await prisma.humanResourcesMember.update({
    where: { id: memberId },
    data: {
      salaryTemplateId: String(template.id),
      salaryInputMode: mode,
      salaryInputAmount: plan.inputAmount,
      salaryTemplateAppliedAt: appliedAt,
    },
  });
  await invalidateHumanResourcesCache();
  return employeeJson(updated, await componentsFor(memberId), template);
}

export async function reapplySalaryPlan(memberId: string) {
  const member: any = await prisma.humanResourcesMember.findUnique({ where: { id: memberId } });
  if (!member || member.deleted) throw new HrError('employee not found', 404);
  if (!member.salaryTemplateId || !member.salaryInputAmount) {
    throw new HrError('employee has no salary template applied');
  }
  return applySalaryPlan(memberId, {
    templateId: String(member.salaryTemplateId),
    inputAmount: Number(member.salaryInputAmount),
  });
}

export async function listActiveEmployeesCached() {
  return cached(`${DATA_CACHE_PREFIX}employees:active`, DATA_TTL_MS, async () => {
    const rows = await prisma.humanResourcesMember.findMany({
      where: { deleted: false, active: true }, orderBy: { order: 'asc' },
    }) as any[];
    return rows.map((r) => ({
      id: String(r.id), name: r.name, designation: r.designation ?? null,
      department: r.department ?? null, photoUrl: r.photoUrl ?? null,
      employeeCode: r.employeeCode ?? null,
    }));
  });
}
