// ── Dialer config + per-agent queue persistence (D1) ────────────────────────
import { CONFIG_KEY, type DialerConfig, type QueueItemView } from './types';
import { normalizeConfig, parseStoredConfig, queueOutcome } from './pure';
import { displayNameForEmail } from '../../shared/employee-name';
import { loadEmployeeNameIndex } from '../../shared/employee-name-store';

type Db = D1Database;

export async function getConfig(db: Db): Promise<DialerConfig> {
  const row: any = await db.prepare('SELECT value FROM Setting WHERE key = ?').bind(CONFIG_KEY).first().catch(() => null);
  return parseStoredConfig(row?.value);
}

export async function saveConfig(db: Db, raw: unknown, actor: string): Promise<DialerConfig> {
  const cfg = normalizeConfig(raw, actor);
  await db.prepare(
    `INSERT INTO Setting(key, value, updatedAt) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt`,
  ).bind(CONFIG_KEY, JSON.stringify(cfg), cfg.updatedAt).run();
  return cfg;
}

export interface EnqueueRow {
  /** Ledger row id (NeoDoveLeadPush.id) — echoed back so the caller can mark outcomes. */
  ref: string;
  telecallerId: string;
  customerId: string;
  mobile: string;
  name: string;
  batchId: string;
}

/**
 * Add pushed leads to agents' queues. A number already waiting for that agent
 * is skipped (partial unique index), never duplicated.
 */
export async function enqueueLeads(db: Db, rows: EnqueueRow[]): Promise<{ queued: string[]; duplicates: string[] }> {
  const queued: string[] = [];
  const duplicates: string[] = [];
  const now = new Date();
  const base = now.getTime() * 1000;
  for (let i = 0; i < rows.length; i += 40) {
    const slice = rows.slice(i, i + 40);
    const results = await db.batch(slice.map((r, j) => db.prepare(
      `INSERT OR IGNORE INTO DialerQueue(id, telecallerId, customerId, mobile, name, batchId, source, status, attempts, dueAt, position, createdAt, updatedAt)
       VALUES(?,?,?,?,?,?,'push','pending',0,?,?,?,?)`,
    ).bind(crypto.randomUUID(), r.telecallerId, r.customerId, r.mobile, r.name, r.batchId,
      now.toISOString(), base + i + j, now.toISOString(), now.toISOString())));
    results.forEach((res: any, j) => ((res?.meta?.changes ?? 0) > 0 ? queued : duplicates).push(slice[j].ref));
  }
  return { queued, duplicates };
}

/** Due work for one agent: callbacks first, then due retries, then pushes in push order. */
export async function listDue(db: Db, telecallerId: string, limit = 50): Promise<{ items: QueueItemView[]; waiting: number }> {
  const now = new Date().toISOString();
  const res: any = await db.prepare(
    `SELECT q.id, q.customerId, q.mobile, q.name, q.source, q.attempts, q.dueAt, q.lastDisposition,
            c.companyName, c.region, c.state, c.district, c.customerTypeBase
       FROM DialerQueue q LEFT JOIN core_customer c ON c.id = q.customerId
      WHERE q.telecallerId = ? AND q.status = 'pending' AND q.dueAt <= ?
      ORDER BY CASE q.source WHEN 'callback' THEN 0 WHEN 'retry' THEN 1 ELSE 2 END, q.dueAt, q.position
      LIMIT ?`,
  ).bind(telecallerId, now, Math.max(1, Math.min(limit, 200))).all();
  const later: any = await db.prepare(
    `SELECT COUNT(*) AS n FROM DialerQueue WHERE telecallerId = ? AND status = 'pending' AND dueAt > ?`,
  ).bind(telecallerId, now).first();
  const items = ((res?.results ?? []) as any[]).map((r) => ({
    id: String(r.id),
    customerId: String(r.customerId ?? ''),
    mobile: String(r.mobile ?? ''),
    name: String(r.name ?? ''),
    company: String(r.companyName ?? ''),
    region: String(r.region ?? ''),
    state: String(r.state ?? ''),
    district: String(r.district ?? ''),
    clientType: String(r.customerTypeBase ?? ''),
    source: String(r.source ?? 'push'),
    attempts: Number(r.attempts ?? 0),
    dueAt: String(r.dueAt ?? ''),
    lastDisposition: String(r.lastDisposition ?? ''),
  }));
  return { items, waiting: Number(later?.n ?? 0) };
}

