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
import { getNeodoveAgentMap, getAllNeodoveAgents, getLatestNeodoveDay, getNeodoveRangeMap, CONNECTED_CALLS_PER_DAY, LEADS_PER_AGENT_PER_DAY } from '../neodove-telecaller-report';
import { isSystemGeneratedComment } from '../../shared/systemComment';
import { cached, cacheDel, cacheDelPrefix } from '../../shared/cache';

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
//   zombie  — no comment in > 3 days (the AI already treats stale comments as
//             not meaningful, so these estimates are dead weight)
//   red     — latest AI verdict has meaningfulUpdate=false, OR the latest
//             comment is older than 24h even though it was satisfactory (a
//             stale-but-positive comment still means nobody chased it today —
//             eligible for EOD snatch)
//   pending — no AI verdict yet
//   ok      — latest comment was meaningful AND fresh (< 24h)
export const ZOMBIE_DAYS = 3;
/** A meaningful comment older than this (hours) is still a snatch candidate. */
export const FRESH_HOURS = 24;
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
  /** MIS override: estimate is locked to one agent — never re-poached, even when red/zombie. */
  locked: boolean;
  /** MIS override: estimate is never assigned to any agent. */
  skipAssignment: boolean;
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
  // Zoho's dateFormatted is IST local, e.g. "05/09/2026 02:23 PM". Parsing it as
  // UTC (or the date-only `date` column, "2026-09-05", as midnight UTC) makes
  // every today-comment look ~12h stale — so build an explicit +05:30 instant.
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m) {
    let h = parseInt(m[4], 10);
    if (m[6].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (m[6].toUpperCase() === 'AM' && h === 12) h = 0;
    const iso = `${m[3]}-${m[2]}-${m[1]}T${String(h).padStart(2, '0')}:${m[5]}:00+05:30`;
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return t;
  }
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
      select: { estimateId: true, date: true, dateFormatted: true },
    });
    for (const c of comments) {
      if (!c?.estimateId) continue;
      // Prefer the full IST timestamp (has time-of-day); the plain `date` is
      // date-only and would read as midnight UTC. Keep the true newest comment
      // per estimate (orderBy date is ambiguous within a day).
      const raw = c.dateFormatted ?? c.date ?? '';
      const ts = parseCommentDateMs(raw);
      const cur = out.get(c.estimateId);
      const curTs = cur ? parseCommentDateMs(cur) : null;
      if (curTs === null || (ts !== null && ts > curTs)) out.set(c.estimateId, raw);
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
  // A satisfactory comment only keeps the estimate safe while it's FRESH.
  // If the last meaningful comment is older than FRESH_HOURS, nobody has chased
  // it today — it becomes an EOD snatch candidate (red) even though the AI
  // verdict was positive.
  if (!cls.meaningfulUpdate || (staleHours !== null && staleHours > FRESH_HOURS)) {
    return { risk: 'red', staleHours };
  }
  return { risk: 'ok', staleHours };
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
  if (risk === 'zombie') return 'No reply in over 3 days — reassigned to a better converter';
  // Satisfactory-but-stale: the AI verdict was positive but the last comment is
  // older than FRESH_HOURS — nobody chased it today, so it's a snatch candidate.
  if (risk === 'red' && est.classification?.meaningfulUpdate) {
    return 'Last update was satisfactory but stale (older than 24h) — reassigned to a better converter';
  }
  const reasoning = est.classification?.reasoning;
  if (reasoning && reasoning.trim() && reasoning.trim() !== 'No sales agent comment found.') {
    const verdict = est.classification?.meaningfulUpdate ? 'meaningful update' : 'unsatisfactory remark';
    const clipped = reasoning.trim().slice(0, 140);
    return `EOD snatch (${verdict}): ${clipped}`;
  }
  return 'Unsatisfactory remark at end of day — reassigned to a better converter';
}

