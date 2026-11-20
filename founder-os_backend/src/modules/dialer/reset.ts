// ── Agent reset (Controller → Auto Dialer → Reset) ────────────────────────────
// Activity is keyed by the AGENT, not the phone, so a reinstalled / re-paired
// phone inherits whatever the old one left behind (an open break, a stale live
// state, today's test calls). This clears it:
//   always  → pending queue recalled, open breaks closed, live state → idle
//   wipeToday (explicit, irreversible) → today's calls, breaks and recordings deleted
import { recallQueue } from './queue';

type Db = D1Database;
type Bucket = { delete(keys: string | string[]): Promise<void> } | undefined;

/** Ends every break this agent still has open (e.g. the app was uninstalled mid-break). */
export async function closeOpenBreaks(db: Db, telecallerId: string, at = new Date()): Promise<number> {
  const iso = at.toISOString();
  const { meta } = await db.prepare(
    `UPDATE DialerBreak
        SET endAt = ?, durationSec = MAX(0, CAST((julianday(?) - julianday(startAt)) * 86400 AS INTEGER)), updatedAt = ?
      WHERE telecallerId = ? AND endAt IS NULL`,
  ).bind(iso, iso, iso, telecallerId).run();
  return Number((meta as any)?.changes ?? 0);
}

export interface ResetResult { recalled: number; breaksClosed: number; callsDeleted: number; breaksDeleted: number; recordingsDeleted: number }

export async function resetAgent(db: Db, bucket: Bucket, telecallerId: string, day: string, wipeToday: boolean): Promise<ResetResult> {
  const now = new Date();
  const recalled = await recallQueue(db, telecallerId);
  const breaksClosed = await closeOpenBreaks(db, telecallerId, now);
  await db.prepare(
    `UPDATE DeviceRegistration SET liveState = 'idle', liveDetail = '', liveAt = ?, pendingSync = 0, updatedAt = ?
      WHERE telecallerId = ? AND status = 'active'`,
  ).bind(now.toISOString(), now.toISOString(), telecallerId).run();

  let callsDeleted = 0, breaksDeleted = 0, recordingsDeleted = 0;
  if (wipeToday) {
    const keys: string[] = (((await db.prepare(
      `SELECT recordingKey FROM DeviceCall WHERE telecallerId = ? AND day = ? AND recordingKey IS NOT NULL AND recordingKey != ''`,
    ).bind(telecallerId, day).all()) as any).results ?? []).map((r: any) => String(r.recordingKey));
    if (bucket && keys.length) { await bucket.delete(keys); recordingsDeleted = keys.length; }
    callsDeleted = Number(((await db.prepare(`DELETE FROM DeviceCall WHERE telecallerId = ? AND day = ?`).bind(telecallerId, day).run()).meta as any)?.changes ?? 0);
    breaksDeleted = Number(((await db.prepare(`DELETE FROM DialerBreak WHERE telecallerId = ? AND day = ?`).bind(telecallerId, day).run()).meta as any)?.changes ?? 0);
  }
  return { recalled, breaksClosed, callsDeleted, breaksDeleted, recordingsDeleted };
}
