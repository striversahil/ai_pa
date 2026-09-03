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
// ── Estimate risk model (live pre-warning) ───────────────────────────────────
// Real-time risk states over the open `sent` pipeline so trouble is visible
// BEFORE the end-of-day reassignment sweep:
//   zombie  — no comment in > 2 days (the AI already treats stale comments as
//             not meaningful, so these estimates are dead weight)
//   red     — latest AI verdict has meaningfulUpdate=false (EOD snatch candidate)
//   pending — no AI verdict yet
//   ok      — latest comment counted as a meaningful update
export const ZOMBIE_DAYS = 2;
const RISK_LIST_CAP = 25;

// ── Conversion-maximising assignment tuning ──────────────────────────────────
// Stability-first policy: healthy estimates stay put; only unassigned + at-risk
// (red/zombie) estimates are (re)dealt. New/reassigned estimates are given to
// proven converters balanced by current load, high-value estimates first.
const ASSIGN_TUNING = {
  conversionWeight: 0.6, // how much an agent's historical win rate drives routing
  loadWeight: 0.4,       // how strongly current load balances the deal
  baseWin: 0.2,          // floor conversion rate for new/unknown agents
} as const;

/** Per-risk close-probability factor used for estimated-conversion projection. */
export function toCloseMultiplier(risk: EstimateRisk): number {
  switch (risk) {
    case 'ok': return 1.0;
    case 'pending': return 0.7;
    case 'red': return 0.35;
    case 'zombie': return 0.15;
    default: return 0.7;
  }
}


export type EstimateRisk = 'ok' | 'pending' | 'red' | 'zombie';

export interface RiskItem {
  estimateId: string;
  estimateNumber: string;
  customerName: string;
  telecallerId: string;
  telecallerName: string | null;
  total: number;
  risk: EstimateRisk;
  lastCommentDate: string | null;
  staleHours: number | null;
  reasoning: string | null;
  /** Why this estimate is about to be / was re-poached (surfaced to the agent). */
  snatchReason: string | null;
  /** Hours remaining until the EOD (21:00 IST) snatch sweep. */
  snatchInHours: number | null;
}

/** Hours until the next EOD snatch sweep (21:00 IST). Null if already past. */
export function hoursUntilEod(now: Date = new Date()): number | null {
  try {
    const istParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(now);
    const get = (t: string) => Number(istParts.find((p) => p.type === t)?.value ?? 0);
    const hour = get('hour') % 24;
    const minute = get('minute');
    const second = get('second');
    const secsSinceMidnight = hour * 3600 + minute * 60 + second;
    const eodSecs = 21 * 3600;
    const diff = eodSecs - secsSinceMidnight;
    return diff <= 0 ? null : Math.round((diff / 3600) * 10) / 10;
  } catch {
    return null;
  }
}

function parseCommentDateMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/**
 * Latest comment date (raw string as stored by the Zoho sync) per estimate.
 * Degrades to an empty map if the comment query fails — the risk model then
 * relies on the Classification verdict alone (graceful degradation).
 */
async function latestCommentDates(estimateIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (estimateIds.length === 0) return out;
  try {
    const comments = await prisma.comment.findMany({
      where: { estimateId: { in: estimateIds } },
      orderBy: { date: 'desc' },
      select: { estimateId: true, date: true },
    });
    for (const c of comments) {
      if (c?.estimateId && c.date && !out.has(c.estimateId)) out.set(c.estimateId, String(c.date));
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'latestCommentDates failed — risk model degrades to classification only');
  }
  return out;
}

function classifyRisk(
  cls: { meaningfulUpdate: boolean } | null | undefined,
  lastCommentDate: string | null,
  nowMs: number,
): { risk: EstimateRisk; staleHours: number | null } {
  const ts = parseCommentDateMs(lastCommentDate);
  const staleHours = ts !== null ? (nowMs - ts) / 3600000 : null;
  if (staleHours === null || staleHours > ZOMBIE_DAYS * 24) return { risk: 'zombie', staleHours };
  if (!cls) return { risk: 'pending', staleHours };
  return { risk: cls.meaningfulUpdate ? 'ok' : 'red', staleHours };
}

/**
 * Why an estimate is being re-poached at EOD. Mirrors the AI verdict so the
 * losing agent sees exactly what lost them the deal. Falls back to the
 * classification reasoning when available (e.g. "customer not answering").
 */
