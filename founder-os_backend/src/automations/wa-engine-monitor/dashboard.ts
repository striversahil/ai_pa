import { config } from '../../config';
import { AuditService } from '../../modules/audit/service';
import { getWaEngineCache } from '../../modules/whatsapp/wa-engine-cache';
import type { AutomationContext } from '../../modules/automation/types';

const DEFAULT_WINDOW_DAYS = 7;

function parseMeta(entry: any): Record<string, any> {
  if (!entry?.metadata) return {};
  try {
    return JSON.parse(entry.metadata);
  } catch {
    return {};
  }
}

function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const mins = Math.floor(s / 60);
  if (mins < 60) return `${mins}m ${s % 60}s`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

interface SessionEvent {
  ts: number;
  type: 'WA_ENGINE_DISCONNECTED' | 'WA_ENGINE_RECONNECT';
  status: string | null;
}

interface Outage {
  startedAt: Date;
  endedAt: Date | null;
  status: string;
  ongoing: boolean;
}

function startOfDayMs(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Availability per day over the window (oldest → newest), derived from outage intervals. */
function computeUptimeByDay(outages: Outage[], windowDays: number, now: number): { date: string; uptime: number; downtimeMin: number }[] {
  const todayStart = startOfDayMs(now);
  const days: { date: string; uptime: number; downtimeMin: number }[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const dayStart = todayStart - i * 86400000;
    const dayEnd = dayStart + 86400000;
    const effectiveEnd = Math.min(dayEnd, now);
    const totalSec = Math.max(0, (effectiveEnd - dayStart) / 1000);
    let downSec = 0;
    outages.forEach((o) => {
      const s = Math.max(o.startedAt.getTime(), dayStart);
      const e = Math.min(o.endedAt?.getTime() ?? now, effectiveEnd);
      if (e > s) downSec += (e - s) / 1000;
    });
    const uptime = totalSec > 0 ? Math.round(((totalSec - downSec) / totalSec) * 1000) / 10 : 100;
    days.push({ date: new Date(dayStart).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), uptime, downtimeMin: Math.round(downSec / 60) });
  }
  return days;
}

/**
 * Dashboard data provider for GET /api/automations/wa-engine-monitor/data.
 * Serves the WA Engine Pro snapshot + health payload from the in-memory cache
 * (refreshed every 5 min by the session monitor cron, with a live TTL fallback)
 * and pairs it with the live audit trail of disconnects / reconnects for
 * uptime & outages.
 */
