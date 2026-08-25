/**
 * Telecalling automation — single unified automation that surfaces, per active
 * telecaller, both halves of daily performance:
 *
 *   1. Lead Conversion — Zoho estimates programmatically assigned to each
 *      telecaller (round-robin by default; the assignment policy is pluggable).
 *   2. Lead Generation — NeoDove calls connected + leads generated per day,
 *      refreshed live from the NeoDove backend push.
 *
 * Plus team KPIs and a live daily leaderboard.
 *
 * The handler runs the Lead Conversion engine (assign unassigned + end-of-day
 * reassignment of unsatisfactory estimates). The data() provider aggregates
 * everything for the dashboard.
 */
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import type { Telecaller, EstimateAssignment } from '@prisma/client';
import type { AutomationContext } from '../../modules/automation/types';
import { getNeodoveAgentMap, getAllNeodoveAgents, getLatestNeodoveDay, CONNECTED_CALLS_PER_DAY, LEADS_PER_AGENT_PER_DAY } from '../neodove-telecaller-report';

const ROTATION_KEY = 'estimate_assignment:last_telecaller_id';
const CLOSED_STATES = ['accepted', 'confirmed', 'declined'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function istDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function tomorrowIST(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return istDate(d);
}

/**
 * Idempotently seed the Telecaller roster from the unique NeoDove agents across
 * ALL stored report days. Each unique agent (by NeoDove userId/userName) becomes
 * an active Telecaller; existing rows are linked (neodoveUserId/userName) without
 * changing their name/order/active state. No-op once the roster already covers
 * every agent, so it is safe to call on every dashboard load.
 */
async function syncTelecallersFromNeodove(): Promise<void> {
  try {
    const agents = await getAllNeodoveAgents();
    if (agents.length === 0) return;

    const existing = (await prisma.telecaller.findMany()) as (Telecaller & {
      neodoveUserId: string | null;
      neodoveUserName: string | null;
    })[];
    const byId = new Map<string, (typeof existing)[number]>();
    const byName = new Map<string, (typeof existing)[number]>();
    for (const t of existing) {
      if (t.neodoveUserId) byId.set(t.neodoveUserId, t);
      if (t.neodoveUserName) byName.set(t.neodoveUserName, t);
    }

    let writesNeeded = 0;
    for (const a of agents) {
      const existingT =
        (a.userId && byId.get(a.userId)) || (a.userName && byName.get(a.userName));
      if (existingT) {
        if (!existingT.neodoveUserId || !existingT.neodoveUserName) writesNeeded++;
      } else {
        writesNeeded++;
      }
    }
    if (writesNeeded === 0) return; // already fully synced

    let maxOrder = existing.reduce((m, t) => Math.max(m, t.order ?? 0), 0);
    for (const a of agents) {
      const existingT =
        (a.userId && byId.get(a.userId)) || (a.userName && byName.get(a.userName));
      if (existingT) {
        if (!existingT.neodoveUserId || !existingT.neodoveUserName) {
          await prisma.telecaller.update({
            where: { id: existingT.id },
            data: {
              neodoveUserId: existingT.neodoveUserId || a.userId || null,
              neodoveUserName: existingT.neodoveUserName || a.userName || null,
            },
          });
        }
        continue;
      }
      maxOrder += 1;
      await prisma.telecaller.create({
        data: {
          name: a.userName,
          active: true,
          order: maxOrder,
          neodoveUserId: a.userId || null,
          neodoveUserName: a.userName,
        },
      });
    }
    logger.info({ agents: agents.length, created: writesNeeded }, 'Synced telecallers from NeoDove');
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'syncTelecallersFromNeodove failed');
  }
}

async function getActiveTelecallers(): Promise<Telecaller[]> {
  return prisma.telecaller.findMany({ where: { active: true }, orderBy: { order: 'asc' } });
}

async function getRotationPointer(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: ROTATION_KEY } });
  return row?.value ?? null;
}

async function setRotationPointer(id: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: ROTATION_KEY },
    update: { value: id },
    create: { key: ROTATION_KEY, value: id },
  });
}

