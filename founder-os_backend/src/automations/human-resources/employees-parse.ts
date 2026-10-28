import { HrError } from './errors';
import { isValidDate, nullableText, nonNegative, oneOf, text } from './parse';
import { formulaVariables, validateFormula } from './salary-formula';
import {
  COMPONENT_CALC_TYPES, COMPONENT_TYPES, EMPLOYMENT_TYPES,
  type EmployeeInput, type EmployeePatch, type SalaryComponentInput, type SalaryInputMode,
} from './types';

function optionalDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const date = String(value).slice(0, 10);
  if (!isValidDate(date)) throw new HrError(`${field} must be YYYY-MM-DD`);
  return date;
}

function optionalPercent(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new HrError('percentage must be between 0 and 100');
  return Math.round(n * 100) / 100;
}

function employeeFields(input: Record<string, any>): Omit<EmployeeInput, 'name'> {
  const employmentType = input.employmentType === undefined || input.employmentType === null || input.employmentType === ''
    ? 'full_time'
    : oneOf(input.employmentType, EMPLOYMENT_TYPES, 'employmentType');
  const aadhaar = nullableText(input.aadhaarLast4, 4);
  if (aadhaar && !/^\d{4}$/.test(aadhaar)) throw new HrError('aadhaarLast4 must be the last 4 digits');
  return {
    employeeCode: nullableText(input.employeeCode, 40),
    email: nullableText(input.email, 200),
    loginEmail: nullableText(input.loginEmail, 200),
    phone: nullableText(input.phone, 40),
    designation: nullableText(input.designation, 100),
    department: nullableText(input.department, 100),
    photoUrl: nullableText(input.photoUrl, 1000),
    joiningDate: optionalDate(input.joiningDate, 'joiningDate'),
    exitDate: optionalDate(input.exitDate, 'exitDate'),
    employmentType,
    active: input.active === undefined ? true : Boolean(input.active),
    dateOfBirth: optionalDate(input.dateOfBirth, 'dateOfBirth'),
    address: nullableText(input.address, 1000),
    emergencyContactName: nullableText(input.emergencyContactName, 120),
    emergencyContactPhone: nullableText(input.emergencyContactPhone, 40),
    pan: nullableText(input.pan, 20),
    aadhaarLast4: aadhaar,
    bankName: nullableText(input.bankName, 120),
    bankAccountNumber: nullableText(input.bankAccountNumber, 40),
    bankIfsc: nullableText(input.bankIfsc, 20),
    pfNumber: nullableText(input.pfNumber, 40),
    esiNumber: nullableText(input.esiNumber, 40),
    notes: nullableText(input.notes, 2000),
    order: Math.floor(nonNegative(input.order ?? 0, 'order', 9999)),
  };
}

export function cleanEmployeeCreate(input: Record<string, any>): EmployeeInput {
  const name = text(input.name, 200);
  if (!name) throw new HrError('name is required');
  const fields = employeeFields(input);
  if (fields.joiningDate && fields.exitDate && fields.exitDate < fields.joiningDate) {
    throw new HrError('exitDate cannot be before joiningDate');
  }
  return { name, ...fields };
}

export function cleanEmployeePatch(input: Record<string, any>): EmployeePatch {
  const out: EmployeePatch = {};
  if (input.name !== undefined) {
    const name = text(input.name, 200);
    if (!name) throw new HrError('name cannot be empty');
    out.name = name;
  }
  const fields = employeeFields(input);
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    if (input[key] !== undefined) (out as any)[key] = fields[key];
  }
  if (input.deleted !== undefined) out.deleted = Boolean(input.deleted);
  if (Object.keys(out).length === 0) throw new HrError('nothing to update');
  return out;
}