function buildSnatchReason(
  est: { estimateId: string; classification?: { meaningfulUpdate?: boolean; reasoning?: string | null } | null },
  risk: EstimateRisk,
): string {
  if (risk === 'zombie') return 'No reply in over 2 days — reassigned to a better converter';
  const reasoning = est.classification?.reasoning;
  if (reasoning && reasoning.trim() && reasoning.trim() !== 'No sales agent comment found.') {
    const verdict = est.classification?.meaningfulUpdate ? 'meaningful update' : 'unsatisfactory remark';
    const clipped = reasoning.trim().slice(0, 140);
    return `EOD snatch (${verdict}): ${clipped}`;
  }
  return 'Unsatisfactory remark at end of day — reassigned to a better converter';
}

// ── Risk cache (D1 row-read budget protection) ───────────────────────────────
// The risk model scans all open estimates + their latest comment dates, which
// is expensive. Dashboards refetch on every runner WebSocket broadcast (every
// 5–15 min), so the scan is cached in a Setting key with a short TTL — the
// same snapshot pattern the NeoDove report uses. Stale-upon-error: if the
// cached copy is older than TTL it is still served when a refresh fails.
const RISK_CACHE_KEY = 'telecalling:risk_cache';
const RISK_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedRiskItem extends Omit<RiskItem, 'telecallerName'> {
  telecallerName: string | null;
}

interface RiskCache {
  items: CachedRiskItem[];
  computedAt: string;
}

async function computeRiskCache(): Promise<RiskCache> {
  const nowMs = Date.now();
  const telecallers = await prisma.telecaller.findMany({ orderBy: { order: 'asc' } });
  const nameById = new Map(telecallers.map((t) => [t.id, t.name]));

  const sentOpen = await prisma.estimate.findMany({
    where: { status: 'sent', assignedTelecallerId: { not: null } },
    include: { classification: true },
  });
  const lastComments = await latestCommentDates(sentOpen.map((e) => e.estimateId));

  const items: CachedRiskItem[] = sentOpen.map((e) => {
    const cls = (e as any).classification ?? null;
    const lastCommentDate = lastComments.get(e.estimateId) ?? null;
    const { risk, staleHours } = classifyRisk(cls, lastCommentDate, nowMs);
    const owner = String(e.assignedTelecallerId);
    return {
      estimateId: e.estimateId,
      estimateNumber: e.estimateNumber,
      customerName: e.customerName,
      telecallerId: owner,
      telecallerName: nameById.get(owner) ?? null,
      total: Number(e.total ?? 0) || 0,
      risk,
      lastCommentDate,
      staleHours,
      reasoning: cls?.reasoning ?? null,
      snatchReason: buildSnatchReason(e, risk),
      snatchInHours: hoursUntilEod(new Date(nowMs)),
    };
  });
  return { items, computedAt: new Date(nowMs).toISOString() };
}

/**
 * Risk items for the open pipeline, served from a 5-min Setting-key cache.
 * On refresh failure, serves the stale snapshot (graceful degradation) rather
 * than burning more D1 row reads with retry loops.
 */
async function getRiskItems(): Promise<CachedRiskItem[]> {
  let cached: RiskCache | null = null;
  try {
    const row = await prisma.setting.findUnique({ where: { key: RISK_CACHE_KEY } });
    if (row?.value) cached = JSON.parse(String(row.value)) as RiskCache;
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'risk cache read failed');
  }
  const fresh = cached && Date.now() - Date.parse(cached.computedAt) < RISK_CACHE_TTL_MS;
  if (fresh && cached) return cached.items;

  try {
    const computed = await computeRiskCache();
    const payload = JSON.stringify(computed);
    await prisma.setting.upsert({
      where: { key: RISK_CACHE_KEY },
      update: { value: payload, updatedAt: new Date() },
      create: { key: RISK_CACHE_KEY, value: payload, updatedAt: new Date() },
    });
    return computed.items;
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'risk compute failed — serving stale cache if present');
    return cached?.items ?? [];
  }
}

/**
 * Idempotently seed the Telecaller roster

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

/**
 * Stability-first, conversion-maximising assignment.
 *
 * Keeps the open pipeline on the agent who has momentum with it:
 *   - healthy estimates (risk ok/pending) stay exactly where they are;
 *   - unassigned `sent` estimates are dealt to the best-fit agent;
 *   - at-risk (red/zombie) estimates are re-poached to a better converter.
 *
 * Candidates are dealt high-value-first, favouring proven converters while a
 * load penalty keeps anyone from being buried. This maximises expected closed
 * value without resetting live customer relationships every morning.
 */
