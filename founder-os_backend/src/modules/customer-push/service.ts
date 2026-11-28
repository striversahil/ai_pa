// service.ts — Customer push orchestration: pick a region's customers, preview
// the exact queue, land one batch in the auto dialer.
//
// The only destination is the Founder OS auto dialer (modules/dialer): a push
// writes DialerQueue rows and records them in the push ledger. Nothing here
// edits core_customer.
import type {
  Actor, AssignedLead, CampaignAgent, CampaignAgentPlan, CampaignPreview,
  CampaignLead, DistrictCount, Distribution, PushBatch, SkippedLead, StateCount,
} from './types';
import { assignAgents, maskMobile, selectLeads } from './selection';
import {
  PushError, newId, normalizeAgentKey, normalizeClientType, normalizeDistribution,
  normalizeDistrict, normalizeRegion, normalizeState,
} from './pure';
import {
  getBatch, insertBatch, insertLeadRows, lastDistrictPushes, lastLivePushes,
  listBatches, listCustomersByState, listDialerAgents, listDialerTeamLeads,
  listDistrictCounts, listStateCounts, listTypeCounts, markOutcomes, markSkipped,
  pushDb, recountBatch, updateBatch,
} from './store';
import { enqueueLeads } from '../dialer/queue';

const SAMPLE_SIZE = 8;
const BATCH_LIMIT_MAX = 50;

export interface StatesPayload {
  region: string;
  clientType: string;
  agents: CampaignAgent[];
  teamLeads: CampaignAgent[];
  states: StateCount[];
  types: Array<{ base: string; total: number; withPhone: number }>;
}

/** Who receives this push. `single` names one agent (pair member or TL);
 *  `split` uses the region pair ONLY (a third bucket would reshuffle every
 *  re-push — see selection.assignAgents). */
export function participantsFor(
  agents: CampaignAgent[],
  teamLeads: CampaignAgent[],
  distribution: Distribution,
  agentKey: unknown,
): CampaignAgent[] {
  if (distribution === 'single') {
    const key = normalizeAgentKey(agentKey);
    if (!key) throw new PushError('Pick one agent for a single-agent push');
    const found = agents.find((a) => a.key === key) ?? teamLeads.find((a) => a.key === key);
    if (!found) throw new PushError(`unknown agent for this region: ${key}`);
    return [found];
  }
  return agents;
}

/** Region tab: agents, Team Leads, state coverage and client-type families. */
export async function getCustomerPushStates(regionRaw: unknown, clientTypeRaw: unknown): Promise<StatesPayload> {
  const region = normalizeRegion(regionRaw);
  const clientType = normalizeClientType(clientTypeRaw);
  const [agents, teamLeads, states, types, lastPushed] = await Promise.all([
    listDialerAgents(region),
    listDialerTeamLeads(),
    listStateCounts(region, clientType),
    listTypeCounts(region),
    lastLivePushes(region, clientType),
  ]);
  return {
    region, clientType, agents, teamLeads, types,
    states: states.map((s) => ({
      ...s,
      lastPushedAt: lastPushed.get(s.state)?.at ?? null,
      lastPushedCount: lastPushed.get(s.state)?.count ?? 0,
    })),
  };
}

/** District drill-down inside one state ('' district = whole state). */
export async function getCustomerPushDistricts(
  regionRaw: unknown,
  stateRaw: unknown,
  clientTypeRaw: unknown,
): Promise<{ region: string; state: string; districts: DistrictCount[] }> {
  const region = normalizeRegion(regionRaw);
  const state = normalizeState(stateRaw);
  const clientType = normalizeClientType(clientTypeRaw);
  const [districts, lastPushed] = await Promise.all([
    listDistrictCounts(region, state, clientType),
    lastDistrictPushes(region, state, clientType),
  ]);
  return {
    region, state,
    districts: districts.map((d) => ({
      ...d,
      lastPushedAt: lastPushed.get(d.district)?.at ?? null,
      lastPushedCount: lastPushed.get(d.district)?.count ?? 0,
    })),
  };
}

interface Selection {
  region: string;
  state: string;
  district: string;
  clientType: string;
  distribution: Distribution;
  leads: CampaignLead[];
  skipped: SkippedLead[];
  assigned: AssignedLead[];
  agents: CampaignAgentPlan[];
}