export function cleanSalaryComponents(input: unknown, inputMode?: SalaryInputMode | null): SalaryComponentInput[] {
  if (!Array.isArray(input)) throw new HrError('salaryComponents must be an array');
  if (input.length > 30) throw new HrError('too many salary components');
  const rows = input.map((raw: any, index: number) => {
    const name = text(raw?.name, 120);
    if (!name) throw new HrError('component name is required');
    const componentType = oneOf(raw?.componentType, COMPONENT_TYPES, 'componentType');
    const calcType = oneOf(raw?.calcType ?? 'fixed', COMPONENT_CALC_TYPES, 'calcType');
    if (componentType === 'deduction' && calcType === 'balance') {
      throw new HrError(`${name}: deductions cannot be balance components`);
    }
    if (componentType === 'deduction' && Boolean(raw?.isBasic)) {
      throw new HrError(`${name}: a deduction cannot be Basic`);
    }
    if (Boolean(raw?.isBasic) && componentType !== 'earning') {
      throw new HrError(`${name}: Basic must be an earning component`);
    }
    if (Boolean(raw?.isBasic) && calcType === 'balance') {
      throw new HrError(`${name}: Basic cannot be a balance component`);
    }
    const valueRaw = raw?.value;
    let value = 0;
    if (calcType === 'fixed') value = nonNegative(valueRaw, 'value');
    else if (calcType === 'percent_basic' || calcType === 'percent_gross') value = optionalPercent(valueRaw) ?? 0;
    const formula = nullableText(raw?.formula, 500);
    if (calcType === 'formula') {
      if (!formula) throw new HrError(`${name}: formula is required`);
      try { validateFormula(formula); }
      catch (e) { throw new HrError(`${name}: ${e instanceof Error ? e.message : 'invalid formula'}`); }
    }
    const codeRaw = nullableText(raw?.code, 40);
    const code = codeRaw ? codeRaw.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') : null;
    if (codeRaw && !/^[a-z][a-z0-9_]*$/.test(codeRaw.toLowerCase())) {
      throw new HrError(`${name}: code must start with a letter and use letters, numbers or underscores`);
    }
    const cap = raw?.cap === null || raw?.cap === undefined || raw?.cap === '' ? null : nonNegative(raw.cap, 'cap');
    const floor = raw?.floor === null || raw?.floor === undefined || raw?.floor === '' ? null : nonNegative(raw.floor, 'floor');
    if (cap !== null && floor !== null && cap < floor) throw new HrError(`${name}: cap cannot be below floor`);
    return {
      name,
      componentType,
      calcType,
      value: Math.round(value * 100) / 100,
      formula: calcType === 'formula' ? formula : null,
      code,
      cap,
      floor,
      isBasic: Boolean(raw?.isBasic) && componentType === 'earning',
      order: index,
    };
  });
  validateSalaryRows(rows, inputMode ?? null);
  return rows;
}

export function validateSalaryRows(rows: SalaryComponentInput[], inputMode: SalaryInputMode | null): void {
  const basics = rows.filter((r) => r.isBasic);
  if (basics.length !== 1) throw new HrError('mark exactly one earning component as Basic');
  const basic = basics[0];
  if (basic.componentType !== 'earning') throw new HrError('Basic must be an earning component');
  if (rows.some((r) => r.calcType === 'percent_basic') && !basic) {
    throw new HrError('mark one earning component as Basic for percentage components');
  }
  const codes = rows.map((r) => r.code).filter(Boolean) as string[];
  if (new Set(codes).size !== codes.length) throw new HrError('component codes must be unique');

  if (inputMode === 'basic') {
    if (basic.calcType !== 'formula' || String(basic.formula ?? '').trim() !== 'input') {
      throw new HrError('basic-input templates must set Basic formula to input');
    }
    if (rows.some((r) => r.calcType === 'balance')) throw new HrError('balance components need a gross-input template');
    for (const row of rows.filter((r) => r.componentType === 'earning' && !r.isBasic)) {
      if (row.calcType === 'percent_gross') throw new HrError(`${row.name}: gross-based earnings need a gross-input template`);
      if (row.calcType === 'formula' && formulaVariables(String(row.formula ?? '')).has('gross')) {
        throw new HrError(`${row.name}: formula cannot use gross in a basic-input template`);
      }
    }
  }

  if (inputMode === 'gross') {
    if (basic.calcType === 'percent_basic') throw new HrError('Basic cannot be a percentage of Basic');
    if (basic.calcType === 'formula' && formulaVariables(String(basic.formula ?? '')).has('basic')) {
      throw new HrError('Basic formula cannot reference Basic');
    }
    const balances = rows.filter((r) => r.calcType === 'balance');
    if (balances.length !== 1) throw new HrError('gross-input templates need exactly one balance earning component');
    if (balances[0].componentType !== 'earning') throw new HrError('the balance component must be an earning');
  }
}