/**
 * Round-robin assign unassigned 'sent' estimates to active telecallers.
 * (Assignment policy is centralized here so it can be refined later.)
 */
export async function assignUnassignedEstimates(): Promise<{ assigned: number }> {
  const telecallers = await getActiveTelecallers();
  if (telecallers.length === 0) return { assigned: 0 };

  const unassigned = await prisma.estimate.findMany({
    where: { status: 'sent', assignedTelecallerId: null },
    orderBy: [{ date: 'asc' }],
  });
  if (unassigned.length === 0) return { assigned: 0 };

  const lastId = await getRotationPointer();
  let idx = 0;
  if (lastId) {
    const i = telecallers.findIndex((t) => t.id === lastId);
    if (i >= 0) idx = (i + 1) % telecallers.length;
  }

  const today = istDate();
  let assigned = 0;
  for (const est of unassigned) {
    const tc = telecallers[idx];
    idx = (idx + 1) % telecallers.length;
    await prisma.$transaction([
      prisma.estimateAssignment.create({
        data: { estimateId: est.estimateId, telecallerId: tc.id, day: today, status: 'assigned' },
      }),
      prisma.estimate.update({
        where: { estimateId: est.estimateId },
        data: { assignedTelecallerId: tc.id },
      }),
    ]);
    assigned++;
  }
  if (assigned > 0) {
    const lastTc = telecallers[(idx - 1 + telecallers.length) % telecallers.length];
    await setRotationPointer(lastTc.id);
  }
  return { assigned };
}

/**
 * Rank active telecallers by performance (best first), excluding `excludeId`.
 * Score = satisfied − bounced; ties broken by fewer active assignments, then order.
 */
async function rankTelecallers(excludeId?: string): Promise<(Telecaller & { score: number })[]> {
  const telecallers = await getActiveTelecallers();
  const withStats = await Promise.all(
    telecallers.map(async (tc) => {
      const assignments = await prisma.estimateAssignment.findMany({
        where: { telecallerId: tc.id },
        include: { estimate: { include: { classification: true } } },
      });
      let satisfied = 0;
      let bounced = 0;
      for (const a of assignments as (EstimateAssignment & { estimate: any })[]) {
        if (a.status === 'reassigned') bounced++;
        const est = a.estimate;
        const isSatisfied =
          est?.status === 'accepted' ||
          est?.status === 'confirmed' ||
          (est?.classification?.meaningfulUpdate ?? false) === true;
        if (isSatisfied) satisfied++;
      }
      return { ...tc, score: satisfied - bounced };
    }),
  );
  return withStats
    .filter((t) => t.id !== excludeId)
    .sort((a, b) => b.score - a.score || a.order - b.order);
}

/**
 * End-of-day reassignment: assignments made today that are still
 * "unsatisfactory" (classification has no meaningful update) are passed to the
 * next best performing telecaller for the following day. Closed estimates are
 * marked resolved.
 */
export async function reassignUnsatisfactory(): Promise<{ reassigned: number; resolved: number }> {
  const today = istDate();
  const assignments = await prisma.estimateAssignment.findMany({
    where: { day: today, status: 'assigned' },
    include: { estimate: { include: { classification: true } } },
  });

  let reassigned = 0;
  let resolved = 0;
  for (const a of assignments as (EstimateAssignment & { estimate: any })[]) {
    const est = a.estimate;
    if (!est) continue;
    if (CLOSED_STATES.includes(est.status)) {
      await prisma.estimateAssignment.update({ where: { id: a.id }, data: { status: 'resolved' } });
      resolved++;
      continue;
    }
    const unsatisfactory = (est.classification?.meaningfulUpdate ?? false) === false;
    if (!unsatisfactory) continue;

    const ranked = await rankTelecallers(a.telecallerId);
    const next = ranked[0];
    if (!next) continue;

    await prisma.$transaction([
      prisma.estimateAssignment.update({ where: { id: a.id }, data: { status: 'reassigned' } }),
      prisma.estimateAssignment.create({
        data: {
          estimateId: est.estimateId,
          telecallerId: next.id,
          day: tomorrowIST(),
          reassignedFromId: a.id,
          status: 'assigned',
        },
      }),
      prisma.estimate.update({
        where: { estimateId: est.estimateId },
        data: { assignedTelecallerId: next.id },
      }),
    ]);
    reassigned++;
  }
  return { reassigned, resolved };
}

