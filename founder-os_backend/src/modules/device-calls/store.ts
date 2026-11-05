// ── Persistence for device registrations + call rows (D1) ───────────────────
import { PAIR_CODE_TTL_MS, type ParsedCall } from './types';

type Db = D1Database;

export async function createPairCode(db: Db, telecallerId: string, createdBy: string): Promise<{ code: string; expiresAt: string }> {
  const { randomPairCode } = await import('./tokens');
  let code = randomPairCode();
  for (let i = 0; i < 5; i++) {
    const exists: any = await db.prepare('SELECT code FROM DevicePairCode WHERE code = ?').bind(code).first();
    if (!exists) break;
    code = randomPairCode();
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAIR_CODE_TTL_MS).toISOString();
  await db.prepare(
    'INSERT INTO DevicePairCode(code, telecallerId, expiresAt, createdBy, createdAt) VALUES(?,?,?,?,?)',
  ).bind(code, telecallerId, expiresAt, createdBy, now.toISOString()).run();
  return { code, expiresAt };
}

export async function findPairCode(db: Db, code: string): Promise<any | null> {
  const row: any = await db.prepare('SELECT * FROM DevicePairCode WHERE code = ? LIMIT 1').bind(code).first();
  if (!row || row.usedAt) return null;
  if (Date.parse(row.expiresAt) < Date.now()) return null;
  return row;
}

export async function createDevice(db: Db, args: {
  telecallerId: string; deviceId: string; tokenHash: string; label: string;
  appVersion: string; pairedBy: string; pairedByName: string; pairCode: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `UPDATE DeviceRegistration SET status='revoked', revokedAt=?, revokedBy=?, updatedAt=? WHERE deviceId=? AND status='active'`,
    ).bind(now, args.pairedBy, now, args.deviceId),
    db.prepare(
      `INSERT INTO DeviceRegistration(id, telecallerId, tokenHash, deviceId, label, status, loggingOnly, consentAt, lastSeenAt, appVersion, pairedBy, pairedByName, createdAt, updatedAt)
       VALUES(?,?,?,?,?,'active',0,?,?,?,?,?,?,?)`,
    ).bind(id, args.telecallerId, args.tokenHash, args.deviceId, args.label.slice(0, 120), null, now, args.appVersion.slice(0, 40), args.pairedBy, args.pairedByName, now, now),
    db.prepare('UPDATE DevicePairCode SET usedAt=? WHERE code=?').bind(now, args.pairCode),
  ]);
  return id;
}

export async function consumePairCode(db: Db, code: string): Promise<void> {
  await db.prepare('UPDATE DevicePairCode SET usedAt=? WHERE code=?').bind(new Date().toISOString(), code).run();
}

export async function listDevices(db: Db): Promise<any[]> {
  const res: any = await db.prepare(
    `SELECT d.id, d.telecallerId, d.deviceId, d.label, d.status, d.loggingOnly, d.consentAt, d.lastSeenAt,
            d.appVersion, d.createdAt, t.name AS agentName, t.region AS region
       FROM DeviceRegistration d LEFT JOIN Telecaller t ON t.id = d.telecallerId
      ORDER BY CASE d.status WHEN 'active' THEN 0 ELSE 1 END, d.createdAt DESC`,
  ).all();
  return (res as any)?.results ?? [];
}

export async function getDevice(db: Db, id: string): Promise<any | null> {
  return db.prepare('SELECT * FROM DeviceRegistration WHERE id = ? LIMIT 1').bind(id).first();
}

export async function revokeDevice(db: Db, id: string, by: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { meta } = await db.prepare(
    `UPDATE DeviceRegistration SET status='revoked', revokedAt=?, revokedBy=?, updatedAt=? WHERE id=? AND status='active'`,
  ).bind(now, by, now, id).run();
  return (meta as any)?.changes > 0;
}