/** Shared resolution for the preview and the write (never two selectors). */
async function resolveSelection(input: {
  region: unknown; state: unknown; district: unknown; clientType: unknown;
  distribution: unknown; agentKey: unknown;
}): Promise<Selection & { participants: CampaignAgent[] }> {
  const region = normalizeRegion(input.region);
  const state = normalizeState(input.state);
  const district = normalizeDistrict(input.district);
  const clientType = normalizeClientType(input.clientType);
  const distribution = normalizeDistribution(input.distribution);

  const [agents, teamLeads, rows] = await Promise.all([
    listDialerAgents(region),
    listDialerTeamLeads(),
    listCustomersByState(region, state, clientType, district),
  ]);
  const { leads, skipped } = selectLeads(rows, region, state);
  const participants = participantsFor(agents, teamLeads, distribution, input.agentKey);
  if (participants.length === 0) {
    throw new PushError(`No telecallers are seated in ${region} yet`, 409);
  }
  const assigned = assignAgents(leads, distribution, participants.map((p) => p.key));
  const planned = new Map<string, number>();
  for (const item of assigned) planned.set(item.agentKey, (planned.get(item.agentKey) ?? 0) + 1);
  return {
    region, state, district, clientType, distribution, leads, skipped, assigned, participants,
    agents: participants.map((p) => ({ ...p, planned: planned.get(p.key) ?? 0 })),
  };
}

/** Exact queue the push would land — counts only, never full phone numbers. */
export async function getCustomerPushPreview(input: {
  region: unknown; state: unknown; district: unknown; clientType: unknown;
  distribution: unknown; agentKey: unknown;
}): Promise<CampaignPreview> {
  const resolved = await resolveSelection(input);
  return {
    region: resolved.region,
    state: resolved.state,
    district: resolved.district,
    clientType: resolved.clientType,
    total: resolved.leads.length + resolved.skipped.length,
    ready: resolved.leads.length,
    skipped: resolved.skipped,
    sample: resolved.leads.slice(0, SAMPLE_SIZE).map((lead) => ({
      name: lead.name,
      mobileMasked: maskMobile(lead.mobile),
      email: lead.email,
    })),
    agents: resolved.agents,
    distribution: resolved.distribution,
  };
}

/**
 * Land one push: ledger rows first (so history survives a delivery failure),
 * then the dialer queue. Already-waiting numbers are skipped, never repeated.
 */
export async function createCustomerPush(input: {
  region: unknown; state: unknown; district: unknown; clientType: unknown;
  distribution: unknown; agentKey: unknown;
}, actor: Actor): Promise<PushBatch> {
  const resolved = await resolveSelection(input);
  if (resolved.leads.length === 0) {
    throw new PushError(`No customer in ${resolved.state} has a usable phone number`, 409);
  }

  const now = new Date().toISOString();
  const batch: PushBatch = {
    id: newId('cp'),
    region: resolved.region,
    state: resolved.state,
    district: resolved.district,
    clientType: resolved.clientType,
    mode: 'live',
    status: 'queued',
    total: resolved.leads.length + resolved.skipped.length,
    planned: resolved.leads.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    pending: resolved.leads.length,
    distribution: resolved.distribution,
    agentKey: resolved.distribution === 'single' ? resolved.participants[0]?.key ?? '' : '',
    requestedBy: actor.id,
    requestedByName: actor.name,
    campaignHost: 'Founder OS dialer',
    detail1: resolved.state,
    error: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    target: 'dialer',
  };
  await insertBatch(batch);
  await insertLeadRows(batch.id, resolved.region, resolved.state, resolved.assigned, resolved.skipped);

  try {
    await deliverToDialer(batch.id, resolved.assigned);
  } catch (e: any) {
    const failedAt = new Date().toISOString();
    await updateBatch(batch.id, { status: 'failed', error: String(e?.message ?? 'dialer delivery failed').slice(0, 300), updatedAt: failedAt, finishedAt: failedAt });
    throw new PushError('The batch was recorded but the dialer queue failed — check the history', 500);
  }
  return (await getBatch(batch.id)) ?? batch;
}

/**
 * Every assigned lead goes into its agent's queue; a number already waiting
 * for that agent is skipped (never duplicated), and the ledger rows are
 * marked so history reads one way for both the push and the dialer.
 */
async function deliverToDialer(batchId: string, assigned: AssignedLead[]): Promise<void> {
  const db = pushDb();
  if (!db) throw new Error('database unavailable');
  const { queued, duplicates } = await enqueueLeads(db, assigned.map(({ lead, agentKey }) => ({
    ref: `${batchId}:${lead.customerId}`,
    telecallerId: agentKey,
    customerId: lead.customerId,
    mobile: lead.mobile,
    name: lead.name,
    batchId,
  })));
  await markOutcomes(queued.map((id) => ({ id, ok: true, status: 200, body: 'queued' })));
  await markSkipped(duplicates, 'already_queued');
  await recountBatch(batchId);
  const now = new Date().toISOString();
  await updateBatch(batchId, { status: 'done', finishedAt: now, updatedAt: now });
}

/** Push history for one region (newest first). */
export async function getCustomerPushBatches(regionRaw: unknown, limitRaw: unknown): Promise<PushBatch[]> {
  const region = String(regionRaw ?? '').trim().toUpperCase();
  const limit = Math.max(1, Math.min(Number(limitRaw) || 20, BATCH_LIMIT_MAX));
  return listBatches(region === 'ALL' ? '' : region, limit);
}
