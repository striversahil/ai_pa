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
import type { Telecaller } from '@prisma/client';
import type { AutomationContext } from '../../modules/automation/types';
import { getNeodoveAgentMap, getAllNeodoveAgents, getLatestNeodoveDay, CONNECTED_CALLS_PER_DAY, LEADS_PER_AGENT_PER_DAY } from '../neodove-telecaller-report';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function istDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
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

// ── Round-robin rotation ─────────────────────────────────────────────────────
// Single source of truth: `Estimate.assignedTelecallerId`. No history table —
// every morning the whole active `sent` pool is re-dealt across the active
// roster, continuing from the previous rotation's stop point so consecutive
// mornings stay fair even when the sent-pool size changes.

const ROTATION_POINTER_KEY = 'telecalling_rotation:pointer';

async function getRotationPointer(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: ROTATION_POINTER_KEY } });
  return row ? String(row.value ?? '') : '';
}

async function setRotationPointer(telecallerId: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: ROTATION_POINTER_KEY },
    update: { value: telecallerId },
    create: { key: ROTATION_POINTER_KEY, value: telecallerId },
  });
}

/**
 * Deal every active `sent` estimate round-robin across active telecallers.
 * Runs once each morning (08:00 IST cron → POST /api/trigger/telecalling).
 */
export async function rotateEstimatesRoundRobin(): Promise<{ assigned: number }> {
  const telecallers = await getActiveTelecallers();
  if (telecallers.length === 0) return { assigned: 0 };

  const sent = await prisma.estimate.findMany({
    where: { status: 'sent' },
    orderBy: [{ date: 'asc' }, { estimateId: 'asc' }],
    select: { estimateId: true },
  });
  if (sent.length === 0) return { assigned: 0 };

  const lastId = await getRotationPointer();
  let idx = telecallers.findIndex((t) => t.id === lastId);
  idx = idx >= 0 ? (idx + 1) % telecallers.length : 0;

  let assigned = 0;
  let lastUsed = '';
  for (const est of sent) {
    const tc = telecallers[idx];
    lastUsed = tc.id;
    idx = (idx + 1) % telecallers.length;
    await prisma.estimate.update({
      where: { estimateId: est.estimateId },
      data: { assignedTelecallerId: tc.id },
    });
    assigned++;
  }

  if (lastUsed) await setRotationPointer(lastUsed);
  logger.info(
    { assigned, estimates: sent.length, telecallers: telecallers.length },
    'Round-robin estimate rotation complete',
  );
  return { assigned };
}

/** Daily engine: refresh the roster from NeoDove, then deal the sent pool. */
export async function runLeadConversion(): Promise<{ assigned: number }> {
  await syncTelecallersFromNeodove();
  return rotateEstimatesRoundRobin();
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

  // Single source of truth: Estimate.assignedTelecallerId — one query, grouped
  // in memory. No assignment-history table involved.
  const owned = await prisma.estimate.findMany({
    where: { assignedTelecallerId: { not: null } },
    select: { estimateId: true, assignedTelecallerId: true, status: true, total: true },
  });
  const openByOwner = new Map<string, { count: number; value: number }>();
  const wonByOwner = new Map<string, number>();
  for (const e of owned) {
    const owner = String(e.assignedTelecallerId);
    if (e.status === 'sent') {
      const cur = openByOwner.get(owner) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += Number(e.total ?? 0) || 0;
      openByOwner.set(owner, cur);
    } else if (e.status === 'accepted' || e.status === 'confirmed') {
      wonByOwner.set(owner, (wonByOwner.get(owner) ?? 0) + 1);
    }
  }

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
    // Current workload straight off the single assignment field.
    const open = openByOwner.get(tc.id) ?? { count: 0, value: 0 };
    const won = wonByOwner.get(tc.id) ?? 0;
    const assignedToday = open.count;
    const pipelineValue = open.value;
    const conversionRate = assignedToday + won > 0 ? Math.round((won / (assignedToday + won)) * 100) : 0;

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
    // True "leads generated" count from the get-leads API (stored on the
    // NeoDove agent row). Fall back to the legacy leadsInProgress +
    // leadsConverted for snapshots predating the field.
    const leadsGenerated =
      typeof nd?.leadsGenerated === 'number' ? nd.leadsGenerated : leadsInProgress + leadsConverted;

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

  // Self-contained agent list so the dashboard can build the per-agent dropdown
  // without a second round-trip.
  const agentList = telecallers.map((t) => ({ id: t.id, name: t.name, active: t.active }));

  // Agent dropdown: ?agent=<id|name> returns that agent's open follow-up
  // estimates (what they must call) plus their own metrics.
  const agentFilter = typeof q.agent === 'string' && q.agent ? q.agent : undefined;
  if (agentFilter) {
    const tc = telecallers.find(
      (t) => t.id === agentFilter || t.name === agentFilter || (t.neodoveUserName ?? '') === agentFilter,
    );
    if (!tc) {
      return {
        meta: {
          analysis: 'telecalling',
          title: 'Telecalling — Daily Performance',
          day,
          agents: agentList,
          generatedAt: new Date().toISOString(),
          error: 'agent not found',
        },
      };
    }
    const followUps = (
      await prisma.estimate.findMany({
        where: { assignedTelecallerId: tc.id, status: 'sent' },
        orderBy: [{ date: 'asc' }],
        select: {
          estimateId: true,
          estimateNumber: true,
          customerName: true,
          status: true,
          total: true,
        },
      })
    ).map((e) => ({
      estimateId: e.estimateId,
      estimateNumber: e.estimateNumber,
      customerName: e.customerName,
      status: e.status,
      total: e.total,
      day,
      assignmentStatus: 'assigned',
    }));
    const lb = leaderboard.find((l) => l.id === tc.id);
    return {
      meta: {
        analysis: 'telecalling-agent',
        title: `Telecalling — ${tc.name}`,
        day,
        requestedDay,
        usingLatestAvailable,
        agents: agentList,
        generatedAt: new Date().toISOString(),
      },
      agent: {
        id: tc.id,
        name: tc.name,
        active: tc.active,
        conversion: lb?.conversion ?? null,
        generation: lb?.generation ?? null,
        score: lb?.score ?? 0,
        followUpCount: followUps.length,
      },
      followUps,
    };
  }

  const unassignedSent = await prisma.estimate.count({
    where: { status: 'sent', assignedTelecallerId: null },
  });

  const nameById = new Map(telecallers.map((t) => [t.id, t.name]));
  const recentRows = await prisma.estimate.findMany({
    where: { assignedTelecallerId: { not: null } },
    orderBy: { lastSyncTime: 'desc' },
    take: 25,
    select: {
      estimateNumber: true,
      customerName: true,
      status: true,
      assignedTelecallerId: true,
    },
  });
  const recent = recentRows.map((e) => ({
    estimateNumber: e.estimateNumber,
    customerName: e.customerName,
    status: e.status,
    telecallerName: nameById.get(String(e.assignedTelecallerId)) ?? null,
  }));

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
      agents: agentList,
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
