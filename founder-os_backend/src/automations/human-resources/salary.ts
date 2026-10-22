import { HrError } from './errors';
import type { SalaryComponentInput, SalaryInputMode } from './types';
import { evaluateFormula, formulaVariables } from './salary-formula';

export function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export interface ResolvedLine {
  name: string;
  code: string | null;
  amount: number;
}

export interface ResolvedSalary {
  earnings: ResolvedLine[];
  deductions: ResolvedLine[];
  basic: number;
  gross: number;
  inputMode: SalaryInputMode | null;
  inputAmount: number | null;
  targetGross: number | null;
}

export interface SalaryStructureOptions {
  inputMode?: string | null;
  inputAmount?: number | null;
}

function rowsFor(components: any[]): any[] {
  return (components || [])
    .filter((c) => !c.deleted)
    .slice()
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
}

function applyBounds(row: any, amount: number): number {
  let value = Number(amount) || 0;
  if (row.floor !== null && row.floor !== undefined) value = Math.max(value, Number(row.floor) || 0);
  if (row.cap !== null && row.cap !== undefined) value = Math.min(value, Number(row.cap) || 0);
  return round2(value);
}

function formulaVars(input: number, basic: number, gross: number): Record<string, number> {
  return { input, basic, gross };
}

function evaluateRow(row: any, vars: Record<string, number>): number {
  const calcType = String(row.calcType ?? 'fixed');
  let amount: number;
  if (calcType === 'fixed') amount = Number(row.value) || 0;
  else if (calcType === 'percent_basic') amount = vars.basic * (Number(row.value) || 0) / 100;
  else if (calcType === 'percent_gross') amount = vars.gross * (Number(row.value) || 0) / 100;
  else if (calcType === 'formula') {
    const formula = String(row.formula ?? '').trim();
    if (!formula) throw new HrError(`${row.name}: formula is empty`);
    try { amount = evaluateFormula(formula, vars); }
    catch (e) { throw new HrError(`${row.name}: ${e instanceof Error ? e.message : 'invalid formula'}`); }
  } else if (calcType === 'balance') {
    throw new HrError(`${row.name}: balance components are resolved separately`);
  } else {
    throw new HrError(`${row.name}: unknown calculation type '${calcType}'`);
  }
  const bounded = applyBounds(row, amount);
  if (bounded < 0) throw new HrError(`${row.name}: formula produced a negative amount`);
  return bounded;
}

function validateBasicModeEarnings(rows: any[]): void {
  for (const row of rows) {
    if (row.componentType !== 'earning' || row.isBasic) continue;
    if (row.calcType === 'percent_gross') {
      throw new HrError(`${row.name}: gross-based earnings need a gross-input template`);
    }
    if (row.calcType === 'formula' && formulaVariables(String(row.formula ?? '')).has('gross')) {
      throw new HrError(`${row.name}: formula cannot use gross in a basic-input template`);
    }
  }
}

function legacyResolve(rows: any[]): ResolvedSalary {
  const basicRow = rows.find((c) => c.isBasic && c.componentType === 'earning');
  if (!basicRow && rows.some((c) => c.calcType === 'percent_basic')) {
    throw new HrError('mark one earning component as Basic for percentage components');
  }
  let basic = 0;
  if (basicRow) {
    if (basicRow.calcType !== 'fixed') throw new HrError('Basic must be a fixed amount');
    basic = applyBounds(basicRow, Number(basicRow.value) || 0);
  }
  const earnings: ResolvedLine[] = [];
  for (const row of rows.filter((c) => c.componentType === 'earning')) {
    if (row === basicRow) {
      earnings.push({ name: String(row.name), code: row.code ?? null, amount: basic });
      continue;
    }
    if (row.calcType === 'formula' || row.calcType === 'balance' || row.calcType === 'percent_gross') {
      throw new HrError(`${row.name}: open the employee salary plan and enter an amount`);
    }
    earnings.push({ name: String(row.name), code: row.code ?? null, amount: evaluateRow(row, formulaVars(0, basic, 0)) });
  }
  const gross = round2(earnings.reduce((sum, line) => sum + line.amount, 0));
  const deductions: ResolvedLine[] = [];
  for (const row of rows.filter((c) => c.componentType === 'deduction')) {
    if (row.calcType === 'balance') throw new HrError(`${row.name}: deductions cannot be balance components`);
    deductions.push({ name: String(row.name), code: row.code ?? null, amount: evaluateRow(row, formulaVars(0, basic, gross)) });
  }
  return { earnings, deductions, basic: round2(basic), gross, inputMode: null, inputAmount: null, targetGross: null };
}

