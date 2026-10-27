import { prisma } from '../../shared/prisma';
import { HrError } from './errors';

export const EMPLOYEE_CODE_PREFIX = 'BUI-';
const MAX_CREATE_ATTEMPTS = 5;

export function formatEmployeeCode(value: number): string {
  return `${EMPLOYEE_CODE_PREFIX}${String(value).padStart(3, '0')}`;
}

export function employeeCodeNumber(code: unknown): number {
  const match = new RegExp(`^${EMPLOYEE_CODE_PREFIX}(\\d+)$`, 'i').exec(String(code ?? '').trim());
  return match ? Number(match[1]) : 0;
}

export async function nextEmployeeCode(): Promise<string> {
  const rows = await prisma.humanResourcesMember.findMany({
    where: { employeeCode: { startsWith: EMPLOYEE_CODE_PREFIX } },
    select: { employeeCode: true },
  }) as any[];
  const max = rows.reduce((value, row) => Math.max(value, employeeCodeNumber(row.employeeCode)), 0);
  return formatEmployeeCode(max + 1);
}

export function isEmployeeCodeConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique|constraint/i.test(message) && /employeeCode/i.test(message);
}

export async function createWithEmployeeCode<T>(create: (employeeCode: string) => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    try {
      return await create(await nextEmployeeCode());
    } catch (error) {
      if (!isEmployeeCodeConflict(error)) throw error;
      lastError = error;
    }
  }
  throw new HrError(
    `could not generate a unique employee code${lastError instanceof Error ? `: ${lastError.message}` : ''}`,
  );
}
