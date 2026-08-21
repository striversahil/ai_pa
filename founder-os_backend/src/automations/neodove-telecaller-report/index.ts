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
 *                ?date=YYYY-MM-DD (default: latest stored day)
 *                → per-agent aggregates + individual KRA/KPI vs benchmarks.
 *
 * Individual KRA/KPI (benchmarks judged on today's live numbers):
 *   - ≥ 120 connected calls / agent / day
 *   - ≥ 5 leads (leadsInProgress + leadsConverted) / agent / day
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
}

const NUMERIC_KEYS: (keyof NeodoveAgentRow)[] = [
  'callsAttempted', 'callsConnected', 'callsNotConnected',
  'incomingCalls', 'outgoingCalls', 'incomingMissed', 'outgoingMissed',
  'talkTimeSec', 'leadsConverted', 'leadsInProgress', 'leadsLost',
  'leadsClosed', 'followupLeads', 'pendingScheduledLeads',
];

async function loadReport(date?: string): Promise<{ reportDate: string; fetchedAt: string; rows: any[] } | null> {
  let raw: string | null | undefined;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const row = await prisma.setting.findUnique({ where: { key: `neodove_user_report:${date}` } });
    raw = row?.value;
  } else {
    const rows = await prisma.setting.findMany({
      where: { key: { startsWith: 'neodove_user_report:' } },
      orderBy: { key: 'desc' },
      take: 1,
    });
    raw = rows[0]?.value;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
        leadsClosed: 0, followupLeads: 0, pendingScheduledLeads: 0,
      };
      byUser.set(key, agg);
    }
    for (const k of NUMERIC_KEYS) {
      const v = Number(r[k] ?? 0);
      if (Number.isFinite(v)) (agg as any)[k] += v;
    }
    if (!agg.managerName && r.managerName) agg.managerName = r.managerName;
  }
  return [...byUser.values()].sort((a, b) => b.callsAttempted - a.callsAttempted);
}

type TrafficLight = 'green' | 'amber' | 'red';

function lightFor(pct: number): TrafficLight {
  if (pct >= 100) return 'green';
  if (pct >= 60) return 'amber';
  return 'red';
}

const ORDER: Record<TrafficLight, number> = { green: 0, amber: 1, red: 2 };

export interface AgentKra {
  connectedTarget: number;
  connected: number;
  connectedPct: number;
  connectedStatus: TrafficLight;
  leadsTarget: number;
  leads: number;
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
  return { byAgent, byZohoName };
}

export function computeAgentKra(
  agent: NeodoveAgentRow,
  connectedTarget: number,
  leadsTarget: number,
  zoho?: { estimates: number; value: number },
): AgentKra {
  const leads = agent.leadsInProgress + agent.leadsConverted;
  const connectedPct = Math.round((agent.callsConnected / connectedTarget) * 100);
  const leadsPct = Math.round((leads / leadsTarget) * 100);
  const connectedStatus = lightFor(connectedPct);
  const leadsStatus = lightFor(leadsPct);
  const overall = ORDER[connectedStatus] >= ORDER[leadsStatus] ? connectedStatus : leadsStatus;
  const overallLabel =
    overall === 'green' ? 'On Target 🟢' : overall === 'amber' ? 'Partially On Target 🟡' : 'Below Target 🔴';
  return {
    connectedTarget,
    connected: agent.callsConnected,
    connectedPct,
    connectedStatus,
    leadsTarget,
    leads,
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
  const date = typeof ctx.subject?.date === 'string' ? ctx.subject.date : undefined;
  const connectedTarget = Number(ctx.config?.connectedCallsPerDay ?? CONNECTED_CALLS_PER_DAY) || CONNECTED_CALLS_PER_DAY;
  const leadsTarget = Number(ctx.config?.leadsPerAgentPerDay ?? LEADS_PER_AGENT_PER_DAY) || LEADS_PER_AGENT_PER_DAY;
  const report = await loadReport(date);
  if (!report) {
    return {
      meta: {
        analysis: 'neodove-live',
        reportDate: null,
        configured: true,
        generatedAt: new Date().toISOString(),
        error: 'No NeoDove report stored yet — waiting for GH Actions runner push.',
      },
      agents: [],
      totals: null,
      benchmarks: { connectedCallsPerDay: connectedTarget, leadsPerAgentPerDay: leadsTarget },
      zohoUnmapped: [],
    };
  }
  const nameMap = await loadZohoNameMap();
  const { byAgent: zohoByAgent, byZohoName } = await loadZohoByAgent(nameMap);
  const baseAgents = aggregate(report.rows ?? []);
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
    kra: computeAgentKra(a, connectedTarget, leadsTarget, zohoByAgent[a.userName]),
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
  logger.info({ reportDate: report.reportDate, agents: agents.length }, 'NeoDove report data served');
  return {
    meta: {
      analysis: 'neodove-live',
      title: 'Telecaller Performance (NeoDove Live)',
      reportDate: report.reportDate,
      fetchedAt: report.fetchedAt,
      generatedAt: new Date().toISOString(),
      agentCount: agents.length,
    },
    benchmarks: { connectedCallsPerDay: connectedTarget, leadsPerAgentPerDay: leadsTarget },
    agents,
    totals,
    zohoUnmapped,
  };
}
