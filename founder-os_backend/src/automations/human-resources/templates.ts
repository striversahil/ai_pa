import { prisma } from '../../shared/prisma';
import { HrError } from './errors';
import { cleanSalaryTemplate } from './templates-parse';
import { invalidateHumanResourcesCache } from './cache';
import { resolveSalary, round2 } from './salary';
import { SALARY_INPUT_MODES, type SalaryComponentInput, type SalaryInputMode, type SalaryTemplateInput } from './types';
import { oneOf, positiveAmount } from './parse';

export function templateComponentJson(row: any) {
  return {
    id: String(row.id),
    name: row.name ?? '',
    code: row.code ?? null,
    componentType: row.componentType ?? 'earning',
    calcType: row.calcType ?? 'fixed',
    value: Number(row.value) || 0,
    formula: row.formula ?? null,
    cap: row.cap === null || row.cap === undefined ? null : Number(row.cap),
    floor: row.floor === null || row.floor === undefined ? null : Number(row.floor),
    isBasic: !!row.isBasic,
    order: Number(row.order) || 0,
  };
}

export function templateJson(row: any, components: any[], employeeCount = 0) {
  return {
    id: String(row.id),
    name: row.name ?? '',
    description: row.description ?? null,
    inputMode: row.inputMode === 'basic' ? 'basic' : 'gross',
    isDefault: !!row.isDefault,
    employeeCount,
    components: components
      .filter((c) => !c.deleted)
      .slice()
      .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
      .map(templateComponentJson),
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

async function componentsFor(templateId: string) {
  return prisma.humanResourcesSalaryTemplateComponent.findMany({
    where: { templateId, deleted: false }, orderBy: { order: 'asc' },
  }) as Promise<any[]>;
}

async function employeeCounts(): Promise<Map<string, number>> {
  const members = await prisma.humanResourcesMember.findMany({
    where: { deleted: false },
  }) as any[];
  const counts = new Map<string, number>();
  for (const member of members) {
    const id = member.salaryTemplateId ? String(member.salaryTemplateId) : '';
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export async function listTemplates() {
  const [rows, counts] = await Promise.all([
    prisma.humanResourcesSalaryTemplate.findMany({
      where: { deleted: false }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    }) as Promise<any[]>,
    employeeCounts(),
  ]);
  if (!rows.length) return [];
  const components = await prisma.humanResourcesSalaryTemplateComponent.findMany({
    where: { deleted: false }, orderBy: { order: 'asc' },
  }) as any[];
  return rows.map((row) => templateJson(
    row,
    components.filter((c) => String(c.templateId) === String(row.id)),
    counts.get(String(row.id)) ?? 0,
  ));
}

export async function getTemplate(id: string) {
  const row: any = await prisma.humanResourcesSalaryTemplate.findUnique({ where: { id } });
  if (!row || row.deleted) throw new HrError('salary template not found', 404);
  const counts = await employeeCounts();
  return templateJson(row, await componentsFor(id), counts.get(id) ?? 0);
}

function componentRows(templateId: string, rows: SalaryComponentInput[]) {
  return rows.map((row) => ({ ...row, id: crypto.randomUUID(), templateId }));
}

async function clearDefault(actor: string | null) {
  await prisma.humanResourcesSalaryTemplate.updateMany({
    where: { isDefault: true }, data: { isDefault: false, updatedBy: actor },
  });
}

export async function createTemplate(input: Record<string, any>, actor: string | null) {
  const data: SalaryTemplateInput = cleanSalaryTemplate(input);
  if (data.isDefault) await clearDefault(actor);
  const row: any = await prisma.humanResourcesSalaryTemplate.create({
    data: {
      name: data.name,
      description: data.description,
      inputMode: data.inputMode,
      isDefault: data.isDefault,
      createdBy: actor,
      updatedBy: actor,
    },
  });
  await prisma.humanResourcesSalaryTemplateComponent.createMany({
    data: componentRows(String(row.id), data.components),
  });
  await invalidateHumanResourcesCache();
  return getTemplate(String(row.id));
}

export async function updateTemplate(id: string, input: Record<string, any>, actor: string | null) {
  const current: any = await prisma.humanResourcesSalaryTemplate.findUnique({ where: { id } });
  if (!current || current.deleted) throw new HrError('salary template not found', 404);
  const data: SalaryTemplateInput = cleanSalaryTemplate(input);
  if (data.isDefault) await clearDefault(actor);
  await prisma.humanResourcesSalaryTemplate.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description,
      inputMode: data.inputMode,
      isDefault: data.isDefault,
      updatedBy: actor,
    },
  });
  await prisma.humanResourcesSalaryTemplateComponent.deleteMany({ where: { templateId: id } });
  await prisma.humanResourcesSalaryTemplateComponent.createMany({
    data: componentRows(id, data.components),
  });
  await invalidateHumanResourcesCache();
  return getTemplate(id);
}

export async function deleteTemplate(id: string, actor: string | null) {
  const row: any = await prisma.humanResourcesSalaryTemplate.findUnique({ where: { id } });
  if (!row || row.deleted) throw new HrError('salary template not found', 404);
  const assigned = await prisma.humanResourcesMember.findMany({
    where: { salaryTemplateId: id, deleted: false },
  }) as any[];
  if (assigned.length) {
    throw new HrError(`template is used by ${assigned.length} employee${assigned.length === 1 ? '' : 's'}; reassign them first`);
  }
  await prisma.humanResourcesSalaryTemplate.update({
    where: { id }, data: { deleted: true, isDefault: false, updatedBy: actor },
  });
  await prisma.humanResourcesSalaryTemplateComponent.updateMany({
    where: { templateId: id }, data: { deleted: true },
  });
  await invalidateHumanResourcesCache();
  return { ok: true };
}

export async function setDefaultTemplate(id: string, actor: string | null) {
  const row: any = await prisma.humanResourcesSalaryTemplate.findUnique({ where: { id } });
  if (!row || row.deleted) throw new HrError('salary template not found', 404);
  await clearDefault(actor);
  await prisma.humanResourcesSalaryTemplate.update({
    where: { id }, data: { isDefault: true, updatedBy: actor },
  });
  await invalidateHumanResourcesCache();
  return getTemplate(id);
}

export async function previewSalary(input: Record<string, any>) {
  const inputMode = oneOf(input.inputMode ?? 'gross', SALARY_INPUT_MODES, 'inputMode') as SalaryInputMode;
  const inputAmount = positiveAmount(input.inputAmount);
  const rows = cleanSalaryTemplate({
    name: 'Preview',
    inputMode,
    components: input.components,
  }).components;
  const resolved = resolveSalary(rows, { inputMode, inputAmount });
  const deductions = round2(resolved.deductions.reduce((sum, line) => sum + line.amount, 0));
  return {
    ...resolved,
    deductionTotal: deductions,
    netPay: round2(resolved.gross - deductions),
  };
}

export function templateComponentsForCopy(template: any): SalaryComponentInput[] {
  return (template.components ?? []).map((row: any, index: number) => ({
    name: row.name,
    componentType: row.componentType,
    calcType: row.calcType,
    value: Number(row.value) || 0,
    formula: row.formula ?? null,
    code: row.code ?? null,
    cap: row.cap === null || row.cap === undefined ? null : Number(row.cap),
    floor: row.floor === null || row.floor === undefined ? null : Number(row.floor),
    isBasic: !!row.isBasic,
    order: Number(row.order ?? index),
  }));
}
