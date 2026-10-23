/**
 * Telecalling automation — Sales Leaderboard (region model).
 *
 * Founder decision (2026-10-22): estimates are owned by REGIONS (R1–R4),
 * not individuals. There is no dealing engine, no assignment rotation, no
 * cover/EOD machinery — staff hold and work estimates only in their own
 * region. Score model per close: the enquiry GENERATOR (Estimate.createdBy,
 * written by the mapping enquiry) banks 20% of the slab automatically
 * (recordConversionClose); the other 80% goes to a CLOSER picked manually by
 * sales-head (creditCloserShare) from the same region's conversion
 * specialists. This module provides runLeadConversion (roster sync + link
 * sweep) and computeTelecallingDashboardData (the full leaderboard payload).
 */
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import type { Telecaller } from '@prisma/client';
import type { AutomationContext } from '../../modules/automation/types';
import { getNeodoveAgentMap, getLatestNeodoveDay, getNeodoveRangeMap, CONNECTED_CALLS_PER_DAY, LEADS_PER_AGENT_PER_DAY } from '../neodove-telecaller-report';
import { isSystemGeneratedComment } from '../../shared/systemComment';
import { cached } from '../../shared/cache';
import {
  ZOMBIE_DAYS, FRESH_HOURS, parseCommentDateMs, latestCommentDates,
  classifyRisk, buildSnatchReason, RISK_CACHE_KEY, computeRiskCache, getRiskItems,
  invalidateRiskCache,
  type EstimateRisk, type RiskItem, type CachedRiskItem, type RiskCache,
} from './risk';
import {
  CLOSE_SLABS, closePointsFor, isCloseDelta, splitClosePoints,
  recordConversionClose, creditCloserShare, pendingCloserPicks,
  deleteCloseHistory, getEpochDate, EPOCH_SETTING_KEY,
  getConvertersMap, SNATCH_PENALTY, REMARK_PENALTY,
} from './scoring';
import { getFollowUpSpecialists, recordAssignment } from './rotation';
import { syncTelecallersFromNeodove } from './roster';
import {
  CALL_TAGS, CALLBACK_MAX_DAYS, setEstimateCallTag,
  NEXT_STEP_MAX_DAYS, setEstimateNextStep, overlayNextSteps, overlayCallTags,
  type CallTag,
} from './call-tags';
import { linkEnquiryEstimate, sweepEnquiryEstimateLinks, type EnquiryLinkResult } from './enquiry-links';
import { REGIONS, TL_LEVELS, type RegionId, type TlLevel } from './regions';
import { DATE_RE, IN_BATCH, istDate } from './util';

// ── Accepted-value KPI targets ─────────────────────────────────────────────
// "Won ₹" = total ₹ of ACCEPTED estimates closed in the selected period
// (from the close-event ledger, valued at each estimate's total).
// Daily thresholds (founder-set): ₹5L = target hit (celebrate), ₹10L = gold.
// Period targets scale linearly by working days (Mon–Sat): a week holds up to
// 6× the daily bar, a month ~26×, so every filter has a fair proportional goal.
export const CONVERSION_TARGET_DAILY = 500_000;
export const CONVERSION_GOLD_DAILY = 1_000_000;

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

const RISK_LIST_CAP = 25;

// ── Enquiry-sourced lead generation ──────────────────────────────────────────
// "Leads generated" = enquiries created per agent per IST day (Sales Enquiries
// dashboard: Enquiry.createdAt × assignedAgentId). NeoDove still feeds calls,
// talk-time and call outcomes — only the leads-generated numerator is
// enquiry-sourced.

/** Day → agent lead counts for an inclusive IST range. Key `${day}|${agentId}`.
 *  Unattributed rows (assignedAgentId empty — no roster match) are counted
 *  under the UNATTRIBUTED_LEADS_KEY sentinel so they surface in meta instead
 *  of vanishing silently. Callers must skip the sentinel when attributing. */
export const UNATTRIBUTED_LEADS_KEY = '|unattributed';
async function getEnquiryLeadCounts(from: string, to: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    // Unfiltered read + JS-side IST-day gate (portable across D1/Postgres
    // date storage; the Enquiry table is small).
    const rows = await prisma.enquiry.findMany({
      select: { assignedAgentId: true, createdAt: true },
    });
    for (const r of (rows as any[]) ?? []) {
      const d = istDayOf(r?.createdAt);
      if (!d || d < from || d > to) continue;
      const agent = String(r?.assignedAgentId ?? '').trim();
      const k = agent ? `${d}|${agent}` : UNATTRIBUTED_LEADS_KEY;
      out.set(k, (out.get(k) ?? 0) + 1);
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'enquiry lead counts read failed — leads show 0');
  }
  return out;
}

/** Daily automation run: refresh the roster, resolve pending enquiry→estimate
 *  region links. (The old assignment dealing is retired — regions own
 *  estimates now.) */
export async function runLeadConversion(): Promise<{ linked: number }> {
  await syncTelecallersFromNeodove();
  try { await sweepEnquiryEstimateLinks(); } catch { /* non-fatal — run still completes */ }
  return { linked: 0 };
}

/** Shift a YYYY-MM-DD string by N days (UTC arithmetic on the date parts). */
function shiftDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** IST date range for a leaderboard period. null = today (default view). */
export function periodRange(period: string, todayStr: string): { from: string; to: string; label: string } | null {  const [y, m, d] = todayStr.split('-').map(Number);
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
function workingDaysBetween(from: string, to: string): number {  const [fy, fm, fd] = from.split('-').map(Number);
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

/** IST day (YYYY-MM-DD) of a stored Date/ISO value. null when unparseable. */
function istDayOf(val: unknown): string | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(String(val));
  if (Number.isNaN(d.getTime())) return null;
  return istDate(d);
}

export interface TelecallingDailyRow {
  date: string;
  weekday: string;
  telecallerId: string;
  telecallerName: string;
  region: string;
  won: number;
  closedValue: number;
  /** Accepted estimate numbers that day ("EST-.., EST-.." or ""). */
  closedEstimates: string;
  callsAttempted: number;
  callsConnected: number;
  callsNotConnected: number;
  talkTimeMin: number;
  leadsGenerated: number;
  leadsConverted: number;
  score: number;
}

/** YYYY-MM-DD list inclusive. null when the range exceeds the cap. */
function listDays(from: string, to: string, cap = 93): string[] | null {
  const out: string[] = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if ([fy, fm, fd, ty, tm, td].some((n) => !Number.isFinite(n))) return [];
  let t = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  if (end < t) return [];
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    if (out.length > cap) return null;
    t += 86400000;
  }
  return out;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function weekdayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if ([y, m, d].some((n) => !Number.isFinite(n))) return '';
  return WEEKDAY_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
}