export function resolveSalary(components: any[], options: SalaryStructureOptions = {}): ResolvedSalary {
  const rows = rowsFor(components);
  const mode = options.inputMode === 'basic' ? 'basic' : options.inputMode === 'gross' ? 'gross' : null;
  const inputAmount = Number(options.inputAmount) || 0;
  if (!mode || inputAmount <= 0) return legacyResolve(rows);

  const basicRow = rows.find((c) => c.isBasic && c.componentType === 'earning');
  if (!basicRow) throw new HrError('salary structure needs a Basic earning component');
  if (basicRow.componentType === 'deduction') throw new HrError('Basic must be an earning component');
  if (mode === 'basic') validateBasicModeEarnings(rows);

  let basic: number;
  if (mode === 'basic') basic = applyBounds(basicRow, inputAmount);
  else {
    if (basicRow.calcType === 'balance') throw new HrError('Basic cannot be a balance component');
    if (basicRow.calcType === 'percent_basic') throw new HrError('Basic cannot be a percentage of Basic');
    if (basicRow.calcType === 'formula' && formulaVariables(String(basicRow.formula ?? '')).has('basic')) {
      throw new HrError('Basic formula cannot reference Basic');
    }
    basic = evaluateRow(basicRow, formulaVars(inputAmount, 0, inputAmount));
  }
  if (basic <= 0) throw new HrError('Basic must be greater than zero');

  const nonBasicEarnings = rows.filter((c) => c.componentType === 'earning' && c !== basicRow);
  const balanceRows = nonBasicEarnings.filter((c) => c.calcType === 'balance');
  if (mode === 'basic' && balanceRows.length) throw new HrError('balance components need a gross-input template');
  if (mode === 'gross' && balanceRows.length > 1) throw new HrError('only one balance component is allowed');

  const earnings: ResolvedLine[] = [{
    name: String(basicRow.name), code: basicRow.code ?? null, amount: basic,
  }];
  let grossSoFar = basic;
  for (const row of nonBasicEarnings) {
    if (row.calcType === 'balance') continue;
    const amount = evaluateRow(row, formulaVars(inputAmount, basic, mode === 'gross' ? inputAmount : 0));
    earnings.push({ name: String(row.name), code: row.code ?? null, amount });
    grossSoFar = round2(grossSoFar + amount);
  }

  let gross: number;
  if (mode === 'gross') {
    gross = round2(inputAmount);
    if (balanceRows.length === 1) {
      const balance = applyBounds(balanceRows[0], gross - grossSoFar);
      if (balance < 0) throw new HrError(`${balanceRows[0].name} is negative: components exceed the entered gross`);
      earnings.push({ name: String(balanceRows[0].name), code: balanceRows[0].code ?? null, amount: balance });
      grossSoFar = round2(grossSoFar + balance);
    }
    if (Math.abs(grossSoFar - gross) > 0.05) {
      throw new HrError('salary components do not add up to the entered gross; add a balance component');
    }
    gross = grossSoFar;
  } else {
    gross = grossSoFar;
  }

  const deductions: ResolvedLine[] = [];
  for (const row of rows.filter((c) => c.componentType === 'deduction')) {
    if (row.calcType === 'balance') throw new HrError(`${row.name}: deductions cannot be balance components`);
    deductions.push({ name: String(row.name), code: row.code ?? null, amount: evaluateRow(row, formulaVars(inputAmount, basic, gross)) });
  }

  return {
    earnings,
    deductions,
    basic: round2(basic),
    gross: round2(gross),
    inputMode: mode,
    inputAmount: round2(inputAmount),
    targetGross: mode === 'gross' ? round2(inputAmount) : null,
  };
}

export function componentRowsForSave(memberId: string, rows: SalaryComponentInput[]) {
  return rows.map((row) => ({ ...row, memberId }));
}
