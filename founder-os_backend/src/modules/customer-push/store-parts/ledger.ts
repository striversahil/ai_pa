// ledger.ts — the append-only push ledger (CustomerPushBatch / CustomerPushLead).
// One batch per push action, one row per lead. Rows are never edited back into
// the book; a repeat push simply creates fresh attempt rows.
import type { AssignedLead, PushBatch, SkippedLead } from '../types';
import { pushDb } from './db';
import { BATCH_COLUMNS, LEAD_COLUMNS, PATCHABLE, INSERT_CHUNK, toBatch } from './pure';

export interface LeadOutcome {
  id: string;
  ok: boolean;
  /** HTTP-ish status recorded for the attempt (200 = queued). */
  status: number | null;
  body: string;
}

export async function insertBatch(batch: PushBatch): Promise<void> {
  const db = pushDb();
  if (!db) throw new Error('database unavailable');
  await db
    .prepare(
      `INSERT INTO CustomerPushBatch (${BATCH_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      batch.id, batch.region, batch.state, batch.district || '', batch.clientType || '', batch.mode, batch.status,
      batch.total, batch.planned, batch.sent, batch.failed, batch.skipped, batch.pending,
      batch.distribution, batch.agentKey,
      batch.requestedBy, batch.requestedByName, batch.campaignHost, batch.detail1, batch.error,
      batch.createdAt, batch.updatedAt, batch.finishedAt, batch.target,
    )
    .run();
}

export async function getBatch(id: string): Promise<PushBatch | null> {
  const db = pushDb();
  if (!db) return null;
  const row = await db.prepare(`SELECT ${BATCH_COLUMNS} FROM CustomerPushBatch WHERE id = ?`).bind(id).first();
  return row ? toBatch(row) : null;
}

export async function updateBatch(id: string, patch: Record<string, unknown>): Promise<void> {
  const db = pushDb();
  if (!db) return;
  const keys = Object.keys(patch).filter((k) => PATCHABLE.has(k));
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  await db.prepare(`UPDATE CustomerPushBatch SET ${sets} WHERE id = ?`)
    .bind(...keys.map((k) => patch[k] as any), id)
    .run();
}

/** Recompute the batch tallies from the ledger (single source of truth). */
export async function recountBatch(id: string): Promise<PushBatch | null> {
  const db = pushDb();
  if (!db) return null;
  const res = await db
    .prepare(`SELECT status, COUNT(*) AS n FROM CustomerPushLead WHERE batchId = ? GROUP BY status`)
    .bind(id)
    .all();
  const counts: Record<string, number> = {};
  for (const row of ((res?.results ?? []) as any[])) counts[String(row?.status ?? '')] = Number(row?.n ?? 0);
  const sent = counts.sent ?? 0;
  const failed = counts.failed ?? 0;
  const skipped = counts.skipped ?? 0;
  const pending = (counts.pending ?? 0) + (counts.sending ?? 0);
  const total = sent + failed + skipped + pending;
  await updateBatch(id, {
    sent, failed, skipped, pending, total, updatedAt: new Date().toISOString(),
  });
  return getBatch(id);
}

export async function listBatches(region: string, limit = 20): Promise<PushBatch[]> {
  const db = pushDb();
  if (!db) return [];
  const res = region
    ? await db.prepare(`SELECT ${BATCH_COLUMNS} FROM CustomerPushBatch WHERE region = ? ORDER BY createdAt DESC LIMIT ?`).bind(region, limit).all()
    : await db.prepare(`SELECT ${BATCH_COLUMNS} FROM CustomerPushBatch ORDER BY createdAt DESC LIMIT ?`).bind(limit).all();
  return ((res?.results ?? []) as any[]).map(toBatch);
}

export async function insertLeadRows(
  batchId: string,
  region: string,
  state: string,
  leads: AssignedLead[],
  skipped: SkippedLead[],
): Promise<void> {
  const db = pushDb();
  if (!db) throw new Error('database unavailable');
  const now = new Date().toISOString();
  type Row = (string | null)[];
  const rows: Row[] = [];

  for (const { lead, agentKey } of leads) {
    rows.push([
      `${batchId}:${lead.customerId}`, batchId, lead.customerId, lead.zohoCustomerId, region, state,
      lead.mobile, lead.name, lead.email, 'pending', null, agentKey, now,
    ]);
  }
  for (const skip of skipped) {
    // Duplicate mobile inside one push: no second phone call, but the row is
    // still recorded so the UI can explain the count.
    rows.push([
      `${batchId}:${skip.customerId}`, batchId, skip.customerId, '', region, state,
      '', skip.name, '', 'skipped', skip.reason, '', now,
    ]);
  }

  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values: any[] = [];
    for (const row of chunk) values.push(...row);
    await db
      .prepare(`INSERT INTO CustomerPushLead (${LEAD_COLUMNS}) VALUES ${placeholders}`)
      .bind(...values)
      .run();
  }
}

/** Record a whole push in one D1 batch (one subrequest, not N). */
export async function markOutcomes(outcomes: LeadOutcome[]): Promise<void> {
  const db = pushDb();
  if (!db || outcomes.length === 0) return;
  const now = new Date().toISOString();
  const statements = outcomes.map((outcome) => {
    if (outcome.ok) {
      return db.prepare(
        `UPDATE CustomerPushLead
            SET status = 'sent', httpStatus = ?, responseText = ?, attempts = attempts + 1,
                pushedAt = ?, skipReason = NULL
          WHERE id = ?`,
      ).bind(outcome.status ?? 200, outcome.body.slice(0, 500), now, outcome.id);
    }
    return db.prepare(
      `UPDATE CustomerPushLead
          SET status = 'failed', httpStatus = ?, responseText = ?, attempts = attempts + 1
        WHERE id = ?`,
    ).bind(outcome.status, outcome.body.slice(0, 500), outcome.id);
  });
  if (typeof db.batch === 'function') {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) await statement.run();
}

/** Rows the dialer skipped because that number already waits in the queue. */
export async function markSkipped(ids: string[], reason: string): Promise<void> {
  const db = pushDb();
  if (!db || ids.length === 0) return;
  for (let i = 0; i < ids.length; i += 50) {
    const slice = ids.slice(i, i + 50);
    await db.prepare(
      `UPDATE CustomerPushLead SET status = 'skipped', skipReason = ? WHERE id IN (${slice.map(() => '?').join(',')})`,
    ).bind(reason, ...slice).run();
  }
}