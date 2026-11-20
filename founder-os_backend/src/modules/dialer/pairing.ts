// ── Phone-initiated pairing (D1) ────────────────────────────────────────────
// The phone asks to pair and shows a 6-digit code; the sales head assigns it
// to an agent from the Controller. The phone polls with a one-time secret and
// receives its device token exactly once. One active phone per agent.
import { randomToken, hashToken } from '../device-calls/tokens';
import { createDevice, findActiveAgent, findAgentName } from '../device-calls/store';
import { DialerError } from './pure';

type Db = D1Database;
const REQUEST_TTL_MS = 30 * 60_000;

function sixDigits(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, '0');
}

export async function createPairRequest(db: Db, input: {
  deviceId: string; label: string; agentHint: string; appVersion: string;
}): Promise<{ requestId: string; code: string; secret: string; expiresAt: string }> {
  const id = crypto.randomUUID();
  const secret = randomToken().replace(/^fc_/, 'pr_');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REQUEST_TTL_MS).toISOString();
  let code = sixDigits();
  for (let i = 0; i < 5; i++) {
    const clash: any = await db.prepare(`SELECT id FROM DevicePairRequest WHERE code = ? AND status = 'pending'`).bind(code).first();
    if (!clash) break;
    code = sixDigits();
  }
  await db.batch([
    // A phone that asks again replaces its own earlier request.
    db.prepare(`UPDATE DevicePairRequest SET status='expired', deliveredToken=NULL WHERE deviceId = ? AND status IN ('pending','approved')`).bind(input.deviceId),
    db.prepare(
      `INSERT INTO DevicePairRequest(id, code, secretHash, deviceId, label, agentHint, appVersion, status, expiresAt, createdAt)
       VALUES(?,?,?,?,?,?,?,'pending',?,?)`,
    ).bind(id, code, await hashToken(secret), input.deviceId, input.label, input.agentHint, input.appVersion, expiresAt, now.toISOString()),
  ]);
  return { requestId: id, code, secret, expiresAt };
}

export async function listPendingRequests(db: Db): Promise<any[]> {
  const res: any = await db.prepare(
    `SELECT id, code, deviceId, label, agentHint, appVersion, createdAt, expiresAt
       FROM DevicePairRequest WHERE status = 'pending' AND expiresAt > ? ORDER BY createdAt DESC LIMIT 50`,
  ).bind(new Date().toISOString()).all();
  return res?.results ?? [];
}

async function pendingRow(db: Db, id: string): Promise<any> {
  const row: any = await db.prepare('SELECT * FROM DevicePairRequest WHERE id = ? LIMIT 1').bind(id).first();
  if (!row) throw new DialerError('pair request not found', 404);
  if (row.status !== 'pending') throw new DialerError(`request is already ${row.status}`, 409);
  if (Date.parse(row.expiresAt) < Date.now()) throw new DialerError('request expired — ask the agent to reopen the app', 410);
  return row;
}

/** Assign a waiting phone to an agent. Retires that agent's other phones. */
export async function approveRequest(db: Db, id: string, telecallerId: string, actorName: string): Promise<{ agentName: string }> {
  const row = await pendingRow(db, id);
  if (!(await findActiveAgent(db, telecallerId))) throw new DialerError('agent not found', 404);
  const token = randomToken();
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE DeviceRegistration SET status='revoked', revokedAt=?, revokedBy=?, updatedAt=? WHERE telecallerId=? AND status='active'`,
  ).bind(now, actorName, now, telecallerId).run();
  await createDevice(db, {
    telecallerId,
    deviceId: String(row.deviceId),
    tokenHash: await hashToken(token),
    label: String(row.label || row.agentHint || ''),
    appVersion: String(row.appVersion ?? ''),
    pairedBy: actorName,
    pairedByName: actorName,
    pairCode: `req:${row.code}`,
  });
  await db.prepare(
    `UPDATE DevicePairRequest SET status='approved', telecallerId=?, deliveredToken=?, decidedBy=?, decidedAt=? WHERE id=?`,
  ).bind(telecallerId, token, actorName, now, id).run();
  return { agentName: (await findAgentName(db, telecallerId)) ?? '' };
}

export async function rejectRequest(db: Db, id: string, actorName: string): Promise<void> {
  await pendingRow(db, id);
  await db.prepare(`UPDATE DevicePairRequest SET status='rejected', decidedBy=?, decidedAt=? WHERE id=?`)
    .bind(actorName, new Date().toISOString(), id).run();
}

/** Phone poll. The token leaves the server once, then is erased. */
export async function claimRequest(db: Db, id: string, secret: string): Promise<{
  status: string; token?: string; agent?: string; telecallerId?: string;
}> {
  const row: any = await db.prepare('SELECT * FROM DevicePairRequest WHERE id = ? LIMIT 1').bind(id).first();
  if (!row || row.secretHash !== (await hashToken(secret))) throw new DialerError('unknown request', 404);
  if (row.status === 'pending' && Date.parse(row.expiresAt) < Date.now()) return { status: 'expired' };
  if (row.status !== 'approved' || !row.deliveredToken) return { status: String(row.status) };
  await db.prepare(`UPDATE DevicePairRequest SET status='claimed', deliveredToken=NULL WHERE id=?`).bind(id).run();
  return {
    status: 'paired',
    token: String(row.deliveredToken),
    telecallerId: String(row.telecallerId),
    agent: (await findAgentName(db, String(row.telecallerId))) ?? '',
  };
}
