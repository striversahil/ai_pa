// rotation.ts — assignment history-chain writer.
//
// Region model (founder, 2026-10-22): estimates are owned by REGIONS, not
// individuals — the dealing engines (round-robin, best-fit, MIS bulk moves,
// absent covers, EOD re-poaching) are retired. Kept: getFollowUpSpecialists
// (the conversion-specialist pool closure-list reader) and recordAssignment
// (the EstimateAssignment history-chain writer, used by legacy tooling).
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import type { Telecaller } from '@prisma/client';
import { istDate } from './util';

// The conversion-specialist pool: only telecallers flagged to hold estimate
// follow-ups receive assignments (new deals + EOD re-poaching). Everyone else
// still generates leads but never holds estimates.
export async function getFollowUpSpecialists(): Promise<Telecaller[]> {
  return prisma.telecaller.findMany({ where: { assignEstimateFollowUps: true, deleted: false, absentSince: null }, orderBy: { order: 'asc' } });
}

/**
 * Record an assignment into the EstimateAssignment chain (single source of truth
 * for fair close-credit). Resolves the previous open row first (if any), then
 * inserts the new holder linked via reassignedFromId. `snatchReason` (why the
 * previous holder lost it at EOD) is persisted so the losing agent sees exactly
 * what cost them the deal.
 */
export async function recordAssignment(estimateId: string, telecallerId: string, snatchReason: string | null = null, tempForTelecallerId?: string | null): Promise<void> {
  try {
    const current = await prisma.estimateAssignment.findFirst({
      where: { estimateId, status: 'assigned' },
      orderBy: { assignedAt: 'desc' },
    });
    let reassignedFromId: string | null = null;
    if (current) {
      await prisma.estimateAssignment.update({ where: { id: current.id }, data: { status: 'resolved' } });
      reassignedFromId = current.id;
    }
    await prisma.estimateAssignment.create({
      data: {
        estimateId, telecallerId, assignedAt: new Date(), day: istDate(), reassignedFromId, status: 'assigned',
        snatchReason,
        // Absentee-cover provenance: a temp-covered estimate that is re-poached
        // at EOD carries the ORIGINAL absent agent's id forward so it still
        // returns to her when she is marked present. Pass undefined to
        // auto-carry from the resolved row; pass null to explicitly clear
        // (e.g. when the estimate returns to the original holder).
        tempForTelecallerId: tempForTelecallerId === undefined
          ? (((current as any)?.tempForTelecallerId as string | undefined) ?? null)
          : tempForTelecallerId,
      },
    });
  } catch (e: any) {
    logger.warn({ err: e?.message, estimateId }, 'recordAssignment failed — continuing without history');
  }
}