export async function getWaEngineDashboardData(ctx: AutomationContext): Promise<any> {
  const queryDays = Number(ctx.subject?.windowDays ?? 0);
  const windowDays = queryDays > 0 ? queryDays : (Number(ctx.config.windowDays ?? 0) || DEFAULT_WINDOW_DAYS);
  const now = Date.now();
  const windowStart = now - windowDays * 24 * 60 * 60 * 1000;

  const cached = await getWaEngineCache();
  const sessionInfo = cached.sessionInfo;
  const health = cached.health;

  const rawEvents = await AuditService.query({ action: 'WA_ENGINE_DISCONNECTED', entityType: 'SESSION', limit: 1000, since: new Date(windowStart) });
  const recEvents = await AuditService.query({ action: 'WA_ENGINE_RECONNECT', entityType: 'SESSION', limit: 1000, since: new Date(windowStart) });

  const events: SessionEvent[] = [...rawEvents, ...recEvents]
    .map((e) => ({
      ts: e.createdAt.getTime(),
      type: e.action === 'WA_ENGINE_DISCONNECTED' ? ('WA_ENGINE_DISCONNECTED' as const) : ('WA_ENGINE_RECONNECT' as const),
      status: parseMeta(e).status ?? null,
    }))
    .sort((a, b) => a.ts - b.ts);

  const outages: Outage[] = [];
  let openStart: number | null = null;
  let openStatus = 'unknown';
  for (const ev of events) {
    if (ev.type === 'WA_ENGINE_DISCONNECTED' && openStart === null) {
      openStart = ev.ts;
      openStatus = ev.status || 'unknown';
    } else if (ev.type === 'WA_ENGINE_RECONNECT' && openStart !== null) {
      outages.push({ startedAt: new Date(openStart), endedAt: new Date(ev.ts), status: openStatus, ongoing: false });
      openStart = null;
    }
  }
  if (openStart !== null) {
    outages.push({ startedAt: new Date(openStart), endedAt: null, status: openStatus, ongoing: true });
  }

  let outageSec = 0;
  let longestSec = 0;
  const windowSec = windowDays * 86400;
  outages.forEach((o) => {
    const s = Math.max(o.startedAt.getTime(), windowStart);
    const e = Math.min(o.endedAt?.getTime() ?? now, now);
    if (e > s) {
      const sec = Math.floor((e - s) / 1000);
      outageSec += sec;
      if (sec > longestSec) longestSec = sec;
    }
  });
  const uptimePct = windowSec > 0 ? Math.max(0, Math.min(100, Math.round(((windowSec - outageSec) / windowSec) * 1000) / 10)) : 100;

  const liveOk = sessionInfo.reachable && sessionInfo.status === 'WORKING';
  const currentStatus = liveOk ? 'WORKING' : sessionInfo.status || 'unknown';
  const lastOutage = outages[outages.length - 1] ?? null;

  const outageRows = [...outages].reverse().map((o) => [
    new Date(o.startedAt).toLocaleString('en-IN'),
    o.endedAt ? new Date(o.endedAt).toLocaleString('en-IN') : '— (ongoing)',
    o.endedAt ? fmtDuration((o.endedAt.getTime() - o.startedAt.getTime()) / 1000) : '—',
    o.status,
    o.ongoing ? '⚠️ Ongoing' : 'Resolved',
  ]);

  const recentEvents = [...events].reverse().slice(0, 50).map((ev) => [
    new Date(ev.ts).toLocaleString('en-IN'),
    ev.type === 'WA_ENGINE_DISCONNECTED' ? 'Disconnected' : 'Reconnected',
    ev.status || '—',
  ]);

  const engine = sessionInfo.engine ?? null;
  const me = sessionInfo.me ?? null;

  return {
    meta: {
      analysis: 'wa-engine',
      title: 'WA Engine Pro Monitor',
      sessionName: config.WA_ENGINE_BASE_URL,
      windowDays,
      generatedAt: new Date().toISOString(),
      liveCheckedAt: new Date(cached.capturedAt).toISOString(),
      cacheAgeSec: Math.max(0, Math.round((now - cached.capturedAt) / 1000)),
    },
    live: {
      status: sessionInfo.status,
      reachable: sessionInfo.reachable,
      error: sessionInfo.error ?? null,
    },
    diagnostics: {
      sessionName: config.WA_ENGINE_BASE_URL,
      accountId: me?.id ?? null,
      lid: null,
      pushName: me?.name ?? null,
      engine: engine?.engine ?? null,
      webVersion: engine?.webVersion ?? null,
      connectionState: engine?.state ?? null,
      config: sessionInfo.config ?? {},
    },
    health,
    kpis: [
      {
        label: 'Current API Status',
        value: currentStatus,
        sub: `checked ${new Date().toLocaleTimeString('en-IN')} · ${config.WA_ENGINE_BASE_URL}`,
        accent: liveOk ? 'emerald' : 'rose',
      },
      {
        label: `Uptime (${windowDays}d)`,
        value: `${uptimePct}%`,
        sub: `${fmtDuration(outageSec)} total downtime`,
        accent: uptimePct >= 99 ? 'emerald' : uptimePct >= 95 ? 'amber' : 'rose',
      },
      {
        label: 'Outages',
        value: `${outages.length}`,
        sub: `${outages.filter((o) => o.ongoing).length} ongoing`,
        accent: 'violet',
      },
      {
        label: 'Longest Outage',
        value: fmtDuration(longestSec),
        sub: lastOutage ? `last: ${new Date(lastOutage.startedAt).toLocaleString('en-IN')}` : 'no outages in window',
        accent: longestSec > 0 ? 'rose' : 'emerald',
      },
    ],
    uptimeByDay: computeUptimeByDay(outages, windowDays, now),
    tables: [
      { title: 'Session Outage Timeline', columns: ['Started', 'Recovered', 'Duration', 'Status', 'State'], rows: outageRows },
      { title: 'Recent Session Events', columns: ['Timestamp', 'Event', 'Status'], rows: recentEvents },
    ],
  };
}
