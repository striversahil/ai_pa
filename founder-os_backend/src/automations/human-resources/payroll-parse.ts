import { HrError } from './errors';
import { nullableText, nonNegative, text } from './parse';
import type { PayrollLine, PayrollLinesPatch } from './types';

function cleanLines(input: unknown): PayrollLine[] {
  if (!Array.isArray(input)) throw new HrError('lines must be an array');
  if (input.length > 50) throw new HrError('too many payroll lines');
  return input.map((raw: any) => {
    const name = text(raw?.name, 120);
    if (!name) throw new HrError('line name is required');
    return { name, amount: Math.round(nonNegative(raw?.amount, 'amount') * 100) / 100 };
  });
}

export function cleanPayrollLinesPatch(raw: Record<string, any>): PayrollLinesPatch {
  const out: PayrollLinesPatch = {};
  if (raw.earnings !== undefined) out.earnings = cleanLines(raw.earnings);
  if (raw.deductions !== undefined) out.deductions = cleanLines(raw.deductions);
  if (raw.notes !== undefined) out.notes = nullableText(raw.notes, 2000);
  if (Object.keys(out).length === 0) throw new HrError('nothing to update');
  return out;
}
