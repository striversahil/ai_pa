// ── Device call aggregates for the leaderboard (source = 'device') ──────────
import { getD1Database } from '../../shared/prisma-d1';
import { cached, cacheDelPrefix } from '../../shared/cache';

export interface DeviceCallDaySum {
  attempted: number;
  connected: number;
  notConnected: number;
  talkSec: number;
}

export async function invalidateDeviceCallCaches(): Promise<void> {
  await cacheDelPrefix('device-calls:');
}

/** Map key `${day}|${telecallerId}` → counts. Cached 60s. */
export async function getDeviceCallSums(from: string, to: string): Promise<Map<string, DeviceCallDaySum>> {
  return cached(`device-calls:sum:${from}:${to}`, 60_000, async () => {
    const out = new Map<string, DeviceCallDaySum>();
    const db: any = getD1Database();
    if (!db?.prepare) return out;
    try {
      const res: any = await db.prepare(
        `SELECT telecallerId, day,
                COUNT(*) AS attempted,
                SUM(CASE WHEN status='CONNECTED' THEN 1 ELSE 0 END) AS connected,
                SUM(CASE WHEN status!='CONNECTED' THEN 1 ELSE 0 END) AS notConnected,
                SUM(durationSec) AS talkSec
           FROM DeviceCall WHERE day >= ? AND day <= ?
          GROUP BY telecallerId, day`,
      ).bind(from, to).all();
      for (const r of (res?.results ?? [])) {
        out.set(`${String(r.day)}|${String(r.telecallerId)}`, {
          attempted: Number(r.attempted ?? 0),
          connected: Number(r.connected ?? 0),
          notConnected: Number(r.notConnected ?? 0),
          talkSec: Number(r.talkSec ?? 0),
        });
      }
    } catch { /* table missing before migration */ }
    return out;
  });
}