/**
 * Per-day × per-staff MIS breakdown for an inclusive IST range (region
 * model). Sources per day: close-credit events split 20/80 across
 * generator/closer rows (+ legacy full-slab rows), accepted estimate values,
 * enquiry-sourced leads and the stored NeoDove day snapshot. Gated by the
 * history epoch (getEpochDate) — pre-epoch rows never count.
 */
export async function computeTelecallingDaily(
  from: string,
  to: string,
): Promise<{ rows: TelecallingDailyRow[] } | { error: string }> {
  const dates = listDays(from, to);
  if (dates === null) return { error: 'daily breakdown capped at 93 days — pick week/month, not year' };
  if (dates.length === 0) return { rows: [] };
  const epoch = await getEpochDate();
  const fromEff = epoch && epoch > from ? epoch : from;
  if (fromEff > to) return { rows: [] };
  const telecallers = await prisma.telecaller.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } });
  const nameById = new Map(telecallers.map((t) => [t.id, t.name]));

  type DayAgg = { won: number; closePoints: number; estIds: string[] };
  const agg = new Map<string, DayAgg>(); // `${day}|${owner}`
  const cell = (day: string, owner: string): DayAgg => {
    const k = `${day}|${owner}`;
    let c = agg.get(k);
    if (!c) { c = { won: 0, closePoints: 0, estIds: [] }; agg.set(k, c); }
    return c;
  };

  try {
    const events = await prisma.telecallerScoreEvent.findMany({
      where: { day: { gte: fromEff, lte: to } },
      select: { telecallerId: true, kind: true, delta: true, estimateId: true, day: true },
    });
    for (const ev of events as any[]) {
      const day = String(ev.day ?? '');
      if (!day) continue;
      if (String(ev.kind ?? '') === 'generator' || String(ev.kind ?? '') === 'closer'
        || (String(ev.kind ?? '') === '' && isCloseDelta(ev.delta))) {
        const c = cell(day, String(ev.telecallerId));
        if (ev.estimateId && !c.estIds.includes(String(ev.estimateId))) {
          c.won += 1;
          c.estIds.push(String(ev.estimateId));
          c.closePoints += Number(ev.delta) || 0;
        }
      }
      // Legacy −10/−15 rows are not plotted by the region board's export.
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'daily: score events read failed');
  }

  // Value + tags for closes (chunked for SQLite's bound limit).
  const valueById = new Map<string, number>();
  const numberById = new Map<string, string>();
  try {
    const ids = [...new Set([...agg.values()].flatMap((c) => c.estIds))];
    // Chunked at IN_BATCH — D1 caps bound variables at 100/statement.
    for (let i = 0; i < ids.length; i += IN_BATCH) {
      const chunk = ids.slice(i, i + IN_BATCH);
      if (chunk.length === 0) continue;
      const rows = await prisma.estimate.findMany({
        where: { estimateId: { in: chunk } },
        select: { estimateId: true, estimateNumber: true, total: true },
      });
      for (const r of rows as any[]) {
        valueById.set(r.estimateId, Number(r.total ?? 0) || 0);
        if (r.estimateNumber) numberById.set(r.estimateId, String(r.estimateNumber));
      }
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'daily: close-estimate lookup failed');
  }

  // NeoDove snapshots, one cached read per day.
  const neoByDay = new Map<string, Record<string, any>>();
  for (const d of dates) {
    try {
      neoByDay.set(d, await getNeodoveAgentMap(d));
    } catch {
      neoByDay.set(d, {});
    }
  }

  const out: TelecallingDailyRow[] = [];
  // Enquiry-sourced leads (replaces NeoDove get-leads): one count map for the
  // whole range, looked up per (day, agent) cell below.
  const enquiryLeadsDaily = await getEnquiryLeadCounts(from, to).catch(() => new Map<string, number>());
  for (const d of dates) {
    const neoMap = neoByDay.get(d) ?? {};
    for (const tc of telecallers as any[]) {
      const id = String(tc.id);
      const c = agg.get(`${d}|${id}`);
      const nd = (tc.neodoveUserName && neoMap[tc.neodoveUserName])
        || (tc.neodoveUserId && neoMap[tc.neodoveUserId])
        || undefined;
      const callsConnected = nd?.callsConnected ?? 0;
      // Enquiry-sourced (Sales Enquiries dashboard) — not NeoDove get-leads.
      const leadsGenerated = enquiryLeadsDaily.get(`${d}|${id}`) ?? 0;
      const won = c?.won ?? 0;
      const closePoints = c?.closePoints ?? 0;
      const closedValue = Math.round((c?.estIds ?? []).reduce((s, eid) => s + (valueById.get(eid) ?? 0), 0));
      out.push({
        date: d,
        weekday: weekdayOf(d),
        telecallerId: id,
        telecallerName: nameById.get(tc.id) ?? tc.name,
        region: String((tc as any).region ?? ''),
        won,
        closedValue,
        closedEstimates: (c?.estIds ?? []).map((eid) => numberById.get(eid) ?? eid).join(' | '),
        callsAttempted: nd?.callsAttempted ?? 0,
        callsConnected,
        callsNotConnected: nd?.callsNotConnected ?? 0,
        talkTimeMin: Math.round((nd?.talkTimeSec ?? 0) / 60),
        leadsGenerated,
        leadsConverted: nd?.leadsConverted ?? 0,
        score: closePoints + leadsGenerated * 15 + Math.round(callsConnected * 0.5),
      });
    }
  }
  return { rows: out };
}

