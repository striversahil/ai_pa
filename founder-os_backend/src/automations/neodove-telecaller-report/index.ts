/**
 * NeoDove Telecaller Report (live).
 *
 * Raw per-user-day rows are pushed into D1 (Settings key
 * `neodove_user_report:<YYYY-MM-DD>`) by the GH Actions runner
 * scripts/neodove-report-runner.js — every 10 minutes for TODAY and once
 * daily for YESTERDAY's final snapshot.
 *
 * This automation is the read side only:
 *   - handler(): no-op (nothing to execute server-side)
 *   - data():    GET /api/automations/neodove-telecaller-report/data
 *                ?date=YYYY-MM-DD | ?from=YYYY-MM-DD&to=YYYY-MM-DD
 *                (default: latest stored day)
 *                → per-agent aggregates summed across every stored day in the
 *                  range + individual KRA/KPI vs per-day benchmarks.
 *
 * Individual KRA/KPI (benchmarks judged on today's live numbers):
 *   - ≥ 120 connected calls / agent / day
 *   - ≥ 5 leads generated / agent / day (true "leads generated" count from
 *     the get-leads API, see neodove-refresh / neodove-report-runner; older
 *     snapshots fall back to leadsInProgress + leadsConverted)
 *   - Zoho sent-estimates pipeline attributed per agent via an optional
 *     name mapping (Setting key `kra:zoho_name_map`, JSON:
 *     { "Zoho Commenter": "NeoDove UserName", ... }).
 */
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';
import { isSystemGeneratedComment } from '../../shared/systemComment';
import type { AutomationContext } from '../../modules/automation/types';

export const CONNECTED_CALLS_PER_DAY = 120;
export const LEADS_PER_AGENT_PER_DAY = 5;

export interface NeodoveAgentRow {
  userName: string;
  userId: string;
  managerName: string | null;
  callsAttempted: number;
  callsConnected: number;
  callsNotConnected: number;
  incomingCalls: number;
  outgoingCalls: number;
  incomingMissed: number;
  outgoingMissed: number;
  talkTimeSec: number;
  leadsConverted: number;
  leadsInProgress: number;
  leadsLost: number;
  leadsClosed: number;
  followupLeads: number;
  pendingScheduledLeads: number;
  /** True "leads generated" (created) count from the get-leads API. */
  leadsGenerated: number;
}

