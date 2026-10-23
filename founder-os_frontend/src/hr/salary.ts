import type { HrSalaryComponent, SalaryInputMode } from "./types";
import { evaluateFormula, formulaVariables } from "./salary-formula";

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

function rowsFor(components: HrSalaryComponent[]): HrSalaryComponent[] {
  return (components || [])
    .filter((c) => !c.deleted)
    .slice()
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
}

function applyBounds(row: HrSalaryComponent, amount: number): number {
  let value = Number(amount) || 0;
  if (row.floor !== null && row.floor !== undefined) value = Math.max(value, Number(row.floor) || 0);
  if (row.cap !== null && row.cap !== undefined) value = Math.min(value, Number(row.cap) || 0);
  return round2(value);
}

function vars(input: number, basic: number, gross: number): Record<string, number> {
  return { input, basic, gross };
}

function evaluateRow(row: HrSalaryComponent, values: Record<string, number>): number {
  const calcType = String(row.calcType ?? "fixed");
  let amount: number;
  if (calcType === "fixed") amount = Number(row.value) || 0;
  else if (calcType === "percent_basic") amount = values.basic * (Number(row.value) || 0) / 100;
  else if (calcType === "percent_gross") amount = values.gross * (Number(row.value) || 0) / 100;
  else if (calcType === "formula") {
    const formula = String(row.formula ?? "").trim();
    if (!formula) throw new Error(`${row.name}: formula is empty`);
    try { amount = evaluateFormula(formula, values); }
    catch (e) { throw new Error(`${row.name}: ${e instanceof Error ? e.message : "invalid formula"}`); }
  } else if (calcType === "balance") {
    throw new Error(`${row.name}: balance components are resolved separately`);
  } else {
    throw new Error(`${row.name}: unknown calculation type '${calcType}'`);
  }
  const bounded = applyBounds(row, amount);
  if (bounded < 0) throw new Error(`${row.name}: formula produced a negative amount`);
  return bounded;
}

function validateBasicModeEarnings(rows: HrSalaryComponent[]): void {
  for (const row of rows) {
    if (row.componentType !== "earning" || row.isBasic) continue;
    if (row.calcType === "percent_gross") throw new Error(`${row.name}: gross-based earnings need a gross-input template`);
    if (row.calcType === "formula" && formulaVariables(String(row.formula ?? "")).has("gross")) {
      throw new Error(`${row.name}: formula cannot use gross in a basic-input template`);
    }
  }
}

function legacyResolve(rows: HrSalaryComponent[]): ResolvedSalary {
  const basicRow = rows.find((c) => c.isBasic && c.componentType === "earning");
  if (!basicRow && rows.some((c) => c.calcType === "percent_basic")) {
    throw new Error("mark one earning component as Basic for percentage components");
  }
  let basic = 0;
  if (basicRow) {
    if (basicRow.calcType !== "fixed") throw new Error("Basic must be a fixed amount");
    basic = applyBounds(basicRow, Number(basicRow.value) || 0);
  }
  const earnings: ResolvedLine[] = [];
  for (const row of rows.filter((c) => c.componentType === "earning")) {
    if (row === basicRow) {
      earnings.push({ name: row.name, code: row.code ?? null, amount: basic });
      continue;
    }
    if (row.calcType === "formula" || row.calcType === "balance" || row.calcType === "percent_gross") {
      throw new Error(`${row.name}: open the employee salary plan and enter an amount`);
    }
    earnings.push({ name: row.name, code: row.code ?? null, amount: evaluateRow(row, vars(0, basic, 0)) });
  }
  const gross = round2(earnings.reduce((sum, line) => sum + line.amount, 0));
  const deductions: ResolvedLine[] = [];
  for (const row of rows.filter((c) => c.componentType === "deduction")) {
    if (row.calcType === "balance") throw new Error(`${row.name}: deductions cannot be balance components`);
    deductions.push({ name: row.name, code: row.code ?? null, amount: evaluateRow(row, vars(0, basic, gross)) });
  }
  return { earnings, deductions, basic: round2(basic), gross, inputMode: null, inputAmount: null, targetGross: null };
}

export function resolveSalary(components: HrSalaryComponent[], options: SalaryStructureOptions = {}): ResolvedSalary {
  const rows = rowsFor(components);
  const mode = options.inputMode === "basic" ? "basic" : options.inputMode === "gross" ? "gross" : null;
  const inputAmount = Number(options.inputAmount) || 0;
  if (!mode || inputAmount <= 0) return legacyResolve(rows);

  const basicRow = rows.find((c) => c.isBasic && c.componentType === "earning");
  if (!basicRow) throw new Error("salary structure needs a Basic earning component");
  if (mode === "basic") validateBasicModeEarnings(rows);

  let basic: number;
  if (mode === "basic") basic = applyBounds(basicRow, inputAmount);
  else {
    if (basicRow.calcType === "balance") throw new Error("Basic cannot be a balance component");
    if (basicRow.calcType === "percent_basic") throw new Error("Basic cannot be a percentage of Basic");
    if (basicRow.calcType === "formula" && formulaVariables(String(basicRow.formula ?? "")).has("basic")) {
      throw new Error("Basic formula cannot reference Basic");
    }
    basic = evaluateRow(basicRow, vars(inputAmount, 0, inputAmount));
  }
  if (basic <= 0) throw new Error("Basic must be greater than zero");

  const nonBasicEarnings = rows.filter((c) => c.componentType === "earning" && c !== basicRow);
  const balanceRows = nonBasicEarnings.filter((c) => c.calcType === "balance");
  if (mode === "basic" && balanceRows.length) throw new Error("balance components need a gross-input template");
  if (mode === "gross" && balanceRows.length > 1) throw new Error("only one balance component is allowed");

  const earnings: ResolvedLine[] = [{ name: basicRow.name, code: basicRow.code ?? null, amount: basic }];
  let grossSoFar = basic;
  for (const row of nonBasicEarnings) {
    if (row.calcType === "balance") continue;
    const amount = evaluateRow(row, vars(inputAmount, basic, mode === "gross" ? inputAmount : 0));
    earnings.push({ name: row.name, code: row.code ?? null, amount });
    grossSoFar = round2(grossSoFar + amount);
  }

  let gross: number;
  if (mode === "gross") {
    gross = round2(inputAmount);
    if (balanceRows.length === 1) {
      const balance = applyBounds(balanceRows[0], gross - grossSoFar);
      if (balance < 0) throw new Error(`${balanceRows[0].name} is negative: components exceed the entered gross`);
      earnings.push({ name: balanceRows[0].name, code: balanceRows[0].code ?? null, amount: balance });
      grossSoFar = round2(grossSoFar + balance);
    }
    if (Math.abs(grossSoFar - gross) > 0.05) {
      throw new Error("salary components do not add up to the entered gross; add a balance component");
    }
    gross = grossSoFar;
  } else {
    gross = grossSoFar;
  }

  const deductions: ResolvedLine[] = [];
  for (const row of rows.filter((c) => c.componentType === "deduction")) {
    if (row.calcType === "balance") throw new Error(`${row.name}: deductions cannot be balance components`);
    deductions.push({ name: row.name, code: row.code ?? null, amount: evaluateRow(row, vars(inputAmount, basic, gross)) });
  }

  return {
    earnings,
    deductions,
    basic: round2(basic),
    gross: round2(gross),
    inputMode: mode,
    inputAmount: round2(inputAmount),
    targetGross: mode === "gross" ? round2(inputAmount) : null,
  };
}
