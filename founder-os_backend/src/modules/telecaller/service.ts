/**
 * Telecaller roster management (shared by the Express + Worker runtimes).
 * The roster is the source of truth for estimate auto-assignment.
 */
import { prisma } from '../../shared/prisma';
import { mirrorRosterRemoved, mirrorRosterRow } from '../core/sync';

export interface TelecallerInput {
  name: string;
  email?: string | null;
  assignEstimateFollowUps?: boolean;
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
  const row = await prisma.telecaller.create({
    data: {
      name: input.name.trim(),
      email: input.email ?? null,
      assignEstimateFollowUps: input.assignEstimateFollowUps ?? true,
      order: input.order ?? 0,
      neodoveUserId: input.neodoveUserId ?? null,
      neodoveUserName: input.neodoveUserName ?? null,
    },
  });
  await mirrorRosterRow('telecaller', row);
  return row;
}

export async function updateTelecaller(id: string, input: Partial<TelecallerInput>): Promise<any> {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.email !== undefined) data.email = input.email;
  if (input.assignEstimateFollowUps !== undefined) data.assignEstimateFollowUps = input.assignEstimateFollowUps;
  if (input.order !== undefined) data.order = input.order;
  if (input.neodoveUserId !== undefined) data.neodoveUserId = input.neodoveUserId;
  if (input.neodoveUserName !== undefined) data.neodoveUserName = input.neodoveUserName;
  const row = await prisma.telecaller.update({ where: { id }, data });
  await mirrorRosterRow('telecaller', row);
  return row;
}

export async function deleteTelecaller(id: string): Promise<void> {
  await prisma.telecaller.delete({ where: { id } });
  await mirrorRosterRemoved('telecaller', id);
}