const NUMERIC_KEYS: (keyof NeodoveAgentRow)[] = [
  'callsAttempted', 'callsConnected', 'callsNotConnected',
  'incomingCalls', 'outgoingCalls', 'incomingMissed', 'outgoingMissed',
  'talkTimeSec', 'leadsConverted', 'leadsInProgress', 'leadsLost',
  'leadsClosed', 'followupLeads', 'pendingScheduledLeads', 'leadsGenerated',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Load every stored user-day report between `from` and `to` (inclusive,
 * YYYY-MM-DD lexicographic range over the Settings key). Days whose snapshot
 * is empty (e.g. early-morning today mode) are skipped entirely so they do
 * not dilute per-day averages.
 */
async function loadReportsInRange(from?: string, to?: string): Promise<{ dates: string[]; rows: any[] }> {
  const prefix = 'neodove_user_report:';
  const keyFilter: Record<string, unknown> = { startsWith: prefix };
  if (from && DATE_RE.test(from)) keyFilter.gte = `${prefix}${from}`;
  if (to && DATE_RE.test(to)) {
    // `~` sorts right after ':' so the upper bound includes exactly this date.
    keyFilter.lte = `${prefix}${to}~`;
  }
  const settings = await prisma.setting.findMany({
    where: { key: keyFilter },
    orderBy: { key: 'desc' },
  });
  const dates: string[] = [];
  const rows: any[] = [];
  for (const s of settings) {
    const keyDate = s.key.slice(prefix.length);
    try {
      const parsed = JSON.parse(s.value);
      if (!Array.isArray(parsed?.rows)) continue;
      // Defence-in-depth: some stored snapshots contain rows dated outside
      // their key's day (NeoDove API ignores range params). Trust the ROW's
      // own date over the key when it is present.
      const inRange = parsed.rows.filter((r: any) => {
        const d = typeof r?.date === 'string' ? r.date.slice(0, 10) : null;
        if (!d || !DATE_RE.test(d)) return true;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
      if (inRange.length > 0) {
        dates.push(keyDate);
        rows.push(...inRange);
      }
    } catch {
      // skip malformed snapshots
    }
  }
  return { dates, rows };
}

function aggregate(rows: any[]): NeodoveAgentRow[] {
  const byUser = new Map<string, NeodoveAgentRow>();
  for (const r of rows) {
    // NeoDove can return multiple user-day rows (one per lead bucket);
    // merge them so each agent appears exactly once.
    const key = r.userId || r.userName || 'unknown';
    const name = r.userName || key.slice(0, 8);
    let agg = byUser.get(key);
    if (!agg) {
      agg = {
        userName: name,
        userId: r.userId || '',
        managerName: r.managerName ?? null,
        callsAttempted: 0, callsConnected: 0, callsNotConnected: 0,
        incomingCalls: 0, outgoingCalls: 0, incomingMissed: 0, outgoingMissed: 0,
        talkTimeSec: 0, leadsConverted: 0, leadsInProgress: 0, leadsLost: 0,
        leadsClosed: 0, followupLeads: 0, pendingScheduledLeads: 0, leadsGenerated: 0,
      };
      byUser.set(key, agg);
    }
    for (const k of NUMERIC_KEYS) {
      const v = Number(r[k] ?? 0);
      if (Number.isFinite(v)) (agg as any)[k] += v;
    }
    // Always prefer a real userName over the sliced-id fallback so that any
    // day's report (even one where userName is missing) merges correctly.
    if (r.userName) agg.userName = r.userName;
    if (r.userId) agg.userId = r.userId;
    if (!agg.managerName && r.managerName) agg.managerName = r.managerName;
  }
  // Match the NeoDove portal's USER_REPORT headline, which reports COMBINED
  // outgoing + incoming activity. The API's totalCallAttempted /
  // totalCallConnected fields describe a narrower dialer-only subset and
  // understate what managers see (e.g. Rani: app 178/56 vs those fields
  // 146/37). All four component fields are already summed above, so derive:
  for (const a of byUser.values()) {
    a.callsAttempted = a.outgoingCalls + a.incomingCalls;
    a.callsConnected =
      (a.outgoingCalls - a.outgoingMissed) + (a.incomingCalls - a.incomingMissed);
    a.callsNotConnected = a.outgoingMissed + a.incomingMissed;
  }
  return [...byUser.values()].sort((a, b) => b.callsAttempted - a.callsAttempted);
}

/**
 * Load the per-agent NeoDove aggregates for a single day (default: latest stored
 * day) keyed by agent userName. Used by the unified telecalling dashboard to
 * merge Lead Generation (calls connected / leads generated) with Lead
 * Conversion (estimate assignments) per telecaller.
 */
export async function getNeodoveAgentMap(date?: string): Promise<Record<string, NeodoveAgentRow>> {
  const d = date && DATE_RE.test(date) ? date : undefined;
  const { rows } = await loadReportsInRange(d, d);
  const aggregated = aggregate(rows);
  const map: Record<string, NeodoveAgentRow> = {};
  for (const a of aggregated) {
    if (a.userName) map[a.userName] = a;
    if (a.userId) map[a.userId] = a;
  }
  return map;
}

/**
 * Unique NeoDove agents across every stored day. Used to seed the Telecaller
 * roster — a telecaller is considered active once they appear in any NeoDove
 * report (including previous days), so the roster is built from the full
 * history, not just today's (possibly empty) snapshot.
 */
export async function getAllNeodoveAgents(): Promise<NeodoveAgentRow[]> {
  const { rows } = await loadReportsInRange(undefined, undefined);
  return aggregate(rows);
}

/** Aggregated NeoDove metrics per agent over an inclusive IST date range
 * (YYYY-MM-DD strings). Used by the telecalling leaderboard for week/month/
 * year period views — sums the stored daily reports in one Setting read. */
export async function getNeodoveRangeMap(
  from: string,
  to: string,
): Promise<Record<string, NeodoveAgentRow>> {
  const { rows } = await loadReportsInRange(from, to);
  const aggregated = aggregate(rows);
  const map: Record<string, NeodoveAgentRow> = {};
  for (const a of aggregated) {
    if (a.userName) map[a.userName] = a;
    if (a.userId) map[a.userId] = a;
  }
  return map;
}

/** Latest stored NeoDove report day that actually has agent rows (YYYY-MM-DD),
 * or null if none stored. Skips empty snapshots (e.g. early-morning "today"
 * that hasn't been pushed yet) so callers fall back to real data. */
export async function getLatestNeodoveDay(): Promise<string | null> {
  const { dates } = await loadReportsInRange(undefined, undefined);
  return dates.length ? dates[0] : null;
}

type TrafficLight = 'green' | 'amber' | 'red';

function lightFor(pct: number): TrafficLight {
  if (pct >= 100) return 'green';
  if (pct >= 60) return 'amber';
  return 'red';
}

const ORDER: Record<TrafficLight, number> = { green: 0, amber: 1, red: 2 };

export interface AgentKra {
  /** Effective target for the whole range (daily × active days). */
  connectedTarget: number;
  connectedDailyTarget: number;
  connected: number;
  connectedAvgPerDay: number;
  connectedPct: number;
  connectedStatus: TrafficLight;
  /** Effective target for the whole range (daily × active days). */
  leadsTarget: number;
  leadsDailyTarget: number;
  leads: number;
  leadsAvgPerDay: number;
  leadsPct: number;
  leadsStatus: TrafficLight;
  overall: TrafficLight;
  overallLabel: string;
  zohoEstimates: number;
  zohoPipelineValue: number;
}

async function loadZohoNameMap(): Promise<Record<string, string>> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'kra:zoho_name_map' } });
    if (!row?.value) return {};
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Attribute active sent estimates to agents via comments.commentedBy.
 * Returns stats keyed by *NeoDove* user name (after mapping), plus the raw
 * per-Zoho-commenter breakdown so unmapped names stay visible.
 */
