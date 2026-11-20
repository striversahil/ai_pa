// Push targets: one selection/assignment pipeline, two destinations.
//   neodove → NeoDove agent campaign URLs (send loop in io.ts)
//   dialer  → Founder OS dialer queues (modules/dialer), delivered at creation
import type { AssignedLead, PushTarget } from "../types";
import type { ResolvedAgent } from "./types";
import { listDialerAgents, listDialerTeamLeads, markSkippedLeads } from "../store-parts/dialer-target";
import { markOutcomes, recountBatch, updateBatch } from "../store";

export function normalizeTarget(raw: unknown): PushTarget {
  return String(raw ?? '').trim().toLowerCase() === 'dialer' ? 'dialer' : 'neodove';
}

/** Dialer destinations shaped like NeoDove agents so selection + preview are shared. */
export async function resolveDialerTargets(region: string): Promise<{ agents: ResolvedAgent[]; teamLeads: ResolvedAgent[] }> {
  const [agents, tls] = await Promise.all([listDialerAgents(region), listDialerTeamLeads()]);
  return {
    agents: agents.map((a) => ({ ...a, url: '' })),
    teamLeads: tls.map((a) => ({ ...a, url: '' })),
  };
}

/**
 * Deliver a dialer batch: every assigned lead goes into its agent's queue, a
 * number already waiting for that agent is skipped (never duplicated), and the
 * ledger rows are marked so history and tallies read exactly like NeoDove.
 */
export async function deliverToDialer(batchId: string, assigned: AssignedLead[]): Promise<void> {
  const { enqueueLeads } = await import("../../dialer/queue");
  const { getD1Database } = await import("../../../shared/prisma-d1");
  const db: any = getD1Database();
  const { queued, duplicates } = await enqueueLeads(db, assigned.map(({ lead, agentKey }) => ({
    ref: `${batchId}:${lead.customerId}`,
    telecallerId: agentKey,
    customerId: lead.customerId,
    mobile: lead.mobile,
    name: lead.name,
    batchId,
  })));
  await markOutcomes(queued.map((id) => ({ id, ok: true, httpStatus: 200, body: 'queued' })));
  await markSkippedLeads(duplicates, 'already_queued');
  await recountBatch(batchId);
  const now = new Date().toISOString();
  await updateBatch(batchId, { status: 'done', finishedAt: now, updatedAt: now });
}
