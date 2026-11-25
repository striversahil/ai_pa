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
export async function loadDisplayNameIndex(): Promise<DisplayNameIndex> {
  const [employees, users] = await Promise.all([
    prisma.humanResourcesMember.findMany({
      where: { deleted: false },
      select: EMPLOYEE_SELECT,
    }) as Promise<EmployeeEmailFields[]>,
    (prisma as any).authUser.findMany({
      select: { id: true, name: true, email: true, displayName: true },
    }).catch(() => []) as Promise<AuthNameFields[]>,
  ]);
  return buildDisplayNameIndex(employees, users);
}