// ── Risk cache (KV-backed, D1 row-read budget protection) ───────────────────
// The risk model scans all open estimates + their latest comment dates, which
// is expensive. Dashboards refetch on every runner WebSocket broadcast (every
// 15 min, the Zoho analyzer cadence), so the scan is cached in KV with a short
// TTL. Stale-upon-error: if the cached copy is older than TTL it is still
// served when a refresh fails (graceful degradation, no retry loops).
export const RISK_CACHE_KEY = 'telecalling:risk_cache';
const RISK_CACHE_TTL_MS = 15 * 60 * 1000;

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
      locked: !!(e as any).lockedTelecallerId,
      skipAssignment: !!(e as any).skipAssignment,
    };
  });
  return { items, computedAt: new Date(nowMs).toISOString() };
}

/**
 * Risk items for the open pipeline, served from a 15-min KV cache.
 * On refresh failure, serves the stale snapshot (graceful degradation) rather
 * than burning more D1 row reads with retry loops.
 */
async function getRiskItems(): Promise<CachedRiskItem[]> {
  return cached<CachedRiskItem[]>(RISK_CACHE_KEY, RISK_CACHE_TTL_MS, async () => {
    const computed = await computeRiskCache();
    return computed.items;
  });
}

/**
 * Invalidate the risk cache when underlying estimate/comment data changes
 * (status transition, classification, comment sync, or a manual re-deal).
 * Also invalidates every cached dashboard payload so the leaderboard/lead-gen
 * views re-aggregate from fresh state on the next read.
 */