export async function getTelecallingDashboardData(ctx?: AutomationContext): Promise<any> {
  const q = (ctx?.subject ?? {}) as Record<string, unknown>;
  // 5-min TTL (not 30s): every write path invalidates these keys explicitly
  // (invalidateRiskCache / estimates-cache / neodove report), and live events
  // refetch — so the TTL only governs idle re-reads. A short TTL meant every
  // filter click + every 30s of idle viewing re-ran the full aggregation, and
  // a page load's ~10 concurrent cold computes contended into 30s+ timeouts
  // (2026-09-08 filter incident).
  const DASH_TTL_MS = 5 * 60 * 1000;
  // Converters-only shortcut for the per-estimate export
  // (GET /api/automations/telecalling/data?converters=1&since=YYYY-MM-DD):
  // returns just { converters } from the close ledger and skips the full
  // dashboard aggregation entirely. Same endpoint on both runtimes, no new
  // route needed.
  const wantConverters = String(q.converters ?? '') === '1' || String(q.converters ?? '').toLowerCase() === 'true';
  if (wantConverters) {
    const since = typeof q.since === 'string' && DATE_RE.test(q.since) ? q.since : '';
    return cached<any>(`telecalling:converters:${since || 'all'}`, DASH_TTL_MS, () => getConvertersMap(since));
  }
  const requestedDay = typeof q.date === 'string' && DATE_RE.test(q.date) ? q.date : istDate();
  const period = typeof q.period === 'string' && q.period ? q.period : 'today';
  const agent = typeof q.agent === 'string' && q.agent ? q.agent : '';
  const selfAgentId = typeof q.selfAgentId === 'string' && q.selfAgentId ? q.selfAgentId : '';
  // Include selfAgentId so a scoped staff member never receives a cached
  // team-wide (managed) payload — each user's view is isolated in the cache.
  const wantDaily = String(q.daily ?? '') === '1' || String(q.daily ?? '').toLowerCase() === 'true';
  // Region drills carry their own followUps, so they MUST NOT share a cache
  // entry with the unfiltered dashboard: whichever request populated the key
  // used to win, and a dashboard-first load cached a payload with no
  // followUps → every region tab rendered an empty Lead Conversion list.
  const regionKey = typeof q.region === 'string' ? q.region.trim().toLowerCase() : '';
  const cacheKey = `telecalling:dashboard:${period}:${requestedDay}:${agent}:${selfAgentId}:${wantDaily ? 'daily' : ''}:${regionKey}`;
  const payload = await cached<any>(cacheKey, DASH_TTL_MS, async () => {
    return computeTelecallingDashboardData(ctx);
  });
  // Agent call tags ride OUTSIDE the 5-min cache (see overlayCallTags): a tag
  // tap is a single-row write with zero invalidation, and this merge makes it
  // visible on the very next read — millisecond-grade propagation without the
  // multi-second full-aggregation recompute a cache bust would force.
  try {
    const rows: any[] = Array.isArray((payload as any)?.followUps) ? (payload as any).followUps : [];
    if (rows.length > 0) {
      await overlayCallTags(rows);
      await overlayNextSteps(rows);
    }
  } catch { /* overlay best-effort; cached rows render as-is */ }
  return payload;
}

/**
 * The actual (expensive) aggregation. Exposed for reuse and clarity; the public
 * `getTelecallingDashboardData` wraps this in the KV cache.
 */