export async function assignEstimatesForMaxConversion(): Promise<{ assigned: number; reassigned: number }> {
  const telecallers = await getActiveTelecallers();
  if (telecallers.length === 0) return { assigned: 0, reassigned: 0 };

  const sent = await prisma.estimate.findMany({
    where: { status: 'sent' },
    include: { classification: true },
  });
  if (sent.length === 0) return { assigned: 0, reassigned: 0 };

  // Live risk for every open estimate (served from the 5-min risk cache).
  let riskItems: CachedRiskItem[] = [];
  try { riskItems = await getRiskItems(); } catch (e: any) {
    logger.warn({ err: e?.message }, 'assign: risk cache unavailable — treating all as pending');
  }
  const riskByEstimate = new Map<string, EstimateRisk>();
  for (const r of riskItems) riskByEstimate.set(r.estimateId, r.risk);

  // Historical win stats — conversion rate per agent.
  const allOwned = await prisma.estimate.findMany({
    where: { assignedTelecallerId: { not: null } },
    select: { assignedTelecallerId: true, status: true },
  });
  const assignedTot = new Map<string, number>();
  const wonTot = new Map<string, number>();
  for (const e of allOwned) {
    const id = String(e.assignedTelecallerId);
    assignedTot.set(id, (assignedTot.get(id) ?? 0) + 1);
    if (e.status === 'accepted' || e.status === 'confirmed') wonTot.set(id, (wonTot.get(id) ?? 0) + 1);
  }
  const conversionRate = (id: string): number => {
    const a = assignedTot.get(id) ?? 0;
    const w = wonTot.get(id) ?? 0;
    return a + w > 0 ? w / (a + w) : 0;
  };

  // Current load = healthy open estimates the agent already owns (not the ones
  // about to be re-poached). Count-normalised so the penalty is comparable.
  const loadCount = new Map<string, number>();
  for (const est of sent) {
    if (!est.assignedTelecallerId) continue;
    const risk = riskByEstimate.get(est.estimateId) ?? 'pending';
    if (risk === 'ok' || risk === 'pending') {
      const id = String(est.assignedTelecallerId);
      loadCount.set(id, (loadCount.get(id) ?? 0) + 1);
    }
  }
  const maxLoad = Math.max(1, ...loadCount.values());

  // Candidates: unassigned OR at-risk — highest value first.
  const candidates = sent
    .filter((e) => {
      if (!e.assignedTelecallerId) return true;
      const risk = riskByEstimate.get(e.estimateId);
      return risk === 'red' || risk === 'zombie';
    })
    .sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));

  let assigned = 0;
  let reassigned = 0;
  const { conversionWeight, loadWeight } = ASSIGN_TUNING;
  for (const est of candidates) {
    const wasAssigned = !!est.assignedTelecallerId;
    const risk = riskByEstimate.get(est.estimateId) ?? 'pending';
    // Why this estimate is being moved — surfaced to the losing agent so the
    // snatch mechanic is instructive ("unsatisfactory remark" vs "no reply").
    const reason = buildSnatchReason(est, risk);
    let bestId = '';
    let bestScore = -Infinity;
    let bestLoad = Infinity;
    for (const tc of telecallers) {
      const id = tc.id;
      const conv = conversionRate(id);
      const load = loadCount.get(id) ?? 0;
      const loadFactor = maxLoad > 0 ? load / maxLoad : 0;
      const score = conversionWeight * conv - loadWeight * loadFactor;
      if (score > bestScore || (score === bestScore && load < bestLoad)) {
        bestScore = score;
        bestId = id;
        bestLoad = load;
      }
    }
    if (!bestId) continue;
    // If the current holder is being re-poached, the NEW row keeps the same
    // snatchReason (why the estimate left the previous holder). Fresh deals get
    // a null reason.
    const movedFrom = est.assignedTelecallerId;
    await prisma.estimate.update({
      where: { estimateId: est.estimateId },
      data: { assignedTelecallerId: bestId },
    });
    await recordAssignment(est.estimateId, bestId, wasAssigned ? reason : null);
    loadCount.set(bestId, (loadCount.get(bestId) ?? 0) + 1);
    if (wasAssigned) reassigned += 1;
    else assigned += 1;
    void movedFrom;
  }

  logger.info(
    { assigned, reassigned, candidates: candidates.length, telecallers: telecallers.length },
    'Stability-first conversion-maximising assignment complete',
  );
  return { assigned, reassigned };
}

/** Close-credit split for a snatch-then-close: most credit goes to the agent
 * who originated/chased the relationship, the rest to whoever closes it. */
const CLOSE_CREDIT = { origin: 0.6, closer:  0.4 } as const;

