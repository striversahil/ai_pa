// ── Dialer report + live board reads (D1) ───────────────────────────────────
import { breakOverrunSec, dispositionOf, istHour } from './pure';
import { queueCounts } from './queue';
import { NOT_DISPOSED, type DialerConfig } from './types';

type Db = D1Database;

export interface HourCell { attempted: number; connected: number; talkSec: number }

export interface AgentDay {
  telecallerId: string;
  name: string;
  region: string;
  attempted: number;
  connected: number;
  talkSec: number;
  manual: number;
  flagged: number;
  /** IST hour (0-23) → counts; only hours with calls are present. */
  hours: Record<number, HourCell>;
  dispositions: Record<string, number>;
  breaks: Array<{ reason: string; startAt: string; endAt: string | null; durationSec: number; overrunSec: number; note: string }>;
  breakSec: number;
}

/** A call reached the customer: by its disposition when it has one, else by the call log. */
function reached(cfg: DialerConfig, row: any): boolean {
  const key = String(row.disposition ?? '');
  if (key && key !== NOT_DISPOSED) return !!dispositionOf(cfg, key)?.connected;
  return String(row.status) === 'CONNECTED';
}

export async function dayReport(db: Db, cfg: DialerConfig, day: string): Promise<{ day: string; agents: AgentDay[] }> {
  const [calls, breaks, roster] = await Promise.all([
    db.prepare(`SELECT telecallerId, attemptAt, durationSec, status, disposition, manual FROM DeviceCall WHERE day = ?`).bind(day).all(),
    db.prepare(`SELECT telecallerId, reason, note, startAt, endAt, durationSec FROM DialerBreak WHERE day = ? ORDER BY startAt`).bind(day).all(),
    db.prepare(`SELECT id, name, region FROM Telecaller`).all(),
  ]);
  const names = new Map<string, { name: string; region: string }>();
  for (const r of ((roster as any).results ?? []) as any[]) names.set(String(r.id), { name: String(r.name ?? ''), region: String(r.region ?? '') });
  const agents = new Map<string, AgentDay>();
  const agent = (id: string): AgentDay => {
    let a = agents.get(id);
    if (!a) {
      const n = names.get(id);
      a = { telecallerId: id, name: n?.name ?? id, region: n?.region ?? '', attempted: 0, connected: 0, talkSec: 0, manual: 0, flagged: 0, hours: {}, dispositions: {}, breaks: [], breakSec: 0 };
      agents.set(id, a);
    }
    return a;
  };
  for (const r of ((calls as any).results ?? []) as any[]) {
    const a = agent(String(r.telecallerId));
    const ok = reached(cfg, r);
    const talk = Number(r.durationSec ?? 0);
    a.attempted++; a.talkSec += talk;
    if (ok) a.connected++;
    if (Number(r.manual) === 1) a.manual++;
    const key = String(r.disposition ?? '') || 'NONE';
    if (key === NOT_DISPOSED) a.flagged++;
    a.dispositions[key] = (a.dispositions[key] ?? 0) + 1;
    const h = istHour(String(r.attemptAt));
    const cell = a.hours[h] ?? (a.hours[h] = { attempted: 0, connected: 0, talkSec: 0 });
    cell.attempted++; cell.talkSec += talk;
    if (ok) cell.connected++;
  }
  for (const r of ((breaks as any).results ?? []) as any[]) {
    const a = agent(String(r.telecallerId));
    const open = !r.endAt;
    const durationSec = open ? Math.max(0, Math.round((Date.now() - Date.parse(String(r.startAt))) / 1000)) : Number(r.durationSec ?? 0);
    a.breakSec += durationSec;
    a.breaks.push({
      reason: String(r.reason), startAt: String(r.startAt), endAt: r.endAt ? String(r.endAt) : null,
      durationSec, overrunSec: breakOverrunSec(cfg, String(r.reason), durationSec), note: String(r.note ?? ''),
    });
  }
  return { day, agents: [...agents.values()].sort((x, y) => x.name.localeCompare(y.name)) };
}

/** One row per active phone: who, live state, sync backlog, queue and today's totals. */
export async function liveBoard(db: Db, cfg: DialerConfig, today: string): Promise<any[]> {
  const [devices, counts, report] = await Promise.all([
    db.prepare(
      `SELECT d.id, d.telecallerId, d.label, d.appVersion, d.lastSeenAt, d.liveState, d.liveDetail, d.liveAt, d.pendingSync,
              t.name AS agentName, t.region
         FROM DeviceRegistration d LEFT JOIN Telecaller t ON t.id = d.telecallerId
        WHERE d.status = 'active' ORDER BY t.name`,
    ).all(),
    queueCounts(db),
    dayReport(db, cfg, today),
  ]);
  const byAgent = new Map(report.agents.map((a) => [a.telecallerId, a]));
  return (((devices as any).results ?? []) as any[]).map((d) => {
    const day = byAgent.get(String(d.telecallerId));
    const openBreak = day?.breaks.find((b) => !b.endAt) ?? null;
    const q = counts.get(String(d.telecallerId)) ?? { due: 0, later: 0 };
    return {
      deviceId: String(d.id),
      telecallerId: String(d.telecallerId),
      agentName: String(d.agentName ?? ''),
      region: String(d.region ?? ''),
      label: String(d.label ?? ''),
      appVersion: String(d.appVersion ?? ''),
      lastSeenAt: d.lastSeenAt ?? null,
      // No sync for 5 minutes = offline, whatever the phone last reported.
      liveState: !d.liveAt || Date.now() - Date.parse(String(d.liveAt)) > 5 * 60_000 ? 'offline' : String(d.liveState || 'idle'),
      liveDetail: String(d.liveDetail ?? ''),
      liveAt: d.liveAt ?? null,
      pendingSync: Number(d.pendingSync ?? 0),
      queueDue: q.due,
      queueLater: q.later,
      attempted: day?.attempted ?? 0,
      connected: day?.connected ?? 0,
      talkSec: day?.talkSec ?? 0,
      breakSec: day?.breakSec ?? 0,
      openBreak,
    };
  });
}