export async function computeTelecallingDashboardData(ctx?: AutomationContext): Promise<any> {
  const q = (ctx?.subject ?? {}) as Record<string, unknown>;
  const requestedDay = (typeof q.date === 'string' && DATE_RE.test(q.date) ? q.date : istDate());
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
  const regionByTc = new Map<string, string>();
  const tlLevelByTc = new Map<string, TlLevel>();
  for (const t of telecallers as any[]) {
    regionByTc.set(String(t.id), String((t as any).region ?? ''));
    tlLevelByTc.set(String(t.id), ((t as any).tlLevel ?? '') as TlLevel);
  }

  // History epoch — every close-ledger read starts at max(periodFrom, epoch).
  const epoch = await getEpochDate();

  // Lead Generation: drilled call KPis per staff member from the NeoDove map.
  const ndByTc = new Map<string, Record<string, number>>();
  for (const t of telecallers as any[]) {
    const nd = (t.neodoveUserName && neodoveMap[t.neodoveUserName])
      || (t.neodoveUserId && neodoveMap[t.neodoveUserId])
      || null;
    ndByTc.set(String(t.id), nd ?? {});
  }

  // Enquiry-sourced leads (Sales Enquiries dashboard — replaces NeoDove
  // get-leads): per-agent enquiry-creation totals over the leaderboard window.
  // The UNATTRIBUTED_LEADS_KEY sentinel is peeled off into unattributedLeads
  // (meta) — never attributed to an agent id of ''.
  const leadFrom = periodMode && periodRangeInfo ? periodRangeInfo.from : day;
  const leadTo = periodMode && periodRangeInfo ? periodRangeInfo.to : day;
  const leadsByAgent = new Map<string, number>();
  let unattributedLeads = 0;
  try {
    const enquiryLeads = await getEnquiryLeadCounts(leadFrom, leadTo);
    for (const [k, n] of enquiryLeads) {
      if (k === UNATTRIBUTED_LEADS_KEY) { unattributedLeads += n; continue; }
      const agent = k.slice(k.indexOf('|') + 1);
      leadsByAgent.set(agent, (leadsByAgent.get(agent) ?? 0) + n);
    }
  } catch { /* getEnquiryLeadCounts already warns — leads default 0 */ }

  // ── Score ledger (generator/closer share rows + legacy rows) ───────────────
  // Points and wins over the leaderboard window, gated by the epoch. Wins are
  // per (staff, estimate): a generator row and a closer row for the same
  // estimate credit two different people; re-picked rows were rewritten.
  const pointsFrom = epoch && epoch > leadFrom ? epoch : leadFrom;
  const wonGenIdsByTc = new Map<string, string[]>();
  const wonCloserIdsByTc = new Map<string, string[]>();
  const ptsByTc = new Map<string, { generatorPoints: number; closerPoints: number; total: number }>();
  const pushId = (map: Map<string, string[]>, id: string, estId: string) => {
    const arr = map.get(id) ?? [];
    if (!arr.includes(estId)) { arr.push(estId); map.set(id, arr); }
  };
  const bumpPt = (id: string, key: 'generatorPoints' | 'closerPoints' | 'total', n: number) => {
    const cur = ptsByTc.get(id) ?? { generatorPoints: 0, closerPoints: 0, total: 0 };
    cur[key] += n;
    ptsByTc.set(id, cur);
  };
  try {
    const events = await prisma.telecallerScoreEvent.findMany({
      where: { day: { gte: pointsFrom, ...(periodMode && periodRangeInfo ? { lte: periodRangeInfo.to } : { lte: leadTo }) } },
      select: { telecallerId: true, kind: true, delta: true, estimateId: true },
    });
    for (const ev of events as any[]) {
      const id = String(ev.telecallerId);
      const kind = String(ev.kind ?? '');
      const delta = Number(ev.delta) || 0;
      if (kind === 'generator' || kind === 'closer') {
        if (ev.estimateId && delta > 0) {
          pushId(kind === 'generator' ? wonGenIdsByTc : wonCloserIdsByTc, id, String(ev.estimateId));
          bumpPt(id, kind === 'generator' ? 'generatorPoints' : 'closerPoints', delta);
          bumpPt(id, 'total', delta);
        }
      } else if (kind === '' && isCloseDelta(delta) && delta > 0 && ev.estimateId) {
        // Legacy full-slab close row.
        pushId(wonGenIdsByTc, id, String(ev.estimateId));
        bumpPt(id, 'generatorPoints', delta);
        bumpPt(id, 'total', delta);
      } else if (delta < 0) {
        // Historic penalties (snatch/remark) still count once the epoch rule
        // passes them through — they pre-date the purge, never new-written.
        bumpPt(id, 'total', delta);
      }
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'score events read failed — leaderboard points unavailable');
  }

  // Value every credited close estimate by its total (chunked for D1's limit).
  // Missing rows (deleted estimates) count the win but value ₹0.
  const allWonIds = [...new Set([...wonGenIdsByTc.values(), ...wonCloserIdsByTc.values()].flat())];
  const valueByEstimate = new Map<string, number>();
  const regionByEstimate = new Map<string, string>();
  try {
    // Chunked at IN_BATCH — D1 caps bound variables at 100/statement.
    for (let i = 0; i < allWonIds.length; i += IN_BATCH) {
      const chunk = allWonIds.slice(i, i + IN_BATCH);
      if (chunk.length === 0) continue;
      const rows = await prisma.estimate.findMany({
        where: { estimateId: { in: chunk } },
        select: { estimateId: true, total: true, region: true },
      });
      for (const r of rows as any[]) {
        valueByEstimate.set(r.estimateId, Number((r as any).total ?? 0) || 0);
        regionByEstimate.set(r.estimateId, String((r as any).region ?? ''));
      }
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'close-estimate totals read failed — won ₹ falls back to 0');
  }

  // Region accepted points: full slab once per credited accepted estimate,
  // attributed to the estimate's LEAD region (Estimate.region), not to the
  // roster region of whoever happened to hold the 80% closer share. This is
  // why a region's points can differ from the sum of its members' ledger
  // points (pending closers, moved legacy halve, deleted actors).
  const regionPointsById = new Map<string, number>();
  for (const eid of allWonIds) {
    const total = valueByEstimate.get(eid);
    if (total === undefined) continue;
    const region = regionByEstimate.get(eid) ?? '';
    regionPointsById.set(region, (regionPointsById.get(region) ?? 0) + closePointsFor(total));
  }

  // Live pipeline risk over the open `sent` estimates — served from the 15-min
  // cache (D1 row-read budget protection). Informational only.
  const nowMs = Date.now();
  const riskItems = await getRiskItems();

  // ── Open `sent` pipeline per REGION (the ownership model) ──────────────────
  const sentOpen = await prisma.estimate.findMany({
    where: { status: 'sent' },
    select: { estimateId: true, estimateNumber: true, customerName: true, total: true, region: true, organizationId: true, createdBy: true, lastSyncTime: true },
  });
  const openByRegion = new Map<string, { count: number; value: number }>();
  const unmappedSent: Array<Record<string, unknown>> = [];
  for (const e of sentOpen as any[]) {
    const region = String(e.region ?? '');
    const cur = openByRegion.get(region) ?? { count: 0, value: 0 };
    cur.count += 1;
    cur.value += Number(e.total ?? 0) || 0;
    openByRegion.set(region, cur);
    if (!region && unmappedSent.length < 25) {
      unmappedSent.push({
        estimateId: e.estimateId,
        estimateNumber: e.estimateNumber,
        customerName: e.customerName,
        total: Number(e.total ?? 0) || 0,
        generatedBy: e.createdBy ? nameById.get(String(e.createdBy)) ?? null : null,
        organizationId: String(e.organizationId ?? ''),
        lastSync: e.lastSyncTime ?? null,
      });
    }
  }
  const unmappedCount = (sentOpen as any[]).filter((e) => !String(e.region ?? '')).length;
  const unmappedValue = unmappedCount > 0
    ? (sentOpen as any[]).filter((e) => !String(e.region ?? '')).reduce((s: number, e: any) => s + (Number(e.total ?? 0) || 0), 0)
    : 0;

  // Accepted but not yet linked to a lead region — data-quality bucket for
  // managers. These deals cannot land on a region card until linked; the 20%
  // creator share may also be missing (no enquiry mapping).
  const acceptedFrom = periodMode && periodRangeInfo ? periodRangeInfo.from : day;
  const acceptedTo = periodMode && periodRangeInfo ? periodRangeInfo.to : day;
  let unmappedAccepted: {
    count: number;
    value: number;
    points: number;
    items: Array<Record<string, unknown>>;
  } = { count: 0, value: 0, points: 0, items: [] };
  try {
    const rows = await prisma.estimate.findMany({
      where: {
        status: { in: ['accepted', 'confirmed'] },
        region: '',
        date: { gte: acceptedFrom, lte: acceptedTo },
      },
      select: { estimateId: true, estimateNumber: true, customerName: true, total: true, createdBy: true, status: true, date: true },
      orderBy: { date: 'desc' },
    });
    const items = (rows as any[]) ?? [];
    unmappedAccepted = {
      count: items.length,
      value: Math.round(items.reduce((sum, e) => sum + (Number(e.total ?? 0) || 0), 0)),
      points: items.reduce((sum, e) => sum + closePointsFor(e.total), 0),
      items: items.slice(0, 25).map((e) => ({
        estimateId: e.estimateId,
        estimateNumber: e.estimateNumber,
        customerName: e.customerName,
        total: Number(e.total ?? 0) || 0,
        status: e.status,
        date: e.date,
        generatedBy: e.createdBy ? nameById.get(String(e.createdBy)) ?? null : null,
        hasCreator: !!String(e.createdBy ?? ''),
      })),
    };
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'unmapped accepted lookup failed');
  }

  // ── Pending closer picks (sales-head pick-up queue) ────────────────────────
  let pendingPicks: Array<Record<string, unknown>> = [];
  try { pendingPicks = await pendingCloserPicks(50); } catch { /* non-fatal */ }

  // Lead Generation targets scale with the period's working days (6-day work
  // week, Mon–Sat) — a week target is one day × working days, never 1×.
  const workingDays = periodMode && periodRangeInfo ? workingDaysBetween(periodRangeInfo.from, periodRangeInfo.to) : 1;

  // ── Region + staff aggregation ──────────────────────────────────────────────
  interface StaffRow {
    id: string;
    name: string;
    type: string;
    region: string;
    tlLevel: TlLevel;
    closerEligible: boolean;
    wonGenerator: number;
    wonCloser: number;
    won: number;
    closedValue: number;
    generatorPoints: number;
    closerPoints: number;
    points: number;
    callsAttempted: number;
    callsConnected: number;
    callsNotConnected: number;
    talkTimeSec: number;
    leadsGenerated: number;
    leadsConverted: number;
    leadsInProgress: number;
    leadsLost: number;
    score: number;
  }
  interface RegionRow {
    id: RegionId | '';
    name: string;
    tl: TlLevel;
    states: string[];
    leadsGenerated: number;
    won: { count: number; value: number };
    open: { count: number; value: number };
    callsAttempted: number;
    callsConnected: number;
    callsNotConnected: number;
    talkTimeSec: number;
    points: number;
    kra: {
      connectedTarget: number;
      connectedPct: number;
      connectedStatus: 'green' | 'amber' | 'red';
      leadsTarget: number;
      leadsPct: number;
      leadsStatus: 'green' | 'amber' | 'red';
    };
    staff: Array<Record<string, unknown>>;
  }
  const staffRows = new Map<string, StaffRow>();
  for (const t of telecallers as any[]) {
    const id = String(t.id);
    const nd = ndByTc.get(id) ?? {};
    const callsAttempted = Number(nd?.callsAttempted ?? 0) || 0;
    const callsConnected = Number(nd?.callsConnected ?? 0) || 0;
    const callsNotConnected = Number(nd?.callsNotConnected ?? 0) || 0;
    const talkTimeSec = Number(nd?.talkTimeSec ?? 0) || 0;
    const leadsConverted = Number(nd?.leadsConverted ?? 0) || 0;
    const leadsInProgress = Number(nd?.leadsInProgress ?? 0) || 0;
    const leadsLost = Number(nd?.leadsLost ?? 0) || 0;
    const leadsGenerated = leadsByAgent.get(id) ?? 0;
    const genIds = wonGenIdsByTc.get(id) ?? [];
    const cloIds = wonCloserIdsByTc.get(id) ?? [];
    const closedValue = Math.round([...genIds, ...cloIds].reduce((s, eid) => s + (valueByEstimate.get(eid) ?? 0), 0));
    const pts = ptsByTc.get(id) ?? { generatorPoints: 0, closerPoints: 0, total: 0 };
    staffRows.set(id, {
      id,
      name: String(t.name ?? ''),
      type: String((t as any).type ?? 'telecaller'),
      region: String((t as any).region ?? ''),
      tlLevel: ((t as any).tlLevel ?? '') as TlLevel,
      // Field staff generate leads only — never eligible as the 80% closer.
      closerEligible: !!(t as any).assignEstimateFollowUps && String((t as any).type ?? 'telecaller') !== 'field_staff',
      wonGenerator: genIds.length,
      wonCloser: cloIds.length,
      won: new Set([...genIds, ...cloIds]).size,
      closedValue,
      generatorPoints: pts.generatorPoints,
      closerPoints: pts.closerPoints,
      points: Math.round(pts.total),
      callsAttempted,
      callsConnected,
      callsNotConnected,
      talkTimeSec,
      leadsGenerated,
      leadsConverted,
      leadsInProgress,
      leadsLost,
      // Composite score (tunable, the leaderboard norm): ledger points, a
      // generated lead +15, a connected call +0.5.
      score: Math.round(pts.total) + leadsGenerated * 15 + Math.round(callsConnected * 0.5),
    });
  }

  const regions: RegionRow[] = [];
  for (const def of REGIONS) {
    const members = (telecallers as any[]).filter((t) => String((t as any).region ?? '') === def.id)
      .map((t) => staffRows.get(String(t.id))).filter(Boolean) as StaffRow[];
    // Region wins/points are attributed by the ESTIMATE's lead region, not
    // by which staff member's ledger row carried the credit. Deduped by
    // estimate id via allWonIds, so a 20/80 pair still counts one deal.
    const regionWonIds = allWonIds.filter((eid) => regionByEstimate.get(eid) === def.id);
    const regionWonValue = regionWonIds.reduce((s, eid) => s + (valueByEstimate.get(eid) ?? 0), 0);
    const open = openByRegion.get(def.id) ?? { count: 0, value: 0 };
    const callsAttempted = members.reduce((s, m) => s + m.callsAttempted, 0);
    const callsConnected = members.reduce((s, m) => s + m.callsConnected, 0);
    const callsNotConnected = members.reduce((s, m) => s + m.callsNotConnected, 0);
    const talkTimeSec = members.reduce((s, m) => s + m.talkTimeSec, 0);
    const leadsGenerated = members.reduce((s, m) => s + m.leadsGenerated, 0);
    const connectedTarget = CONNECTED_CALLS_PER_DAY * workingDays;
    const connectedPct = connectedTarget > 0 ? Math.round((callsConnected / connectedTarget) * 100) : 0;
    const connectedStatus: 'green' | 'amber' | 'red' =
      connectedPct >= 100 ? 'green' : connectedPct >= 60 ? 'amber' : 'red';
    const leadsTarget = LEADS_PER_AGENT_PER_DAY * workingDays;
    const leadsPct = leadsTarget > 0 ? Math.round((leadsGenerated / leadsTarget) * 100) : 0;
    const leadsStatus: 'green' | 'amber' | 'red' =
      leadsPct >= 100 ? 'green' : leadsPct >= 60 ? 'amber' : 'red';
    members.sort((a, b) => b.points - a.points || b.closedValue - a.closedValue || b.score - a.score);
    regions.push({
      id: def.id,
      name: def.name,
      tl: def.tl,
      states: def.states,
      leadsGenerated,
      won: { count: regionWonIds.length, value: Math.round(regionWonValue) },
      open,
      callsAttempted,
      callsConnected,
      callsNotConnected,
      talkTimeSec,
      points: regionPointsById.get(def.id) ?? 0,
      kra: { connectedTarget, connectedPct, connectedStatus, leadsTarget, leadsPct, leadsStatus },
      staff: members as unknown as Array<Record<string, unknown>>,
    });
  }
  const unmappedStaff = (telecallers as any[]).filter((t) => !String((t as any).region ?? ''))
    .map((t) => staffRows.get(String(t.id))).filter(Boolean) as StaffRow[];
  for (const t of unmappedStaff) {
    // Highlighted on the board so MIS notices and maps them.
    (t as any).unmapped = true;
  }

  const openTotal = (sentOpen as any[]).reduce((s: number, e: any) => s + (Number(e.total ?? 0) || 0), 0);
  const kpiWonIds = new Set<string>(allWonIds);
  const kpi = {
    won: kpiWonIds.size,
    closedValue: Math.round([...kpiWonIds].reduce((s, eid) => s + (valueByEstimate.get(eid) ?? 0), 0)),
    pipelineValue: Math.round(openTotal),
    leadsGenerated: [...leadsByAgent.values()].reduce((s, n) => s + n, 0),
    callsAttempted: [...ndByTc.values()].reduce((s, nd) => s + (Number(nd?.callsAttempted ?? 0) || 0), 0),
    callsConnected: [...ndByTc.values()].reduce((s, nd) => s + (Number(nd?.callsConnected ?? 0) || 0), 0),
    talkTimeSec: [...ndByTc.values()].reduce((s, nd) => s + (Number(nd?.talkTimeSec ?? 0) || 0), 0),
  };

  // Self-contained staff list so the dashboard can build dropdowns without a
  // second round-trip.
  const agentList = telecallers.map((t: any) => ({
    id: String(t.id), name: String(t.name ?? ''),
    region: String(t.region ?? ''), tlLevel: String(t.tlLevel ?? ''),
    active: !!t.assignEstimateFollowUps,
  }));

  // ── Region drill-down: ?region=R1..R4|unmapped (or ?agent= → that staff's region)
  // Staff work every open estimate in their own region, so the drill shows the
  // whole region's pipeline (not a personal hold). A scoped staff member may
  // only ever drill into THEIR OWN region: any explicit ?agent=/?region= is
  // coerced to self (blocks reading other regions).
  const selfAgentId = typeof q.selfAgentId === 'string' && q.selfAgentId ? q.selfAgentId : null;
  const requestedAgent = typeof q.agent === 'string' && q.agent ? q.agent : undefined;
  const requestedRegionRaw = typeof q.region === 'string' ? String(q.region).trim() : '';
  const requestedRegion: string | undefined = requestedRegionRaw
    ? (requestedRegionRaw.toLowerCase() === 'unmapped' ? '' : requestedRegionRaw.toUpperCase())
    : undefined;
  const agentFilter = requestedAgent ? (selfAgentId ?? requestedAgent) : undefined;
  const drillSelfStaff = selfAgentId
    ? (telecallers as any[]).find((t) => String(t.id) === selfAgentId) ?? null
    : null;

  let drillStaff: any = null;
  let regionScope: string | undefined;
  if (selfAgentId) {
    drillStaff = drillSelfStaff;
    regionScope = String(drillSelfStaff?.region ?? '');
  } else if (agentFilter) {
    const tc = telecallers.find(
      (t: any) => String(t.id) === agentFilter || String(t.name ?? '') === agentFilter || (t.neodoveUserName ?? '') === agentFilter,
    ) as any;
    if (!tc) {
      return {
        meta: {
          analysis: 'sales-leaderboard',
          title: 'Sales Leaderboard',
          day,
          agents: agentList,
          generatedAt: new Date().toISOString(),
          error: 'agent not found',
        },
      };
    }
    drillStaff = tc;
    regionScope = String(tc.region ?? '');
  } else if (requestedRegion !== undefined) {
    regionScope = requestedRegion;
  }

  if (regionScope !== undefined) {
    const regionId = regionScope;
    const followUpEsts = await prisma.estimate.findMany({
      where: { region: regionId, status: 'sent' },
      // Highest-value estimates first — staff see the biggest deals at the
      // top of their region list.
      orderBy: [{ total: 'desc' }, { date: 'asc' }],
      // 15-min Zoho analyzer verdict — drives the Satisfactory/Unsatisfactory
      // chip. Note: D1PrismaClient resolves relations via `include`, not a
      // nested relation under `select`.
      include: { classification: true },
    });
    const followLastComments = new Map<string, string>();
    for (const r of riskItems) {
      if (r.lastCommentDate) followLastComments.set(r.estimateId, r.lastCommentDate);
    }
    // Most recent real sales note per follow-up estimate (text shown inline on
    // each row). Timestamp-ordered (Zoho ids aren't chronological); system
    // auto-logs excluded. Fail-open: rows render without the note.
    const latestCommentByEst = new Map<string, { text: string; commentedBy: string; dateFormatted: string | null }>();
    try {
      const ids = followUpEsts.map((e) => e.estimateId);
      if (ids.length > 0) {
        // Chunked at IN_BATCH — D1 caps bound variables at 100/statement.
        const rows: any[] = [];
        for (let i = 0; i < ids.length; i += IN_BATCH) {
          rows.push(...await prisma.comment.findMany({
            where: { estimateId: { in: ids.slice(i, i + IN_BATCH) } },
            select: { estimateId: true, description: true, commentedBy: true, date: true, dateFormatted: true },
          }));
        }
        const best = new Map<string, { ts: number; v: { text: string; commentedBy: string; dateFormatted: string | null } }>();
        for (const c of rows as any[]) {
          const text = String(c.description || '').trim();
          if (!text) continue;
          if (isSystemGeneratedComment(text, String(c.commentedBy || ''))) continue;
          const ts = parseCommentDateMs(String(c.dateFormatted ?? c.date ?? ''));
          if (ts === null) continue;
          const cur = best.get(String(c.estimateId));
          if (cur && cur.ts >= ts) continue;
          best.set(String(c.estimateId), {
            ts,
            v: {
              text,
              commentedBy: String(c.commentedBy || ''),
              dateFormatted: (c.dateFormatted ?? c.date ?? null) as string | null,
            },
          });
        }
        for (const [eid, v] of best) latestCommentByEst.set(eid, v.v);
      }
    } catch (e: any) {
      logger.warn({ err: e?.message }, 'follow-up latest-comment lookup failed — rows render without notes');
    }
    // Telecaller names for the call-tag "set by" attribution below.
    const nameByTelecallerId = new Map<string, string>(
      (telecallers as any[]).map((t) => [String(t.id), String(t.name ?? '')]),
    );
    const def = REGIONS.find((r) => r.id === regionId) ?? null;
    const followUps = followUpEsts.map((e) => {
      const lastCommentDate = followLastComments.get(e.estimateId) ?? null;
      const ts = parseCommentDateMs(lastCommentDate);
      const staleHours = ts !== null ? (nowMs - ts) / 3600000 : null;
      const riskItem = riskItems.find((r) => r.estimateId === e.estimateId);
      const risk = riskItem?.risk ?? 'pending';
      const callTagBy = (e as any).callTagBy ?? null;
      return {
        estimateId: e.estimateId,
        estimateNumber: e.estimateNumber,
        customerName: e.customerName,
        status: e.status,
        total: e.total,
        // Zoho org (multi-org sync) — drives the dashboard org badge/filter.
        organizationId: (e as any).organizationId ?? null,
        region: String((e as any).region ?? ''),
        day,
        satisfactory: (e as any).classification ? !!(e as any).classification.meaningfulUpdate : null,
        intentScore: (e as any).classification?.intentScore ?? null,
        analysisSummary: (e as any).classification?.summary ?? null,
        lastCommentDate,
        staleHours,
        // Most recent real sales note on THIS estimate (see lookup above).
        latestComment: latestCommentByEst.get(e.estimateId) ?? null,
        // Lead details: per-estimate capture ONLY (stored by the GH runner from this
        // estimate's own Zoho comments). NO company-name enquiry fallback — a
        // fuzzy company match can surface a DIFFERENT customer's POC/mobile/
        // enquiry number as wrong chips. Chips stay blank (UI shows the
        // "AI capturing" state) until the runner stores real per-estimate data.
        enquiryNumber: (e as any).enquiryNumber ?? null,
        sourceLead: (e as any).sourceLead ?? null,
        location: (e as any).location ?? null,
        contactName: (e as any).contactName ?? null,
        contactPhone: (e as any).contactPhone ?? null,
        contactEmail: (e as any).contactEmail ?? null,
        detailsCaptured: !!(e as any).detailsCaptured,
        // Terminal AI give-up: 10 capture turns with <3 fields (see the
        // lead-details route). UI shows "Details unavailable" instead of the
        // perpetual "AI capturing…" state.
        detailsFailed: !!(e as any).detailsFailed,
        // "Lead generated by" = the originating staff (creator) — the enquiry
        // author whose enquiry stamped the region. Hidden (null) until recorded.
        leadOf: (e as any).createdBy ? nameByTelecallerId.get(String((e as any).createdBy)) ?? null : null,
        risk,
        staleReason: riskItem?.staleReason ?? (risk === 'red' || risk === 'zombie' ? buildSnatchReason(e, risk) : null),
        // Agent call-disposition tag (Lead Conversion view): NO_ANSWER /
        // BUSY / CALLBACK (+callbackDate, max +10d). Sticky, engine-untouched.
        callTag: (e as any).callTag ?? null,
        callbackDate: (e as any).callbackDate ?? null,
        callTagBy,
        callTagByName: callTagBy ? (nameByTelecallerId.get(String(callTagBy)) ?? null) : null,
        callTagAt: (e as any).callTagAt ?? null,
        // Dated next step (migration 0028) — the restored NextStepControl
        // editor writes these via PUT /api/estimates/:id/next-step.
        nextStep: (e as any).nextStep ?? null,
        nextStepDate: (e as any).nextStepDate ?? null,
      };
    });
    const me = drillStaff ? staffRows.get(String(drillStaff.id)) ?? null : null;
    const regionRow = regions.find((r) => r.id === regionId) ?? null;
    // Region-level aggregate when no staff is targeted (Conversion region tabs):
    // sum the roster rows mapped to that region ('' = unmapped staff).
    const regionMembers = [...staffRows.values()].filter((s) => s.region === regionId);
    const agg = {
      won: me?.won ?? regionRow?.won.count ?? regionMembers.reduce((s, m) => s + m.won, 0),
      points: me?.points ?? regionRow?.points ?? Math.round(regionMembers.reduce((s, m) => s + m.points, 0)),
      callsConnected: me?.callsConnected ?? regionRow?.callsConnected ?? regionMembers.reduce((s, m) => s + m.callsConnected, 0),
      leadsGenerated: me?.leadsGenerated ?? regionRow?.leadsGenerated ?? regionMembers.reduce((s, m) => s + m.leadsGenerated, 0),
    };
    const regionOpen = openByRegion.get(regionId) ?? { count: 0, value: 0 };
    const staffName = drillStaff ? String(drillStaff.name ?? '') : null;
    return {
      meta: {
        analysis: 'sales-leaderboard-region',
        title: staffName ? `Sales Leaderboard — ${staffName}` : `Sales Leaderboard — ${def?.name ?? 'Unmapped'}`,
        day,
        requestedDay,
        usingLatestAvailable,
        region: regionId,
        regionName: def?.name ?? 'Unmapped',
        agents: agentList,
        generatedAt: new Date().toISOString(),
      },
      agent: {
        id: drillStaff ? String(drillStaff.id) : regionId,
        name: staffName ?? (def?.name ?? 'Unmapped'),
        region: regionId,
        tlLevel: drillStaff ? String(drillStaff.tlLevel ?? '') : (def?.tl ?? ''),
        won: agg.won,
        points: agg.points,
        callsConnected: agg.callsConnected,
        leadsGenerated: agg.leadsGenerated,
        regionOpen,
        followUpCount: followUps.length,
      },
      followUps,
    };
  }

  // ── Recent activity ──────────────────────────────────────────────────────────
  const recentRows = await prisma.estimate.findMany({
    where: { status: { in: ['sent', 'accepted', 'confirmed', 'declined'] } },
    orderBy: { lastSyncTime: 'desc' },
    take: 25,
    select: {
      estimateNumber: true,
      customerName: true,
      status: true,
      region: true,
    },
  });
  const recent = recentRows.map((e: any) => ({
    estimateNumber: e.estimateNumber,
    customerName: e.customerName,
    status: e.status,
    region: String(e.region ?? ''),
  }));

  // Can-manage: the route only injects selfAgentId for NON-admin users, so
  // its absence means the viewer is root/MIS/sales-head.
  const canManage = !selfAgentId;
  const selfStaff = selfAgentId ? staffRows.get(selfAgentId) ?? null : null;
  const selfRegion = selfStaff?.region ?? '';

  // Non-managing staff are scoped to their OWN region: the team leaderboard
  // (region cards) stays visible, but at-risk/recent lists carry only their
  // region's rows.
  const scopedRiskItems = canManage
    ? riskItems
    : riskItems.filter((r) => r.region === selfRegion);
  const scopedRecent = canManage
    ? recent
    : recent.filter((r) => String(r.region ?? '') === selfRegion);

  return {
    meta: {
      analysis: 'sales-leaderboard',
      title: 'Sales Leaderboard',
      day,
      requestedDay,
      usingLatestAvailable,
      period: periodMode && periodRangeInfo ? q.period : 'today',
      periodLabel: periodRangeInfo?.label ?? 'Today',
      periodFrom: periodRangeInfo?.from ?? null,
      periodTo: periodRangeInfo?.to ?? null,
      generatedAt: new Date().toISOString(),
      // Sales taxonomy: the region table first-class in the payload.
      taxonomy: REGIONS.map((r) => ({ id: r.id, name: r.name, tl: r.tl, states: r.states })),
      tlLevels: TL_LEVELS,
      canManage,
      unmatchedSentCount: unmappedCount,
      unmappedSentCount: unmappedCount,
      telecallerCount: telecallers.length,
      fieldStaffCount: (telecallers as any[]).filter((t) => String((t as any).type ?? 'telecaller') === 'field_staff').length,
      unmappedStaffCount: unmappedStaff.length,
      staff: agentList,
      agents: agentList,
      // Enquiries in the window with no roster match (assignedAgentId empty).
      // Surfaced so MIS can fix attribution instead of silently undercounting.
      unattributedLeads,
      targets: {
        connectedCallsPerDay: CONNECTED_CALLS_PER_DAY * workingDays,
        leadsPerAgentPerDay: LEADS_PER_AGENT_PER_DAY * workingDays,
      },
      // Won-₹ goal for the "Won ₹" KPI, scaled by working days so every
      // period filter has a fair proportional target:
      // today = ₹5L / gold ₹10L; week (Mon–Sat) up to 6×; month ~26×, etc.
      conversionTarget: {
        perDay: CONVERSION_TARGET_DAILY,
        goldPerDay: CONVERSION_GOLD_DAILY,
        workingDays,
        target: CONVERSION_TARGET_DAILY * workingDays,
        gold: CONVERSION_GOLD_DAILY * workingDays,
        value: kpi.closedValue,
        pct: (() => {
          const t = CONVERSION_TARGET_DAILY * workingDays;
          return t > 0 ? Math.round((kpi.closedValue / t) * 100) : 0;
        })(),
        status: kpi.closedValue >= CONVERSION_GOLD_DAILY * workingDays
          ? 'gold'
          : kpi.closedValue >= CONVERSION_TARGET_DAILY * workingDays
            ? 'hit'
            : 'below',
      },
      workingDays,
      selfAgentId: selfAgentId ?? null,
      viewer: {
        staffId: selfAgentId ?? null,
        name: selfStaff?.name ?? null,
        region: selfRegion || null,
        tlLevel: selfStaff?.tlLevel ?? null,
      },
      // History epoch (founder-approved live reset): points read start here.
      epoch,
      epochKey: EPOCH_SETTING_KEY,
    },
    kpi,
    // Founder pre-warning over the open pipeline (informational): no-activity
    // or stale next-step estimates, sorted by value.
    risk: {
      counts: {
        open: scopedRiskItems.length,
        ok: scopedRiskItems.filter((r) => r.risk === 'ok').length,
        pending: scopedRiskItems.filter((r) => r.risk === 'pending').length,
        red: scopedRiskItems.filter((r) => r.risk === 'red').length,
        zombie: scopedRiskItems.filter((r) => r.risk === 'zombie').length,
      },
      valueAtRisk: scopedRiskItems
        .filter((r) => r.risk === 'red' || r.risk === 'zombie')
        .reduce((s, r) => s + r.total, 0),
      atRisk: scopedRiskItems
        .filter((r) => r.risk === 'red' || r.risk === 'zombie')
        .sort((a, b) => b.total - a.total)
        .slice(0, RISK_LIST_CAP),
    },
    // Region cards — the heart of the sales leaderboard.
    regions,
    // Staff working NO region (roster_tl/region unset) — actionable: map them.
    unmappedStaff,
    // Unmapped open estimates (region '') — privileged only.
    ...(canManage ? {
      unmapped: {
        count: unmappedCount,
        value: Math.round(unmappedValue),
        items: unmappedSent,
      },
      // Accepted deals still outside any region (lead-source region unknown).
      unmappedAccepted,
      // Awaiting a closer pick (80% share pending sales-head decision).
      pendingPicks,
    } : {}),
    recent: scopedRecent,
    // MIS daily breakdown (only when ?daily=1 in period mode): per-day ×
    // per-staff closes w/ estimate tags, calls, leads. Absent otherwise so
    // dashboard loads stay light.
    ...(await buildDailySection(q, periodMode, periodRangeInfo)),
  };
}

