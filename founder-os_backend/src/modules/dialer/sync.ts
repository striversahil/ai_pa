// ── Device sync: calls + dispositions + breaks + live state in one request ──
// The phone queues everything offline and resends until each item comes back
// in `accepted*` (its "processed" tick). Every write is idempotent, so a
// resend after a dropped response never double-counts.
import { parseBatch } from '../device-calls/parse';
import { insertCalls } from '../device-calls/store';
import { istDay } from '../device-calls/types';
import { getConfig, settleQueueRow } from './queue';
import { LIVE_STATES } from './types';
import { toKey } from './pure';

type Db = D1Database;
const MAX_OFFLINE_DAYS = 90;

export interface SyncResult {
  acceptedCalls: string[];
  rejectedCalls: Array<{ id: string; error: string }>;
  acceptedBreaks: string[];
  rejectedBreaks: Array<{ id: string; error: string }>;
  configVersion: string;
}

function isoOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Calls made outside the dialer are kept only when the number is a customer's. */
async function isCustomerNumber(db: Db, number: string): Promise<boolean> {
  const last10 = number.replace(/\D/g, '').slice(-10);
  if (last10.length < 10) return false;
  const row: any = await db.prepare(
    `SELECT id FROM core_customer WHERE phonesJson LIKE ? AND (status IS NULL OR status <> 'DELETED') LIMIT 1`,
  ).bind(`%${last10}%`).first().catch(() => null);
  return !!row;
}

async function syncCalls(db: Db, list: any[], device: { deviceId: string; telecallerId: string }, out: SyncResult): Promise<number> {
  const cfg = await getConfig(db);
  let stored = 0;
  for (const raw of list.slice(0, 200)) {
    const id = String(raw?.id ?? '');
    const parsed = await parseBatch({ calls: [raw] }, device.deviceId, MAX_OFFLINE_DAYS);
    const call = parsed.calls[0];
    if (!call) { out.rejectedCalls.push({ id, error: parsed.errors[0] ?? 'invalid call' }); continue; }
    // Phone-dialer calls (call log, app ≥ 1.2.0) follow the Controller switch;
    // older apps' external calls keep the customer-number-only rule.
    const fromPhone = raw?.origin === 'phone';
    const keep = fromPhone ? cfg.trackPhoneCalls : raw?.external !== true || (await isCustomerNumber(db, call.numberE164));
    if (!keep) {
      out.acceptedCalls.push(id); // acknowledged, never stored
      continue;
    }
    const before: any = await db.prepare('SELECT disposition FROM DeviceCall WHERE idempotencyKey = ?').bind(call.idempotencyKey).first();
    await insertCalls(db, [call], device.telecallerId);
    if (fromPhone) await db.prepare(`UPDATE DeviceCall SET origin='phone' WHERE idempotencyKey=?`).bind(call.idempotencyKey).run();
    const disposition = toKey(raw?.disposition);
    const queueId = String(raw?.queueId ?? '').slice(0, 64) || null;
    const callbackAt = isoOrNull(raw?.callbackAt);
    if (disposition) {
      await db.prepare(
        `UPDATE DeviceCall SET disposition=?, remarks=?, callbackAt=?, queueId=COALESCE(?, queueId),
                customerId=COALESCE(NULLIF(?, ''), customerId), manual=?, autoSaved=?, updatedAt=?
          WHERE idempotencyKey=?`,
      ).bind(
        disposition, String(raw?.remarks ?? '').slice(0, 500), callbackAt, queueId,
        String(raw?.customerId ?? '').slice(0, 64), raw?.manual ? 1 : 0, raw?.autoSaved ? 1 : 0,
        new Date().toISOString(), call.idempotencyKey,
      ).run();
      // Settle the queue row once, on the first disposition this call receives.
      // NOT_DISPOSED (timer ran out with talk time) is not a retry: the row closes
      // and the report flags the call for review.
      if (queueId && !before?.disposition) {
        await settleQueueRow(db, cfg, device.telecallerId, queueId, disposition, callbackAt);
      }
    }
    out.acceptedCalls.push(id);
    stored++;
  }
  return stored;
}

async function syncBreaks(db: Db, list: any[], device: { deviceId: string; telecallerId: string }, out: SyncResult): Promise<void> {
  const now = new Date().toISOString();
  for (const raw of list.slice(0, 100)) {
    const id = String(raw?.id ?? '').slice(0, 64);
    const startAt = isoOrNull(raw?.startAt);
    const reason = toKey(raw?.reason);
    if (!id || !startAt || !reason) { out.rejectedBreaks.push({ id, error: 'id, reason and startAt required' }); continue; }
    const endAt = isoOrNull(raw?.endAt);
    const durationSec = endAt ? Math.max(0, Math.round((Date.parse(endAt) - Date.parse(startAt)) / 1000)) : 0;
    await db.prepare(
      `INSERT INTO DialerBreak(id, idempotencyKey, deviceId, telecallerId, reason, note, startAt, endAt, durationSec, day, receivedAt, updatedAt)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(idempotencyKey) DO UPDATE SET endAt=COALESCE(excluded.endAt, DialerBreak.endAt),
         durationSec=MAX(DialerBreak.durationSec, excluded.durationSec), note=excluded.note, updatedAt=excluded.updatedAt`,
    ).bind(crypto.randomUUID(), `${device.deviceId}|${id}`, device.deviceId, device.telecallerId, reason,
      String(raw?.note ?? '').slice(0, 200), startAt, endAt, durationSec, istDay(startAt), now, now).run();
    out.acceptedBreaks.push(id);
  }
}

export async function applySync(db: Db, body: any, device: { id: string; deviceId: string; telecallerId: string }): Promise<SyncResult & { storedCalls: number }> {
  const out: SyncResult = { acceptedCalls: [], rejectedCalls: [], acceptedBreaks: [], rejectedBreaks: [], configVersion: '' };
  const storedCalls = Array.isArray(body?.calls) ? await syncCalls(db, body.calls, device, out) : 0;
  if (Array.isArray(body?.breaks)) await syncBreaks(db, body.breaks, device, out);
  const state = String(body?.state?.state ?? '');
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE DeviceRegistration SET lastSeenAt=?, liveState=CASE WHEN ? != '' THEN ? ELSE liveState END,
            liveDetail=?, liveAt=?, pendingSync=?, appVersion=COALESCE(NULLIF(?, ''), appVersion) WHERE id=?`,
  ).bind(
    now, LIVE_STATES.has(state) ? state : '', LIVE_STATES.has(state) ? state : '',
    String(body?.state?.detail ?? '').slice(0, 160), now,
    Math.max(0, Math.min(100000, Number(body?.state?.pendingSync ?? 0) || 0)),
    String(body?.appVersion ?? '').slice(0, 40), device.id,
  ).run();
  out.configVersion = (await getConfig(db)).updatedAt;
  return { ...out, storedCalls };
}
