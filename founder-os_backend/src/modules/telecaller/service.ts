/**
 * Telecaller roster management (shared by the Express + Worker runtimes).
 * The roster is the source of truth for estimate auto-assignment.
 */
import { prisma } from '../../shared/prisma';

export interface TelecallerInput {
  name: string;
  email?: string | null;
  active?: boolean;
  order?: number;
  neodoveUserId?: string | null;
  neodoveUserName?: string | null;
}

export async function listTelecallers(): Promise<any[]> {
  const tcs = await prisma.telecaller.findMany({ orderBy: { order: 'asc' } });
  return Promise.all(
    tcs.map(async (t: any) => {
      const [totalAssigned, activeAssigned] = await Promise.all([
        prisma.estimateAssignment.count({ where: { telecallerId: t.id } }),
        prisma.estimateAssignment.count({ where: { telecallerId: t.id, status: 'assigned' } }),
      ]);
      return { ...t, totalAssigned, activeAssigned };
    }),
  );
}

export async function createTelecaller(input: TelecallerInput): Promise<any> {
  if (!input.name || !input.name.trim()) {
    throw new Error('name is required');
  }
  return prisma.telecaller.create({
    data: {
      name: input.name.trim(),
      email: input.email ?? null,
      active: input.active ?? true,
      order: input.order ?? 0,
      neodoveUserId: input.neodoveUserId ?? null,
      neodoveUserName: input.neodoveUserName ?? null,
    },
  });
}

export async function updateTelecaller(id: string, input: Partial<TelecallerInput>): Promise<any> {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.email !== undefined) data.email = input.email;
  if (input.active !== undefined) data.active = input.active;
  if (input.order !== undefined) data.order = input.order;
  if (input.neodoveUserId !== undefined) data.neodoveUserId = input.neodoveUserId;
  if (input.neodoveUserName !== undefined) data.neodoveUserName = input.neodoveUserName;
  return prisma.telecaller.update({ where: { id }, data });
}

export async function deleteTelecaller(id: string): Promise<void> {
  await prisma.telecaller.delete({ where: { id } });
}