/**
 * Record an assignment into the EstimateAssignment chain (single source of truth
 * for fair close-credit). Resolves the previous open row first (if any), then
 * inserts the new holder linked via reassignedFromId. Enables co-crediting the
 * originator of a snatch-then-close instead of crediting only thee last holder.
 * `snatchReason` (why the previous holder lost it at EOD) is persisted so the
 * losing agent sees exactly what cost them the deal.
 */
async function recordAssignment(estimateId: string, telecallerId: string, snatchReason: string | null = null): Promise<void> {
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
      },
    });
  } catch (e: any) {
    logger.warn({ err: e?.message, estimateId }, 'recordAssignment failed — continuing without history');
  }
}

/**
/** Daily engine: refresh the roster from NeoDove, then deal the sent pool. */
export async function runLeadConversion(): Promise<{ assigned: number }> {
  await syncTelecallersFromNeodove();
  return assignEstimatesForMaxConversion();
}

export interface TelecallerDayMetrics {
  id: string;
  name: string;
  active: boolean;
  neodoveUserName: string | null;
  conversion: {
    assigned: number;
    won: number;
    conversionRate: number;
    pipelineValue: number;
    // Forward-looking: expected closed value given the agent's win rate and the
    // live risk of each open estimate. count = expected number of closes.
    estimatedConversion: { count: number; value: number };
    // Co-credited closes: a snatch-then-close splits credit between the
    // originator (0.6) and the closer (0.4), so good agents aren't
    // demotivated when a deal they worked gets re-poached and credited elsewhere.
    credit: { won: number; value: number };
  };
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
  // Live pipeline risk: open estimates currently red (no meaningful update) or
  // zombie (silent > 2 days) — the EOD reassignment candidates.
  risk: { atRisk: number; zombie: number };
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
  const nameById = new Map(telecallers.map((t) => [t.id, t.name]));

  // Risk model over the open pipeline — served from the 5-min cache (D1
  // row-read budget protection). Stale chips in the agent view read from the
  // same snapshot, so the comment table is scanned at most once per TTL.
  const nowMs = Date.now();
  const riskItems = await getRiskItems();
  const riskByOwner = new Map<string, { atRisk: number; zombie: number }>();
  for (const r of riskItems) {
    if (r.risk === 'ok' || r.risk === 'pending') continue;
    const cur = riskByOwner.get(r.telecallerId) ?? { atRisk: 0, zombie: 0 };
    if (r.risk === 'zombie') cur.zombie += 1;
    else cur.atRisk += 1;
    riskByOwner.set(r.telecallerId, cur);
  }

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

// Co-credited closes (fair outcome reward): a snatch-then-close splits
    // credit between the originator and the closer, so a proven agent isn't
    // robbed of a deal they worked. Walks each won estimate's assignment chain
    // (reassignedFromId → root) — origin/first holder gets 0.6, current
    // holder/closer gets 0.4. Without history (pre-deploy) it credits the
    // whole close to the current holder.

