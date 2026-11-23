// rate-batch.ts — one row per bulk paste, and the undo that goes with it.
//
// Founder decision 2026-11-23 (v3): when a chat agent answers with 40 quotes and
// three are wrong, the operator needs the paste as a UNIT — see what it created,
// what it rejected, and delete exactly that. `VendorRate.batchId` carries the
// link; this module owns the record (migration 0160).
//
// Raw SQL on purpose: the shim's generated accessors cover the domain models, a
// trace table does not need a Prisma surface, and `catalog-write.ts` already
// reads the same way.
import { prisma } from '../../shared/prisma';
import { getD1Database } from '../../shared/prisma-d1';
import { clearSpecIndex } from './spec-index';
import { touched } from './write-common';

export interface RateBatch {
  id: string;
  source: string;
  actorId: string | null;
  actorName: string | null;
  label: string | null;
  rowCount: number;
  createdCount: number;
  failedCount: number;
  vendorNames: string[];
  failures: { row: number; product?: string; vendor?: string; error: string }[];
  status: string;
  createdAt: string;
  /** Live quote count (the batch's own count is frozen at import time). */
  liveCount?: number;
}

function rowsOf<T = any>(res: unknown): T[] {
  return ((res as any)?.results ?? []) as T[];
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function toBatch(row: any): RateBatch {
  return {
    id: String(row.id),
    source: String(row.source ?? 'ai_paste'),
    actorId: row.actorId != null ? String(row.actorId) : null,
    actorName: row.actorName != null ? String(row.actorName) : null,
    label: row.label != null ? String(row.label) : null,
    rowCount: Number(row.rowCount ?? 0),
    createdCount: Number(row.createdCount ?? 0),
    failedCount: Number(row.failedCount ?? 0),
    vendorNames: parseJson<string[]>(row.vendorNames, []),
    failures: parseJson<RateBatch['failures']>(row.failures, []),
    status: String(row.status ?? 'done'),
    createdAt: String(row.createdAt ?? ''),
    liveCount: row.liveCount != null ? Number(row.liveCount) : undefined,
  };
}

/** Open a batch before the import loop; `finishBatch` closes it with the counts. */
export async function createBatch(input: {
  source?: string;
  actorId?: string | null;
  actorName?: string | null;
  label?: string | null;
  rowCount: number;
}): Promise<string> {
  const id = `rb_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await (prisma as any).$executeRawUnsafe(
    'INSERT INTO RateBatch (id, source, actorId, actorName, label, rowCount, createdCount, failedCount, ' +
      'vendorNames, failures, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)',
    id,
    String(input.source ?? 'ai_paste'),
    input.actorId ?? null,
    input.actorName ?? null,
    input.label ? String(input.label).slice(0, 200) : null,
    Math.max(0, Math.floor(input.rowCount)),
    '[]',
    '[]',
    'running',
    now,
    now,
  );
  return id;
}

export async function finishBatch(
  id: string,
  result: {
    createdCount: number;
    failedCount: number;
    vendorNames?: string[];
    failures?: RateBatch['failures'];
  },
): Promise<void> {
  await (prisma as any).$executeRawUnsafe(
    'UPDATE RateBatch SET createdCount = ?, failedCount = ?, vendorNames = ?, failures = ?, status = ?, updatedAt = ? WHERE id = ?',
    Math.max(0, Math.floor(result.createdCount)),
    Math.max(0, Math.floor(result.failedCount)),
    JSON.stringify((result.vendorNames ?? []).slice(0, 200)),
    JSON.stringify((result.failures ?? []).slice(0, 200)),
    'done',
    new Date().toISOString(),
    String(id),
  );
}

/** Newest first, each with the number of quotes still alive in it. */
export async function listBatches(limit = 100): Promise<RateBatch[]> {
  const db = getD1Database();
  const res = await db
    .prepare(
      'SELECT b.*, (SELECT COUNT(*) FROM VendorRate r WHERE r.batchId = b.id) AS liveCount ' +
        'FROM RateBatch b ORDER BY b.createdAt DESC LIMIT ?',
    )
    .bind(Math.min(200, Math.max(1, Math.floor(limit))))
    .all();
  return rowsOf(res).map(toBatch);
}

export async function getBatch(id: string): Promise<RateBatch | null> {
  const db = getD1Database();
  const row = await db
    .prepare(
      'SELECT b.*, (SELECT COUNT(*) FROM VendorRate r WHERE r.batchId = b.id) AS liveCount ' +
        'FROM RateBatch b WHERE b.id = ?',
    )
    .bind(String(id))
    .first();
  return row ? toBatch(row) : null;
}

/** The quotes a batch created (for the drawer's preview). */
export async function batchRates(id: string, limit = 200): Promise<{ id: string; productName: string | null; vendorName: string | null; pricePerUnit: number | null; baseRate: number | null; unit: string }[]> {
  const db = getD1Database();
  const res = await db
    .prepare(
      'SELECT r.id, r.pricePerUnit, r.baseRate, r.unit, p.name AS productName, v.name AS vendorName ' +
        'FROM VendorRate r LEFT JOIN ProductItem p ON p.id = r.productId LEFT JOIN Vendor v ON v.id = r.vendorId ' +
        'WHERE r.batchId = ? ORDER BY p.name, v.name LIMIT ?',
    )
    .bind(String(id), Math.min(500, Math.max(1, Math.floor(limit))))
    .all();
  return rowsOf(res).map((r: any) => ({
    id: String(r.id),
    productName: r.productName != null ? String(r.productName) : null,
    vendorName: r.vendorName != null ? String(r.vendorName) : null,
    pricePerUnit: r.pricePerUnit != null ? Number(r.pricePerUnit) : null,
    baseRate: r.baseRate != null ? Number(r.baseRate) : null,
    unit: String(r.unit ?? ''),
  }));
}

/**
 * Undo a paste: delete every quote it created (and their spec-index rows) but
 * KEEP the batch row with status 'deleted' — the trace is the point.
 */
export async function deleteBatch(id: string): Promise<{ deleted: number; batchId: string }> {
  const db = getD1Database();
  const bid = String(id);
  const res = await db.prepare('SELECT id FROM VendorRate WHERE batchId = ?').bind(bid).all();
  const ids = rowsOf(res).map((r: any) => String(r.id));
  for (const rateId of ids) {
    await clearSpecIndex(rateId).catch(() => {});
    await (prisma as any).$executeRawUnsafe('DELETE FROM VendorRate WHERE id = ?', rateId);
  }
  await (prisma as any).$executeRawUnsafe(
    'UPDATE RateBatch SET status = ?, createdCount = 0, updatedAt = ? WHERE id = ?',
    'deleted',
    new Date().toISOString(),
    bid,
  );
  if (ids.length) await touched();
  return { deleted: ids.length, batchId: bid };
}