/** Lead Conversion engine: assign unassigned + reassign unsatisfactory. */
export async function runLeadConversion(): Promise<{ assigned: number; reassigned: number; resolved: number }> {
  // Keep the Telecaller roster in sync with NeoDove before assigning.
  await syncTelecallersFromNeodove();
  const { assigned } = await assignUnassignedEstimates();
  const { reassigned, resolved } = await reassignUnsatisfactory();
  return { assigned, reassigned, resolved };
}

export interface TelecallerDayMetrics {
  id: string;
  name: string;
  active: boolean;
  neodoveUserName: string | null;
  conversion: { assigned: number; won: number; conversionRate: number; pipelineValue: number };
  generation: {
    callsAttempted: number;
    callsConnected: number;
    callsNotConnected: number;
    incomingCalls: number;
    outgoingCalls: number;
    talkTimeSec: number;
    leadsConverted: number;
    leadsInProgress: number;
    leadsLost: number;
    leadsGenerated: number;
    followupLeads: number;
    connectedTarget: number;
    connectedPct: number;
    connectedStatus: 'green' | 'amber' | 'red';
    leadsTarget: number;
    leadsPct: number;
    leadsStatus: 'green' | 'amber' | 'red';
  };
  score: number;
}

/**
 * Unified dashboard payload: per-telecaller Lead Conversion + Lead Generation
 * metrics for a given day (default: today, IST), team KPIs, and a live
 * leaderboard.
 */