export async function setLoggingOnly(db: Db, id: string, value: boolean): Promise<boolean> {
  const { meta } = await db.prepare('UPDATE DeviceRegistration SET loggingOnly=?, updatedAt=? WHERE id=?')
    .bind(value ? 1 : 0, new Date().toISOString(), id).run();
  return (meta as any)?.changes > 0;
}

export async function touchDevice(db: Db, id: string, appVersion?: string): Promise<void> {
  await db.prepare('UPDATE DeviceRegistration SET lastSeenAt=?, appVersion=COALESCE(?, appVersion) WHERE id=?')
    .bind(new Date().toISOString(), appVersion ?? null, id).run();
}

export async function insertCalls(db: Db, calls: ParsedCall[], telecallerId: string): Promise<number> {
  if (calls.length === 0) return 0;
  const now = new Date().toISOString();
  const statements = calls.map((call) =>
    db.prepare(
      `INSERT INTO DeviceCall(
         id, deviceId, telecallerId, idempotencyKey, direction, numberE164, numberHash, contactName,
         attemptAt, ringStartAt, connectAt, endAt, status, callLogType, durationSec, ringSec, simSlot,
         day, recordingState, recordingBytes, recordingParts, audioSource, receivedAt, createdAt, updatedAt
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(idempotencyKey) DO UPDATE SET
         status=excluded.status,
         connectAt=COALESCE(excluded.connectAt, DeviceCall.connectAt),
         endAt=COALESCE(excluded.endAt, DeviceCall.endAt),
         durationSec=MAX(DeviceCall.durationSec, excluded.durationSec),
         ringSec=MAX(DeviceCall.ringSec, excluded.ringSec),
         callLogType=COALESCE(excluded.callLogType, DeviceCall.callLogType),
         recordingState=CASE WHEN excluded.recordingState != 'none' THEN excluded.recordingState ELSE DeviceCall.recordingState END,
         recordingParts=MAX(DeviceCall.recordingParts, excluded.recordingParts),
         audioSource=CASE WHEN excluded.audioSource != '' THEN excluded.audioSource ELSE DeviceCall.audioSource END,
         updatedAt=excluded.updatedAt`,
    ).bind(
      call.id, call.deviceId, telecallerId, call.idempotencyKey, call.direction, call.numberE164, call.numberHash,
      call.contactName, call.attemptAt, call.ringStartAt, call.connectAt, call.endAt, call.status, call.callLogType,
      call.durationSec, call.ringSec, call.simSlot, call.day, call.recordingState, 0, call.recordingParts,
      call.audioSource, now, now, now,
    ),
  );
  const results = await db.batch(statements);
  return results.length;
}

export async function getCall(db: Db, id: string): Promise<any | null> {
  return db.prepare('SELECT * FROM DeviceCall WHERE id = ? LIMIT 1').bind(id).first();
}