export async function invalidateRiskCache(): Promise<void> {
  await cacheDel(RISK_CACHE_KEY);
  try { await cacheDelPrefix('telecalling:dashboard'); } catch { /* non-fatal */ }
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
          assignEstimateFollowUps: true,
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

// The conversion-specialist pool: only telecallers flagged to hold estimate
// follow-ups receive assignments (new deals + EOD re-poaching). Everyone else
// still generates leads but never holds estimates.
async function getFollowUpSpecialists(): Promise<Telecaller[]> {
  return prisma.telecaller.findMany({ where: { assignEstimateFollowUps: true, deleted: false }, orderBy: { order: 'asc' } });
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
  const telecallers = await getFollowUpSpecialists();
  if (telecallers.length === 0) return { assigned: 0 };

  const sent = await prisma.estimate.findMany({
    where: { status: 'sent', skipAssignment: false },
    orderBy: [{ date: 'asc' }, { estimateId: 'asc' }],
    select: { estimateId: true, lockedTelecallerId: true, assignedTelecallerId: true },
  });
  if (sent.length === 0) return { assigned: 0 };

  const lastId = await getRotationPointer();
  let idx = telecallers.findIndex((t) => t.id === lastId);
  idx = idx >= 0 ? (idx + 1) % telecallers.length : 0;

  let assigned = 0;
  let lastUsed = '';
  for (const est of sent) {
    // Locked estimates (MIS override) always go to their locked agent and are
    // never rotated away — "despite whatever the case".
    const locked = (est as any).lockedTelecallerId as string | null;
    const tcId = locked || telecallers[idx].id;
    lastUsed = tcId;
    if (!locked) idx = (idx + 1) % telecallers.length;
    await prisma.estimate.update({
      where: { estimateId: est.estimateId },
      data: { assignedTelecallerId: tcId },
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
  const telecallers = await getFollowUpSpecialists();
  if (telecallers.length === 0) return { assigned: 0, reassigned: 0 };
  // All non-deleted telecallers, for creator inference — a lead-gen creator who
  // isn't flagged for follow-ups can still claim the estimate they generated.
  const allTelecallers = await prisma.telecaller.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } });

  const sent = await prisma.estimate.findMany({
    where: { status: 'sent', skipAssignment: false },
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

  // Candidates: unassigned OR at-risk — highest value first. Locked estimates
  // (MIS override) are only candidates if they are NOT already with their locked
  // agent, so they get placed/enforced but are NEVER re-poached away from it —
  // even when red/zombie ("despite whatever the case").
  const candidates = sent
    .filter((e) => {
      const locked = (e as any).lockedTelecallerId as string | null;
      if (locked) return String(e.assignedTelecallerId ?? '') !== String(locked);
      if (!e.assignedTelecallerId) return true;
      const risk = riskByEstimate.get(e.estimateId);
      return risk === 'red' || risk === 'zombie';
    })
    .sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));

  let assigned = 0;
  let reassigned = 0;
  const { conversionWeight, loadWeight } = ASSIGN_TUNING;
  const today = istDate();
  for (const est of candidates) {
    const wasAssigned = !!est.assignedTelecallerId;
    const risk = riskByEstimate.get(est.estimateId) ?? 'pending';
    const locked = (est as any).lockedTelecallerId as string | null;
    // Locked estimates go straight to their locked agent — no creator inference,
    // no best-fit routing, no snatch penalty (this is an MIS lock, not an EOD
    // snatch). "Despite whatever the case."
    const reason = buildSnatchReason(est, risk);
    let bestId = locked ?? '';
    if (!bestId) {
      // Sole-creator first claim: a never-assigned estimate whose first comments
      // name a sales agent is dealt to that agent (he generated the lead), before
      // falling back to best-fit conversion routing for unassigned estimates.
      if (!wasAssigned && !(est as any).createdBy) {
        const creatorId = await inferEstimateCreator(est.estimateId, allTelecallers);
        if (creatorId) {
          bestId = creatorId;
          await prisma.estimate.update({
            where: { estimateId: est.estimateId },
            data: { createdBy: creatorId },
          });
        }
      }
    }
    let bestScore = -Infinity;
    let bestLoad = Infinity;
    if (!bestId) {
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
    }
    if (!bestId) continue;
    // If the current holder is being re-poached, the NEW row keeps the same
    // snatchReason (why the estimate left the previous holder). Fresh deals get
    // a null reason. Lock enforcement is not a snatch — no snatchReason.
    const movedFrom = est.assignedTelecallerId;
    await prisma.estimate.update({
      where: { estimateId: est.estimateId },
      data: { assignedTelecallerId: bestId },
    });
    await recordAssignment(est.estimateId, bestId, wasAssigned && !locked ? reason : null);
    loadCount.set(bestId, (loadCount.get(bestId) ?? 0) + 1);
    if (wasAssigned) {
      reassigned += 1;
      // The agent who lost the estimate at the EOD snatch gets -15 (unsatisfactory
      // remark or silent > 2 days). Charged to the holder who was re-poached FROM.
      // Lock enforcement is NOT a snatch, so it never triggers the -15 penalty.
      if (movedFrom && !locked) {
        await recordSnatchPenalty(String(movedFrom), est.estimateId, today, reason);
      }
    } else {
      assigned += 1;
    }
  }

  logger.info(
    { assigned, reassigned, candidates: candidates.length, telecallers: telecallers.length },
    'Stability-first conversion-maximising assignment complete',
  );
  // Assignments changed the open-pipeline ownership — invalidate the risk cache
  // so the next dashboard read reflects the fresh state.
  if (assigned > 0 || reassigned > 0) {
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
  }
  return { assigned, reassigned };
}

/**
 * Record an assignment into the EstimateAssignment chain (single source of truth
 * for fair close-credit). Resolves the previous open row first (if any), then
 * inserts the new holder linked via reassignedFromId. `snatchReason` (why the
 * previous holder lost it at EOD) is persisted so the losing agent sees exactly
 * what cost them the deal.
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

// ── Creator inference ────────────────────────────────────────────────────────
// When a new estimate is created, sales agents usually write their name in the
// first 1-2 comments (e.g. "muskan", "samar" for Samarjeet). Infer which active
// telecaller created it so the estimate is saved to him and he gets first claim
// as the sole creator of that lead generation.

/** Normalise a name for fuzzy matching (lowercase, strip non-alpha). */
function normName(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Match a comment author name against a telecaller name (prefix/substring
 * tolerant so "samar" matches "Samarjeet"). Requires a minimum length to avoid
 * false positives from initials. */
function creatorMatches(author: string, name: string): boolean {
  const a = normName(author);
  const b = normName(name);
  if (!a || !b) return false;
  if (a === b) return true;
  // prefix match: samar → samarjeet (either direction)
  if (a.length >= 3 && (b.startsWith(a) || a.startsWith(b))) return true;
  // token match: "samarjeet s" vs "samarjeet" — check each whitespace token
  const aTokens = a.split(' ').filter((t) => t.length >= 3);
  const bTokens = b.split(' ').filter((t) => t.length >= 3);
  return aTokens.some((t) => bTokens.some((bt) => bt.startsWith(t) || t.startsWith(bt)));
}

/**
 * Infer which active telecaller created this estimate from its first real sales
 * comments (skipping Zoho system auto-logs). Returns the telecaller id, or null
 * when the author can't be matched to any active telecaller.
 */
async function inferEstimateCreator(estimateId: string, telecallers: Telecaller[]): Promise<string | null> {
  try {
    const comments = await prisma.comment.findMany({
      where: { estimateId },
      orderBy: { date: 'asc' },
      take: 3,
      select: { description: true, commentedBy: true },
    });
    for (const c of comments) {
      if (isSystemGeneratedComment(c.description, c.commentedBy)) continue;
      const author = (c.commentedBy || '').trim();
      if (!author) continue;
      for (const tc of telecallers) {
        if (creatorMatches(author, tc.name) || creatorMatches(author, tc.neodoveUserName ?? '')) {
          return tc.id;
        }
      }
    }
    return null;
  } catch (e: any) {
    logger.warn({ err: e?.message, estimateId }, 'inferEstimateCreator failed');
    return null;
  }
}

// ── Event-ledger scoring ─────────────────────────────────────────────────────
// The leaderboard is driven by an append-only score ledger: +100 when an
// estimate the agent held converts (credited to the holder at conversion), -15
// per EOD snatch (charged to the agent who lost it for an unsatisfactory
// remark). Each row records the IST day, so any timeframe (week/month/year) can
// be summed with a simple day-range filter — the weekly view restarts at zero
// automatically.
const CLOSE_POINTS = 100;
const SNATCH_PENALTY = -15;
const DECLINE_PENALTY = -20;

/**
 * Append a score event to the ledger. day is the IST date the event happened.
 * Idempotent callers guard duplicates at the call site.
 */
async function recordScoreEvent(telecallerId: string, estimateId: string, delta: number, day: string, reason: string | null = null): Promise<void> {
  try {
    await prisma.telecallerScoreEvent.create({
      data: { telecallerId, estimateId, delta, day, reason, createdAt: new Date() },
    });
  } catch (e: any) {
    logger.warn({ err: e?.message, estimateId }, 'recordScoreEvent failed — continuing without event');
  }
}

/**
 * Credit +100 to the current holder the moment an estimate converts (status →
 * accepted/confirmed). No-op if the estimate is not won or has no holder.
 * Duplicate-guarded: one +100 per estimate, ever.
 */
export async function recordConversionClose(estimateId: string): Promise<void> {
  try {
    const est = await prisma.estimate.findUnique({
      where: { estimateId },
      select: { status: true, assignedTelecallerId: true },
    });
    if (!est || !(est.status === 'accepted' || est.status === 'confirmed')) return;
    const holder = est.assignedTelecallerId;
    if (!holder) return;
    const existing = await prisma.telecallerScoreEvent.findFirst({
      where: { estimateId, delta: CLOSE_POINTS },
    });
    if (existing) return;
    await recordScoreEvent(String(holder), estimateId, CLOSE_POINTS, istDate(), 'Estimate converted — full points to lead converter');
  } catch (e: any) {
    logger.warn({ err: e?.message, estimateId }, 'recordConversionClose failed');
  }
}

/**
 * Charge -15 to the agent who lost an estimate at the EOD snatch. Called when a
 * red/zombie estimate is re-poached away from its current holder.
 */
async function recordSnatchPenalty(telecallerId: string, estimateId: string, day: string, reason: string | null): Promise<void> {
  await recordScoreEvent(telecallerId, estimateId, SNATCH_PENALTY, day, reason ?? 'EOD snatch — unsatisfactory remark');
}

/**
 * Charge -20 per holding to EVERY agent who held an estimate if it is declined
 * after 3+ days (ZOMBIE_DAYS). Called on a status transition to declined. Walks
 * the full EstimateAssignment chain and counts how many times each agent held
 * the estimate (each assignment row = one holding, e.g. snatched away then given
 * back counts twice). An agent who held it 3 times is penalised -20 × 3 = -60.
 * Idempotent: the whole decline penalty is recorded once per estimate — if a -20
 * already exists for this estimate it is never re-charged.
 */
export async function recordDeclinePenalty(estimateId: string): Promise<void> {
  try {
    const est = await prisma.estimate.findUnique({
      where: { estimateId },
      select: { status: true, date: true },
    });
    if (!est || est.status !== 'declined') return;
    const days = est.date ? Math.max(0, Math.floor((Date.now() - Date.parse(String(est.date))) / 86400000)) : 0;
    if (days < ZOMBIE_DAYS) return;

    // Idempotency: this estimate's decline penalty is applied once, ever.
    const alreadyPenalised = await prisma.telecallerScoreEvent.findFirst({
      where: { estimateId, delta: DECLINE_PENALTY },
    });
    if (alreadyPenalised) return;

    const rows = await prisma.estimateAssignment.findMany({
      where: { estimateId },
      select: { telecallerId: true },
      orderBy: { assignedAt: 'asc' },
    });
    // Count every holding per agent (each assignment row = one holding).
    const holdings = new Map<string, number>();
    for (const r of rows) {
      const tid = String(r.telecallerId);
      holdings.set(tid, (holdings.get(tid) ?? 0) + 1);
    }
    for (const [tid, count] of holdings) {
      for (let i = 0; i < count; i++) {
        await recordScoreEvent(tid, estimateId, DECLINE_PENALTY, istDate(), `Estimate declined after 3+ days — holding #${i + 1} penalised`);
      }
    }
  } catch (e: any) {
    logger.warn({ err: e?.message, estimateId }, 'recordDeclinePenalty failed');
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
  assignEstimateFollowUps: boolean;
  neodoveUserName: string | null;
  conversion: {
    assigned: number;
    won: number;
    conversionRate: number;
    pipelineValue: number;
    // Forward-looking: expected closed value given the agent's win rate and the
    // live risk of each open estimate. count = expected number of closes.
    estimatedConversion: { count: number; value: number };
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
  // Event-ledger points for the period: +100 per converted estimate (credited
  // to the holder at conversion), -15 per EOD snatch (charged to the losing
  // agent). Summed over the period so the weekly view resets to zero naturally.
  points: { closes: number; snatches: number; total: number };
  // Live pipeline risk: open estimates currently red (no meaningful update) or
  // zombie (silent > 2 days) — the EOD reassignment candidates.
  risk: { atRisk: number; zombie: number };
}

/** Shift a YYYY-MM-DD string by N days (UTC arithmetic on the date parts). */
function shiftDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** IST date range for a leaderboard period. null = today (default view). */
export function periodRange(period: string, todayStr: string): { from: string; to: string; label: string } | null {
  const [y, m, d] = todayStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  const backToMonday = (dow + 6) % 7;
  switch (period) {
    case 'week': {
      const monday = shiftDays(todayStr, -backToMonday);
      return { from: monday, to: todayStr, label: 'This Week' };
    }
    case 'lastweek': {
      const monday = shiftDays(todayStr, -backToMonday);
      return { from: shiftDays(monday, -7), to: shiftDays(monday, -1), label: 'Last Week' };
    }
    case 'month':
      return { from: todayStr.slice(0, 8) + '01', to: todayStr, label: 'This Month' };
    case 'lastmonth': {
      const prevLast = new Date(Date.UTC(y, m - 1, 0));
      return { from: prevLast.toISOString().slice(0, 8) + '01', to: prevLast.toISOString().slice(0, 10), label: 'Last Month' };
    }
    case 'year':
      return { from: `${y}-01-01`, to: todayStr, label: 'This Year' };
    case 'lastyear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: 'Last Year' };
    default:
      return null;
  }
}

/** Working days (Mon–Sat, 6-day work week) inclusive between two IST dates. */
function workingDaysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  if (end < start) return 0;
  let days = 0;
  for (let t = start; t <= end; t += 86400000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0) days += 1; // exclude Sunday only (6-day work week)
  }
  return Math.max(1, days);
}

/**
 * Unified dashboard payload: per-telecaller Lead Conversion + Lead Generation
 * metrics for a given day (default: today, IST), team KPIs, and a live
 * leaderboard. `?period=week|lastweek|month|lastmonth|year|lastyear` switches
 * the leaderboard to an aggregated period view (assignment history + summed
 * NeoDove daily reports).
 *
 * The payload is cached in KV per (period, day, agent) so switching filters and
 * refreshing dashboards is fast — the underlying aggregation reads the full
 * EstimateAssignment history + score events, which is expensive on every hit.
 * A short TTL + single-flight means concurrent users share one compute.
 */
export async function getTelecallingDashboardData(ctx?: AutomationContext): Promise<any> {
  const q = (ctx?.subject ?? {}) as Record<string, unknown>;
  const requestedDay = typeof q.date === 'string' && DATE_RE.test(q.date) ? q.date : istDate();
  const period = typeof q.period === 'string' && q.period ? q.period : 'today';
  const agent = typeof q.agent === 'string' && q.agent ? q.agent : '';
  const cacheKey = `telecalling:dashboard:${period}:${requestedDay}:${agent}`;
  const DASH_TTL_MS = 30 * 1000;
  return cached<any>(cacheKey, DASH_TTL_MS, async () => {
    return computeTelecallingDashboardData(ctx);
  });
}

/**
 * The actual (expensive) aggregation. Exposed for reuse and clarity; the public
 * `getTelecallingDashboardData` wraps this in the KV cache.
 */
export async function computeTelecallingDashboardData(ctx?: AutomationContext): Promise<any> {
  const q = (ctx?.subject ?? {}) as Record<string, unknown>;
  const date = typeof q.date === 'string' && DATE_RE.test(q.date) ? q.date : undefined;
  const requestedDay = date ?? istDate();
  const periodRangeInfo = periodRange(typeof q.period === 'string' ? q.period : 'today', istDate());
  const periodMode = periodRangeInfo !== null;

  // Auto-sync the Telecaller roster from the unique NeoDove agents (all stored
  // days). Idempotent — no-op once every agent is already present.
  await syncTelecallersFromNeodove();

  // If the requested day has no NeoDove data yet, fall back to the latest stored
  // NeoDove day so Lead Generation shows real numbers instead of all zeros.
  let day = requestedDay;
  let neodoveMap: Record<string, any> = {};
  let usingLatestAvailable = false;
  if (periodMode && periodRangeInfo) {
    // Period leaderboard: sum the stored daily NeoDove reports across the range.
    neodoveMap = await getNeodoveRangeMap(periodRangeInfo.from, periodRangeInfo.to);
  } else {
    neodoveMap = await getNeodoveAgentMap(requestedDay);
    if (Object.keys(neodoveMap).length === 0) {
      const latest = await getLatestNeodoveDay();
      if (latest && latest !== requestedDay) {
        day = latest;
        neodoveMap = await getNeodoveAgentMap(latest);
        usingLatestAvailable = true;
      }
    }
  }

  const telecallers = await prisma.telecaller.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } });
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
  let openByOwner = new Map<string, { count: number; value: number }>();
  for (const e of owned) {
    const owner = String(e.assignedTelecallerId);
    if (e.status === 'sent') {
      const cur = openByOwner.get(owner) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += Number(e.total ?? 0) || 0;
      openByOwner.set(owner, cur);
    }
  }

  // ── Period mode: conversion from the assignment history (EstimateAssignment
  // rows whose `day` falls inside the range). Assigned = assignment rows in the
  // period; Won = those estimates that have since closed; pipeline = the open
  // `sent` estimates assigned in the period. Credit split is today-only.
  let assignedByOwner: Map<string, number> | null = null;
  let periodOpenIds: Set<string> | null = null;
  if (periodMode && periodRangeInfo) {
    const { from, to } = periodRangeInfo;
    openByOwner = new Map();
    assignedByOwner = new Map();
    periodOpenIds = new Set();
    let assignRows: any[] = [];
    try {
      assignRows = await prisma.estimateAssignment.findMany({
        where: { day: { gte: from, lte: to } },
        select: { telecallerId: true, estimateId: true },
      });
    } catch (e: any) {
      logger.warn({ err: e?.message }, 'period assignment read failed — period leaderboard shows generation only');
    }
    const estIds = [...new Set(assignRows.map((r: any) => r.estimateId))];
    const estById = new Map<string, any>();
    if (estIds.length > 0) {
      // Chunk to stay under SQLite's ~999 bound-parameter limit per query.
      for (let i = 0; i < estIds.length; i += 500) {
        const chunk = estIds.slice(i, i + 500);
        try {
          const ests = await prisma.estimate.findMany({
            where: { estimateId: { in: chunk } },
            select: { estimateId: true, status: true, total: true },
          });
          for (const e of ests) estById.set(e.estimateId, e);
        } catch (e: any) {
          logger.warn({ err: e?.message, chunk: i }, 'period estimate chunk read failed');
        }
      }
    }
    for (const r of assignRows) {
      const id = String(r.telecallerId);
      assignedByOwner.set(id, (assignedByOwner.get(id) ?? 0) + 1);
      const e = estById.get(r.estimateId);
      if (!e) continue;
      if (e.status === 'sent') {
        periodOpenIds.add(r.estimateId);
        const cur = openByOwner.get(id) ?? { count: 0, value: 0 };
        cur.count += 1;
        cur.value += Number(e.total ?? 0) || 0;
        openByOwner.set(id, cur);
      }
    }
  }

  // Event-ledger points for the leaderboard period: +100 per converted estimate
  // (credited to the holder at conversion), -15 per EOD snatch (charged to the
  // losing agent). Filtered by day range so the weekly view restarts at zero —
  // everyone gets a fair shot on the table each week.
  const pointsFrom = periodMode && periodRangeInfo ? periodRangeInfo.from : day;
  const pointsTo = periodMode && periodRangeInfo ? periodRangeInfo.to : day;
  const pointsByOwner = new Map<string, { closes: number; snatches: number; total: number }>();
  try {
    const events = await prisma.telecallerScoreEvent.findMany({
      where: { day: { gte: pointsFrom, lte: pointsTo } },
      select: { telecallerId: true, delta: true },
    });
    for (const ev of events) {
      const cur = pointsByOwner.get(String(ev.telecallerId)) ?? { closes: 0, snatches: 0, total: 0 };
      if (ev.delta > 0) cur.closes += 1;
      else cur.snatches += 1;
      cur.total += ev.delta;
      pointsByOwner.set(String(ev.telecallerId), cur);
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'score events read failed — leaderboard points unavailable');
  }

  const leaderboard: TelecallerDayMetrics[] = [];
  // Lead Generation targets scale with the period's working days (6-day work
  // week, Mon–Sat) — a week target is one day × working days, never 1×.
  const workingDays = periodMode && periodRangeInfo ? workingDaysBetween(periodRangeInfo.from, periodRangeInfo.to) : 1;
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
    // "Won" = estimates actually CONVERTED in this timeframe, from the +100
    // event ledger (day = the day the estimate converted). NOT the count of
    // currently-held accepted/confirmed estimates (that's lifetime and would
    // show wins from weeks ago on "Today"). The weekly view therefore restarts
    // at zero naturally.
    const won = pointsByOwner.get(tc.id)?.closes ?? 0;
    const assignedToday = periodMode && assignedByOwner ? (assignedByOwner.get(tc.id) ?? 0) : open.count;
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
    const connectedTarget = CONNECTED_CALLS_PER_DAY * workingDays;
    const connectedPct = connectedTarget > 0 ? Math.round((callsConnected / connectedTarget) * 100) : 0;
    const connectedStatus: 'green' | 'amber' | 'red' =
      connectedPct >= 100 ? 'green' : connectedPct >= 60 ? 'amber' : 'red';
    const leadsTarget = LEADS_PER_AGENT_PER_DAY * workingDays;
    const leadsPct = leadsTarget > 0 ? Math.round((leadsGenerated / leadsTarget) * 100) : 0;
    const leadsStatus: 'green' | 'amber' | 'red' =
      leadsPct >= 100 ? 'green' : leadsPct >= 60 ? 'amber' : 'red';

    // Composite score (tunable, the leaderboard norm): a converted estimate
    // weighs +100, an EOD snatch (unsatisfactory remark) −15, a generated lead
    // +15 and a connected call +0.5. Wins drive competition; snatches penalise
    // losing a deal so nobody parks on a dead pipeline.
    const snatches = pointsByOwner.get(tc.id)?.snatches ?? 0;
    const score = won * 100 - snatches * 15 + leadsGenerated * 15 + Math.round(callsConnected * 0.5);

    kpiAcc.assigned += assignedToday;
    kpiAcc.won += won;
    kpiAcc.pipelineValue += pipelineValue;
    kpiAcc.callsConnected += callsConnected;
    kpiAcc.leadsGenerated += leadsGenerated;
    kpiAcc.talkTimeSec += talkTimeSec;

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
      if (periodMode && periodOpenIds && !periodOpenIds.has(r.estimateId)) continue;
      const prob = cap(baseWin * toCloseMultiplier(r.risk));
      estCount += prob;
      estValue += r.total * prob;
    }
    const estimatedConversion = { count: Math.round(estCount * 10) / 10, value: Math.round(estValue) };

    leaderboard.push({
      id: tc.id,
      name: tc.name,
      assignEstimateFollowUps: tc.assignEstimateFollowUps,
      neodoveUserName: tc.neodoveUserName,
      conversion: { assigned: assignedToday, won, conversionRate, pipelineValue, estimatedConversion },
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
      points: pointsByOwner.get(tc.id) ?? { closes: 0, snatches: 0, total: 0 },
      risk: riskByOwner.get(tc.id) ?? { atRisk: 0, zombie: 0 },
    });
  }

  // Rank by event-ledger points first (conversion outcomes: +100 closes, -15
  // snatches) — the metric that reflects who actually converted pipeline in the
  // period. Tie-break by projected closed value, then by the composite score.
  leaderboard.sort((a, b) => {
    const rankA = b.points.total - a.points.total;
    if (rankA !== 0) return rankA;
    const estA = a.conversion.estimatedConversion.value;
    const estB = b.conversion.estimatedConversion.value;
    if (estB - estA !== 0) return estB - estA;
    return b.score - a.score;
  });

  // Self-contained agent list so the dashboard can build the per-agent dropdown
  // without a second round-trip.
  const agentList = telecallers.map((t) => ({ id: t.id, name: t.name, active: t.assignEstimateFollowUps }));

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
        active: tc.assignEstimateFollowUps,
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

  const activeCount = telecallers.filter((t) => t.assignEstimateFollowUps).length;

  return {
    meta: {
      analysis: 'telecalling',
      title: 'Telecalling — Daily Performance',
      day,
      requestedDay,
      usingLatestAvailable,
      period: periodMode && periodRangeInfo ? q.period : 'today',
      periodLabel: periodRangeInfo?.label ?? 'Today',
      periodFrom: periodRangeInfo?.from ?? null,
      periodTo: periodRangeInfo?.to ?? null,
      generatedAt: new Date().toISOString(),
      unassignedSent,
      telecallerCount: telecallers.length,
      activeCount,
      agents: agentList,
      targets: {
        connectedCallsPerDay: CONNECTED_CALLS_PER_DAY * workingDays,
        leadsPerAgentPerDay: LEADS_PER_AGENT_PER_DAY * workingDays,
      },
      workingDays,
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