export async function getTelecallingDashboardData(ctx?: AutomationContext): Promise<any> {
  const q = (ctx?.subject ?? {}) as Record<string, unknown>;
  const date = typeof q.date === 'string' && DATE_RE.test(q.date) ? q.date : undefined;
  const requestedDay = date ?? istDate();

  // Auto-sync the Telecaller roster from the unique NeoDove agents (all stored
  // days). Idempotent — no-op once every agent is already present.
  await syncTelecallersFromNeodove();

  // If the requested day has no NeoDove data yet, fall back to the latest stored
  // NeoDove day so Lead Generation shows real numbers instead of all zeros.
  let day = requestedDay;
  let neodoveMap = await getNeodoveAgentMap(requestedDay);
  let usingLatestAvailable = false;
  if (Object.keys(neodoveMap).length === 0) {
    const latest = await getLatestNeodoveDay();
    if (latest && latest !== requestedDay) {
      day = latest;
      neodoveMap = await getNeodoveAgentMap(latest);
      usingLatestAvailable = true;
    }
  }

  const telecallers = await prisma.telecaller.findMany({ orderBy: { order: 'asc' } });

  const leaderboard: TelecallerDayMetrics[] = [];
  const kpiAcc = {
    assigned: 0,
    won: 0,
    pipelineValue: 0,
    callsConnected: 0,
    leadsGenerated: 0,
    talkTimeSec: 0,
  };

  for (const tc of telecallers as (Telecaller & { neodoveUserName: string | null })[]) {
    const assignments = await prisma.estimateAssignment.findMany({
      where: { telecallerId: tc.id, day },
      include: { estimate: true },
    });
    let won = 0;
    let pipelineValue = 0;
    for (const a of assignments as (EstimateAssignment & { estimate: any })[]) {
      const est = a.estimate;
      if (est?.status === 'accepted' || est?.status === 'confirmed') won++;
      pipelineValue += Number(est?.total ?? 0) || 0;
    }
    const assignedToday = assignments.length;
    const conversionRate = assignedToday > 0 ? Math.round((won / assignedToday) * 100) : 0;

    // Lead Generation: copy this telecaller's live NeoDove metrics (matched by
    // the linked NeoDove user name) into the dashboard.
    const nd =
      (tc.neodoveUserName && neodoveMap[tc.neodoveUserName]) ||
      (tc.neodoveUserId && neodoveMap[tc.neodoveUserId]) ||
      undefined;
    const callsAttempted = nd?.callsAttempted ?? 0;
    const callsConnected = nd?.callsConnected ?? 0;
    const callsNotConnected = nd?.callsNotConnected ?? 0;
    const incomingCalls = nd?.incomingCalls ?? 0;
    const outgoingCalls = nd?.outgoingCalls ?? 0;
    const talkTimeSec = nd?.talkTimeSec ?? 0;
    const leadsConverted = nd?.leadsConverted ?? 0;
    const leadsInProgress = nd?.leadsInProgress ?? 0;
    const leadsLost = nd?.leadsLost ?? 0;
    const followupLeads = nd?.followupLeads ?? 0;
    const leadsGenerated = leadsInProgress + leadsConverted;

    // Lead Generation KRA vs NeoDove daily benchmarks (exact same interface as
    // the NeoDove telecaller report): traffic light 🟢 ≥100% · 🟡 60–99% · 🔴 <60%.
    const connectedTarget = CONNECTED_CALLS_PER_DAY;
    const connectedPct = connectedTarget > 0 ? Math.round((callsConnected / connectedTarget) * 100) : 0;
    const connectedStatus: 'green' | 'amber' | 'red' =
      connectedPct >= 100 ? 'green' : connectedPct >= 60 ? 'amber' : 'red';
    const leadsTarget = LEADS_PER_AGENT_PER_DAY;
    const leadsPct = leadsTarget > 0 ? Math.round((leadsGenerated / leadsTarget) * 100) : 0;
    const leadsStatus: 'green' | 'amber' | 'red' =
      leadsPct >= 100 ? 'green' : leadsPct >= 60 ? 'amber' : 'red';

    // Composite daily score (tunable): wins weigh most, then leads, then calls.
    const score = won * 100 + leadsGenerated * 15 + Math.round(callsConnected * 0.5);

    if (tc.active) {
      kpiAcc.assigned += assignedToday;
      kpiAcc.won += won;
      kpiAcc.pipelineValue += pipelineValue;
      kpiAcc.callsConnected += callsConnected;
      kpiAcc.leadsGenerated += leadsGenerated;
      kpiAcc.talkTimeSec += talkTimeSec;
    }

    leaderboard.push({
      id: tc.id,
      name: tc.name,
      active: tc.active,
      neodoveUserName: tc.neodoveUserName,
      conversion: { assigned: assignedToday, won, conversionRate, pipelineValue },
      generation: {
        callsAttempted,
        callsConnected,
        callsNotConnected,
        incomingCalls,
        outgoingCalls,
        talkTimeSec,
        leadsConverted,
        leadsInProgress,
        leadsLost,
        leadsGenerated,
        followupLeads,
        connectedTarget,
        connectedPct,
        connectedStatus,
        leadsTarget,
        leadsPct,
        leadsStatus,
      },
      score,
    });
  }

  leaderboard.sort((a, b) => b.score - a.score);

  const unassignedSent = await prisma.estimate.count({
    where: { status: 'sent', assignedTelecallerId: null },
  });

  const recent = await prisma.estimateAssignment.findMany({
    orderBy: { assignedAt: 'desc' },
    take: 25,
    include: { telecaller: true, estimate: { select: { estimateNumber: true, customerName: true, status: true } } },
  });

  const activeCount = telecallers.filter((t) => t.active).length;

  return {
    meta: {
      analysis: 'telecalling',
      title: 'Telecalling — Daily Performance',
      day,
      requestedDay,
      usingLatestAvailable,
      generatedAt: new Date().toISOString(),
      unassignedSent,
      telecallerCount: telecallers.length,
      activeCount,
      targets: {
        connectedCallsPerDay: CONNECTED_CALLS_PER_DAY,
        leadsPerAgentPerDay: LEADS_PER_AGENT_PER_DAY,
      },
    },
    kpi: {
      ...kpiAcc,
      conversionRate: kpiAcc.assigned > 0 ? Math.round((kpiAcc.won / kpiAcc.assigned) * 100) : 0,
    },
    leaderboard,
    recent,
  };
}