/** Daily MIS section for period payloads. Empty (no keys) unless requested. */
async function buildDailySection(
  q: Record<string, unknown>,
  periodMode: boolean,
  periodRangeInfo: { from: string; to: string; label: string } | null,
): Promise<{ daily?: TelecallingDailyRow[]; dailyError?: string | null }> {
  const wantDaily = String(q.daily ?? '') === '1' || String(q.daily ?? '').toLowerCase() === 'true';
  if (!wantDaily || !periodMode || !periodRangeInfo) return {};
  const res = await computeTelecallingDaily(periodRangeInfo.from, periodRangeInfo.to);
  if ('error' in res) return { dailyError: res.error };
  return { daily: res.rows, dailyError: null };
}

//── Facade re-exports (Phase-R split) ─────────────────────────────────────────
// service.ts keeps the region run + leaderboard; every name moved to a sibling
// module is re-exported here so existing importers (`worker/routes/*`, triggers,
// status-sync, estimate-link) keep working with zero call-site changes.
export {
  ZOMBIE_DAYS, FRESH_HOURS, parseCommentDateMs, latestCommentDates,
  classifyRisk, buildSnatchReason, RISK_CACHE_KEY, computeRiskCache, getRiskItems,
  invalidateRiskCache,
} from './risk';
export type { EstimateRisk, RiskItem, CachedRiskItem, RiskCache } from './risk';
export {
  CLOSE_SLABS, closePointsFor, isCloseDelta, splitClosePoints,
  recordConversionClose, creditCloserShare, pendingCloserPicks,
  deleteCloseHistory, getEpochDate, EPOCH_SETTING_KEY,
  getConvertersMap, SNATCH_PENALTY, REMARK_PENALTY,
} from './scoring';
export { getFollowUpSpecialists, recordAssignment } from './rotation';
export { syncTelecallersFromNeodove } from './roster';
export {
  CALL_TAGS, CALLBACK_MAX_DAYS, setEstimateCallTag,
  NEXT_STEP_MAX_DAYS, setEstimateNextStep, overlayNextSteps, overlayCallTags,
} from './call-tags';
export type { CallTag } from './call-tags';
export { linkEnquiryEstimate, sweepEnquiryEstimateLinks, type EnquiryLinkResult } from './enquiry-links';
export { REGIONS, TL_LEVELS, isValidRegion, isValidTlLevel } from './regions';
export type { RegionId, TlLevel, RegionDef } from './regions';
export { DATE_RE, IN_BATCH, istDate } from './util';