async function loadZohoByAgent(nameMap: Record<string, string>): Promise<{
  byAgent: Record<string, { estimates: number; value: number }>;
  byZohoName: Record<string, { estimates: number; value: number }>;
}> {
  // D1 row-read budget protection: the attribution scan reads every open
  // estimate + every comment row. Cache the result in a Setting key for
  // 10 min — the NeodoveTelecallerDashboard refetches on every runner
  // broadcast, and the underlying Zoho data only changes on the 15-min sync.
  const CACHE_KEY = 'neodove:kra_cache';
  const TTL_MS = 10 * 60 * 1000;
  try {
    const row = await prisma.setting.findUnique({ where: { key: CACHE_KEY } });
    if (row?.value) {
      const cached = JSON.parse(String(row.value)) as { computedAt: string } & Record<string, unknown>;
      if (Date.now() - Date.parse(cached.computedAt) < TTL_MS) {
        return { byAgent: cached.byAgent as any, byZohoName: cached.byZohoName as any };
      }
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'KRA cache read failed');
  }

  const byAgent: Record<string, { estimates: number; value: number }> = {};
  const byZohoName: Record<string, { estimates: number; value: number }> = {};

  const normalizedMap: Record<string, string> = {};
  for (const [zoho, neo] of Object.entries(nameMap)) {
    if (zoho && neo) normalizedMap[zoho.trim().toLowerCase()] = neo.trim();
  }

  try {
    const estimates = await prisma.estimate.findMany({
      where: { status: 'sent' },
      include: { comments: { orderBy: { commentId: 'desc' } } },
    });
    for (const e of estimates as any[]) {
      const commenters = new Set<string>();
      for (const c of e.comments ?? []) {
        const who = String(c.commentedBy ?? '').trim();
        if (who && !isSystemGeneratedComment(c.description, who)) commenters.add(who);
      }
      for (const who of commenters) {
        const zstats = (byZohoName[who] ??= { estimates: 0, value: 0 });
        zstats.estimates += 1;
        zstats.value += Number(e.total) || 0;
        const mapped = normalizedMap[who.toLowerCase()];
        if (mapped) {
          const astats = (byAgent[mapped] ??= { estimates: 0, value: 0 });
          astats.estimates += 1;
          astats.value += Number(e.total) || 0;
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'KRA: failed to attribute Zoho estimates');
  }
  try {
    await prisma.setting.upsert({
      where: { key: CACHE_KEY },
      update: { value: JSON.stringify({ byAgent, byZohoName, computedAt: new Date().toISOString() }), updatedAt: new Date() },
      create: { key: CACHE_KEY, value: JSON.stringify({ byAgent, byZohoName, computedAt: new Date().toISOString() }), updatedAt: new Date() },
    });
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'KRA cache write failed');
  }
  return { byAgent, byZohoName };
}

export function computeAgentKra(
  agent: NeodoveAgentRow,
  connectedTarget: number,
  leadsTarget: number,
  zoho?: { estimates: number; value: number },
  days = 1,
): AgentKra {
  const d = Math.max(1, days);
  // Prefer the true "leads generated" count from the get-leads API; fall back
  // to the legacy leadsInProgress + leadsConverted for snapshots that predate
  // it (the field is absent → undefined → old formula).
  const leads =
    typeof agent.leadsGenerated === 'number' ? agent.leadsGenerated : agent.leadsInProgress + agent.leadsConverted;
  // Benchmark scales with the range: e.g. a week of data targets 7 × daily.
  const effConnectedTarget = Math.round(connectedTarget * d);
  const effLeadsTarget = Math.round(leadsTarget * d);
  const connectedAvg = agent.callsConnected / d;
  const leadsAvg = leads / d;
  const connectedPct = Math.round((agent.callsConnected / effConnectedTarget) * 100);
  const leadsPct = Math.round((leads / effLeadsTarget) * 100);
  const connectedStatus = lightFor(connectedPct);
  const leadsStatus = lightFor(leadsPct);
  const overall = ORDER[connectedStatus] >= ORDER[leadsStatus] ? connectedStatus : leadsStatus;
  const overallLabel =
    overall === 'green' ? 'On Target 🟢' : overall === 'amber' ? 'Partially On Target 🟡' : 'Below Target 🔴';
  return {
    connectedTarget: effConnectedTarget,
    connectedDailyTarget: connectedTarget,
    connected: agent.callsConnected,
    connectedAvgPerDay: Number(connectedAvg.toFixed(1)),
    connectedPct,
    connectedStatus,
    leadsTarget: effLeadsTarget,
    leadsDailyTarget: leadsTarget,
    leads,
    leadsAvgPerDay: Number(leadsAvg.toFixed(1)),
    leadsPct,
    leadsStatus,
    overall,
    overallLabel,
    zohoEstimates: zoho?.estimates ?? 0,
    zohoPipelineValue: zoho?.value ?? 0,
  };
}

export async function handler(ctx: AutomationContext): Promise<void> {
  ctx.log('info', 'neodove-telecaller-report: data is pushed by GH Actions runner; nothing to execute here');
}

export async function data(ctx: AutomationContext): Promise<any> {
  const q = ctx.subject ?? {};
  let from = typeof q.from === 'string' && DATE_RE.test(q.from) ? q.from : undefined;
  let to = typeof q.to === 'string' && DATE_RE.test(q.to) ? q.to : undefined;
  if (from && !to) to = from;
  if (to && !from) from = to;
  const legacyDate = typeof q.date === 'string' && DATE_RE.test(q.date) ? q.date : undefined;
  if (!from && legacyDate) from = legacyDate;
  // No params at all → latest stored day only.
  if (!from && !to && !legacyDate) {
    const latest = await prisma.setting.findFirst({
      where: { key: { startsWith: 'neodove_user_report:' } },
      orderBy: { key: 'desc' },
    });
    from = latest?.key.slice('neodove_user_report:'.length);
    to = from;
  }
  const connectedTarget = Number(ctx.config?.connectedCallsPerDay ?? CONNECTED_CALLS_PER_DAY) || CONNECTED_CALLS_PER_DAY;
  const leadsTarget = Number(ctx.config?.leadsPerAgentPerDay ?? LEADS_PER_AGENT_PER_DAY) || LEADS_PER_AGENT_PER_DAY;
  // No params → latest stored day; explicit from/to (or date) → inclusive multi-day range.
  const { dates, rows } = await loadReportsInRange(from, from ? (to ?? from) : undefined);
  if (!rows.length) {
    return {
      meta: {
        analysis: 'neodove-live',
        title: 'Telecaller Performance (NeoDove Live)',
        reportDate: null,
        range: from ? { from, to: to ?? from, days: 0 } : null,
        configured: true,
        generatedAt: new Date().toISOString(),
        error:
          'No NeoDove report stored for the requested range — waiting for GH Actions runner pushes (backfill via workflow_dispatch input neodove_backfill_days).',
      },
      agents: [],
      totals: null,
      benchmarks: { connectedCallsPerDay: connectedTarget, leadsPerAgentPerDay: leadsTarget },
      zohoUnmapped: [],
    };
  }
  const days = dates.length;
  const nameMap = await loadZohoNameMap();
  const { byAgent: zohoByAgent, byZohoName } = await loadZohoByAgent(nameMap);
  const baseAgents = aggregate(rows);
  const totals = baseAgents.reduce(
    (acc, a) => {
      for (const k of NUMERIC_KEYS) {
        (acc as Record<string, number>)[k] += Number(a[k] ?? 0);
      }
      return acc;
    },
    Object.fromEntries(NUMERIC_KEYS.map((k) => [k, 0])) as Record<typeof NUMERIC_KEYS[number], number>,
  );
  const agents = baseAgents.map((a) => ({
    ...a,
    kra: computeAgentKra(a, connectedTarget, leadsTarget, zohoByAgent[a.userName], days),
  }));
  agents.sort((x, y) => {
    if (ORDER[y.kra.overall] !== ORDER[x.kra.overall]) return ORDER[x.kra.overall] - ORDER[y.kra.overall];
    return y.kra.connectedPct - x.kra.connectedPct;
  });
  const mappedZohoNames = new Set(
    Object.keys(nameMap).map((k) => k.trim().toLowerCase()),
  );
  const zohoUnmapped = Object.entries(byZohoName)
    .filter(([name]) => !mappedZohoNames.has(name.trim().toLowerCase()))
    .map(([name, s]) => ({ zohoName: name, estimates: s.estimates, value: s.value }));
  logger.info({ range: from ? `${from}..${to}` : 'latest', days, agents: agents.length }, 'NeoDove report data served');
  return {
    meta: {
      analysis: 'neodove-live',
      title: 'Telecaller Performance (NeoDove Live)',
      reportDate: dates[0] ?? null,
      range: from ? { from, to: to ?? from, days } : { from: dates[0], to: dates[0], days },
      dates,
      fetchedAt: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      agentCount: agents.length,
    },
    benchmarks: { connectedCallsPerDay: connectedTarget, leadsPerAgentPerDay: leadsTarget },
    agents,
    totals,
    zohoUnmapped,
  };
}