export async function setRecording(db: Db, callId: string, args: {
  key?: string; bytes?: number; parts?: number; state: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE DeviceCall SET recordingState=?, recordingKey=COALESCE(?, recordingKey),
       recordingBytes=MAX(recordingBytes, ?), recordingParts=MAX(recordingParts, ?),
       recordingUploadedAt=?, updatedAt=? WHERE id=?`,
  ).bind(args.state, args.key ?? null, args.bytes ?? 0, args.parts ?? 0, now, now, callId).run();
}

export interface ListFilters {
  telecallerId?: string | null;
  agentId?: string | null;
  from?: string | null;
  to?: string | null;
  direction?: string | null;
  status?: string | null;
  q?: string | null;
  before?: string | null;
  limit: number;
}

function whereFor(f: ListFilters): { sql: string; params: any[] } {
  const clauses = ['1 = 1'];
  const params: any[] = [];
  const agent = f.telecallerId || f.agentId;
  if (agent) { clauses.push('telecallerId = ?'); params.push(agent); }
  if (f.from) { clauses.push('day >= ?'); params.push(f.from); }
  if (f.to) { clauses.push('day <= ?'); params.push(f.to); }
  if (f.direction) { clauses.push('direction = ?'); params.push(f.direction.toUpperCase()); }
  if (f.status) {
    const list = f.status.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (list.length) { clauses.push(`status IN (${list.map(() => '?').join(',')})`); params.push(...list); }
  }
  if (f.q) {
    const needle = `%${f.q.trim()}%`;
    clauses.push('(numberE164 LIKE ? OR contactName LIKE ?)');
    params.push(needle, needle);
  }
  if (f.before) { clauses.push('attemptAt < ?'); params.push(f.before); }
  return { sql: clauses.join(' AND '), params };
}

function view(row: any) {
  return {
    id: row.id,
    telecallerId: row.telecallerId,
    agentName: row.agentName ?? '',
    deviceLabel: row.deviceLabel ?? '',
    direction: row.direction,
    number: row.numberE164,
    contactName: row.contactName,
    attemptAt: row.attemptAt,
    connectAt: row.connectAt,
    endAt: row.endAt,
    status: row.status,
    callLogType: row.callLogType,
    durationSec: row.durationSec,
    ringSec: row.ringSec,
    day: row.day,
    audioSource: row.audioSource,
    recordingState: row.recordingState,
    recordingBytes: row.recordingBytes,
    hasRecording: !!row.recordingKey,
  };
}

export async function listCalls(db: Db, f: ListFilters): Promise<any[]> {
  const where = whereFor(f);
  const res: any = await db.prepare(
    `SELECT c.*, t.name AS agentName, d.label AS deviceLabel
       FROM DeviceCall c
       LEFT JOIN Telecaller t ON t.id = c.telecallerId
       LEFT JOIN DeviceRegistration d ON d.deviceId = c.deviceId
      WHERE ${where.sql}
      ORDER BY c.attemptAt DESC
      LIMIT ?`,
  ).bind(...where.params, Math.max(1, Math.min(f.limit, 500))).all();
  return ((res as any)?.results ?? []).map(view);
}

export async function summary(db: Db, f: ListFilters): Promise<Record<string, number>> {
  const where = whereFor(f);
  const row: any = await db.prepare(
    `SELECT COUNT(*) AS attempts,
            SUM(CASE WHEN status='CONNECTED' THEN 1 ELSE 0 END) AS connected,
            SUM(CASE WHEN status='MISSED' THEN 1 ELSE 0 END) AS missed,
            SUM(CASE WHEN status='REJECTED' THEN 1 ELSE 0 END) AS rejected,
            SUM(CASE WHEN status='BLOCKED' THEN 1 ELSE 0 END) AS blocked,
            SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed,
            SUM(durationSec) AS talkSec
       FROM DeviceCall c WHERE ${where.sql}`,
  ).bind(...where.params).first();
  const repeat: any = await db.prepare(
    `SELECT COUNT(*) AS repeated FROM (
       SELECT numberE164 FROM DeviceCall c WHERE ${where.sql} AND numberE164 != ''
       GROUP BY numberE164 HAVING COUNT(*) > 1)`,
  ).bind(...where.params).first();
  const attempts = Number(row?.attempts ?? 0);
  return {
    attempts,
    connected: Number(row?.connected ?? 0),
    missed: Number(row?.missed ?? 0),
    rejected: Number(row?.rejected ?? 0),
    blocked: Number(row?.blocked ?? 0),
    failed: Number(row?.failed ?? 0),
    talkSec: Number(row?.talkSec ?? 0),
    connectRate: attempts ? Math.round((Number(row?.connected ?? 0) / attempts) * 1000) / 10 : 0,
    repeatedNumbers: Number(repeat?.repeated ?? 0),
  };
}

export async function expireRecordings(db: Db): Promise<number> {
  const { meta } = await db.prepare(
    `UPDATE DeviceCall SET recordingState='expired', recordingKey='', updatedAt=?
      WHERE recordingState='uploaded' AND recordingUploadedAt IS NOT NULL
        AND recordingUploadedAt < datetime('now','-90 days')`,
  ).bind(new Date().toISOString()).run();
  return (meta as any)?.changes ?? 0;
}