/** Close or re-queue a queue row after its disposition. No-op for foreign rows. */
export async function settleQueueRow(
  db: Db, cfg: DialerConfig, telecallerId: string, queueId: string, disposition: string, callbackAt: string | null,
): Promise<void> {
  const row: any = await db.prepare(
    `SELECT id, attempts, status FROM DialerQueue WHERE id = ? AND telecallerId = ? LIMIT 1`,
  ).bind(queueId, telecallerId).first();
  if (!row || row.status !== 'pending') return;
  const attempts = Number(row.attempts ?? 0) + 1;
  const next = queueOutcome(cfg, disposition, attempts, callbackAt);
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE DialerQueue SET status=?, source=COALESCE(NULLIF(?, ''), source), dueAt=COALESCE(?, dueAt),
            attempts=?, lastDisposition=?, updatedAt=? WHERE id=?`,
  ).bind(next.status, next.source, next.dueAt, attempts, disposition, now, queueId).run();
}

/** Pull back an agent's waiting leads (all, or one push batch). */
export async function recallQueue(db: Db, telecallerId: string, batchId?: string): Promise<number> {
  const now = new Date().toISOString();
  const stmt = batchId
    ? db.prepare(`UPDATE DialerQueue SET status='recalled', updatedAt=? WHERE telecallerId=? AND batchId=? AND status='pending'`).bind(now, telecallerId, batchId)
    : db.prepare(`UPDATE DialerQueue SET status='recalled', updatedAt=? WHERE telecallerId=? AND status='pending'`).bind(now, telecallerId);
  const { meta } = await stmt.run();
  return Number((meta as any)?.changes ?? 0);
}

/** Leads that hit the retry cap (never re-queued), newest first. */
export async function listUnreachable(db: Db, sinceIso: string): Promise<any[]> {
  const res: any = await db.prepare(
    `SELECT q.id, q.telecallerId, q.mobile, q.name, q.attempts, q.lastDisposition, q.updatedAt, t.name AS agentName, t.email AS agentEmail
       FROM DialerQueue q LEFT JOIN Telecaller t ON t.id = q.telecallerId
      WHERE q.status = 'unreachable' AND q.updatedAt >= ? ORDER BY q.updatedAt DESC LIMIT 300`,
  ).bind(sinceIso).all();
  const employees = await loadEmployeeNameIndex();
  return ((res?.results ?? []) as any[]).map((r) => ({
    id: String(r.id), telecallerId: String(r.telecallerId),
    agentName: displayNameForEmail(employees, r.agentEmail, String(r.agentName ?? '')),
    mobile: String(r.mobile ?? ''), name: String(r.name ?? ''), attempts: Number(r.attempts ?? 0),
    lastDisposition: String(r.lastDisposition ?? ''), updatedAt: String(r.updatedAt ?? ''),
  }));
}

/** Waiting counts per agent (due now / scheduled later) for the board. */
export async function queueCounts(db: Db): Promise<Map<string, { due: number; later: number }>> {
  const now = new Date().toISOString();
  const res: any = await db.prepare(
    `SELECT telecallerId, SUM(CASE WHEN dueAt <= ? THEN 1 ELSE 0 END) AS due, SUM(CASE WHEN dueAt > ? THEN 1 ELSE 0 END) AS later
       FROM DialerQueue WHERE status = 'pending' GROUP BY telecallerId`,
  ).bind(now, now).all();
  const out = new Map<string, { due: number; later: number }>();
  for (const r of (res?.results ?? []) as any[]) out.set(String(r.telecallerId), { due: Number(r.due ?? 0), later: Number(r.later ?? 0) });
  return out;
}
