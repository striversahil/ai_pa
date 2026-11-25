// Data loaders for the display-name rules (see ./employee-name.ts).
// Kept separate so the pure formatter stays framework-free.
import { prisma } from './prisma';
import {
  buildDisplayNameIndex,
  buildEmployeeNameIndex,
  type AuthNameFields,
  type DisplayNameIndex,
  type EmployeeEmailFields,
  type EmployeeNameFields,
} from './employee-name';

const EMPLOYEE_SELECT = {
  name: true, characterName: true, useCharacterName: true, email: true, loginEmail: true,
} as const;

/** HR members only — enough for sales/leaderboard email resolution. */
export async function loadEmployeeNameIndex(): Promise<Map<string, EmployeeNameFields>> {
  const rows = (await prisma.humanResourcesMember.findMany({
    where: { deleted: false },
    select: EMPLOYEE_SELECT,
  })) as EmployeeEmailFields[];
  return buildEmployeeNameIndex(rows);
}

/** HR members + auth users — chat names and free-text audit labels. */
/**
 * Auth rows are raw D1 (`auth_user`) in the Worker, where the Prisma shim has
 * no `authUser` model. Try the raw table first, then the Express Prisma model;
 * either may be absent. Never let a missing auth table break an HR read.
 */
async function loadAuthNameRows(): Promise<AuthNameFields[]> {
  try {
    const raw = (prisma as any).$queryRawUnsafe;
    if (typeof raw === 'function') {
      const rows = await raw.call(prisma, 'SELECT id, name, email, displayName FROM auth_user');
      if (Array.isArray(rows)) return rows as AuthNameFields[];
    }
  } catch { /* Worker path may not have the raw table in minimal DBs */ }
  try {
    const model = (prisma as any).authUser;
    if (model?.findMany) {
      return await model.findMany({ select: { id: true, name: true, email: true, displayName: true } });
    }
  } catch { /* auth table unavailable */ }
  return [];
}

/** HR members + auth users — chat names and free-text audit labels. */
export async function loadDisplayNameIndex(): Promise<DisplayNameIndex> {
  const [employees, users] = await Promise.all([
    prisma.humanResourcesMember.findMany({
      where: { deleted: false },
      select: EMPLOYEE_SELECT,
    }) as Promise<EmployeeEmailFields[]>,
    loadAuthNameRows(),
  ]);
  return buildDisplayNameIndex(employees, users);
}