    const wonIds = owned.filter((e) => e.status === 'accepted' || e.status === 'confirmed').map((e) => e.estimateId);
    const creditByAgent = new Map<string, { won: number; value: number }>();
    let chains = new Map<string, { telecallerId: string; reassignedFromId: string | null }[]>();
    if (wonIds.length > 0) {
      try {
        const rows = await prisma.estimateAssignment.findMany({
          where: { estimateId: { in: wonIds } },
          orderBy: { assignedAt: 'asc' },
          select: { estimateId: true, telecallerId: true, reassignedFromId: true },
        });
        for (const r of rows) {
          const arr = chains.get(r.estimateId) ?? [];
          arr.push(r);
          chains.set(r.estimateId, arr);
        }
      } catch (e: any) {
        logger.warn({ err: e?.message }, 'close-credit chain read failed — crediting current holders only');
      }
    }
    for (const e of owned) {
      if (!(e.status === 'accepted' || e.status === 'confirmed')) continue;
      const total = Number(e.total ?? 0) || 0;
      const closer = String(e.assignedTelecallerId);
      const chain = chains.get(e.estimateId) ?? [];
      const origin = chain?.length ? chain[0].telecallerId : closer;
      const shares = new Map<string, number>();
      if (origin === closer) { shares.set(origin, (shares.get(origin) ?? 0) + 1); }
      else {
        shares.set(origin, (shares.get(origin) ?? 0) + CLOSE_CREDIT.origin);
        shares.set(closer, (shares.get(closer) ??  0) + CLOSE_CREDIT.closer);
      }
      for (const [aid, share] of shares) {
        const cur = creditByAgent.get(aid) ?? { won: 0, value: 0 };
        cur.won += share;
        cur.value += total * share;
        creditByAgent.set(aid, cur);
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

    // Estimated conversion: expected closed value from this agent's open
    // pipeline, weighted by their win rate and each estimate's live risk.
    // Floored win rate so a brand-new agent isn't projected at 0.
    const agentWinRate = assignedToday + won > 0 ? won / (assignedToday + won) : 0;
    const baseWin = Math.max(agentWinRate, ASSIGN_TUNING.baseWin);
    const cap = (x: number) => Math.max(0.05, Math.min(0.95, x));
    let estCount = 0;
    let estValue = 0;
    for (const r of riskItems) {
      if (r.telecallerId !== tc.id) continue;
      const prob = cap(baseWin * toCloseMultiplier(r.risk));
      estCount += prob;
      estValue += r.total * prob;
    }
    const estimatedConversion = { count: Math.round(estCount * 10) / 10, value: Math.round(estValue) };

    leaderboard.push({
      id: tc.id,
      name: tc.name,
      active: tc.active,
      neodoveUserName: tc.neodoveUserName,
      conversion: { assigned: assignedToday, won, conversionRate, pipelineValue, estimatedConversion, credit: creditByAgent.get(tc.id) ?? { won: 0, value:  0 } },
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
      risk: riskByOwner.get(tc.id) ?? { atRisk: 0, zombie: 0 },
    });
  }

  // Rank by projected closed value first — the metric that reflects which
  // agents are actually going to convert pipeline, not just raw activity.
  leaderboard.sort((a, b) => {
  const rankA = a.conversion.estimatedConversion.value + a.conversion.credit.value;
  const rankB = b.conversion.estimatedConversion.value + b.conversion.credit.value;
  return rankB - rankA;
});

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
    const followUpEsts = await prisma.estimate.findMany({
      where: { assignedTelecallerId: tc.id, status: 'sent' },
      orderBy: [{ date: 'asc' }],
      // 15-min Zoho analyzer verdict — drives the Satisfactory/Unsatisfactory
      // chip. Note: D1PrismaClient resolves relations via `include`, not a
      // nested relation under `select`.
      include: { classification: true },
    });
    const followLastComments = new Map<string, string>();
    for (const r of riskItems) {
      if (r.lastCommentDate) followLastComments.set(r.estimateId, r.lastCommentDate);
    }
    const followUps = followUpEsts.map((e) => {
      const lastCommentDate = followLastComments.get(e.estimateId) ?? null;
      const ts = parseCommentDateMs(lastCommentDate);
      const staleHours = ts !== null ? (nowMs - ts) / 3600000 : null;
      const riskItem = riskItems.find((r) => r.estimateId === e.estimateId);
      const risk = riskItem?.risk ?? 'pending';
      return {
        estimateId: e.estimateId,
        estimateNumber: e.estimateNumber,
        customerName: e.customerName,
        status: e.status,
        total: e.total,
        day,
        assignmentStatus: 'assigned',
        satisfactory: e.classification ? !!e.classification.meaningfulUpdate : null,
        intentScore: e.classification?.intentScore ?? null,
        analysisSummary: e.classification?.summary ?? null,
        lastCommentDate,
        staleHours,
        risk,
        snatchReason: riskItem?.snatchReason ?? (risk === 'red' || risk === 'zombie' ? buildSnatchReason(e, risk) : null),
        snatchInHours: riskItem?.snatchInHours ?? hoursUntilEod(new Date(nowMs)),
      };
    });
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
    // Founder pre-warning: open estimates about to be snatched at EOD, sorted
    // by value. Red = latest AI verdict found no meaningful update; zombie =
    // silent for more than ZOMBIE_DAYS.
    risk: {
      counts: {
        open: riskItems.length,
        ok: riskItems.filter((r) => r.risk === 'ok').length,
        pending: riskItems.filter((r) => r.risk === 'pending').length,
        red: riskItems.filter((r) => r.risk === 'red').length,
        zombie: riskItems.filter((r) => r.risk === 'zombie').length,
      },
      valueAtRisk: riskItems
        .filter((r) => r.risk === 'red' || r.risk === 'zombie')
        .reduce((s, r) => s + r.total, 0),
      atRisk: riskItems
        .filter((r) => r.risk === 'red' || r.risk === 'zombie')
        .sort((a, b) => b.total - a.total)
        .slice(0, RISK_LIST_CAP),
    },
    leaderboard,
    recent,
  };
}
