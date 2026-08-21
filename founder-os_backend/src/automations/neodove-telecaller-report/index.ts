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
 *                → per-agent aggregates for dashboards.
 */
import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';
import type { AutomationContext } from '../../modules/automation/types';

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

export async function handler(ctx: AutomationContext): Promise<void> {
  ctx.log('info', 'neodove-telecaller-report: data is pushed by GH Actions runner; nothing to execute here');
}

export async function data(ctx: AutomationContext): Promise<any> {
  const date = typeof ctx.subject?.date === 'string' ? ctx.subject.date : undefined;
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
    };
  }
  const agents = aggregate(report.rows ?? []);
  const totals = agents.reduce(
    (acc, a) => {
      for (const k of NUMERIC_KEYS) acc[k] += a[k];
      return acc;
    },
    Object.fromEntries(NUMERIC_KEYS.map((k) => [k, 0])) as Record<typeof NUMERIC_KEYS[number], number>,
  );
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
    agents,
    totals,
  };
}
