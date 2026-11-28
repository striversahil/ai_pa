// store.ts — hlp_ingested_data persistence. D1 raw SQL: one staging table,
// one queue index, one partial unique index (provider retries dedupe).

import { parsePageQuery, pagedQuery, searchClause, type PageRequest } from '../../shared/paging';
import { listProviderManifests } from '../integrations/gateway/manifest';
import type { IngestInsert, IngestRow, SqlDb } from './types';

const SELECT_ALL = 'SELECT * FROM hlp_ingested_data';
const MAX_ATTEMPTS = 3;
const STALE_PROCESSING_MS = 15 * 60 * 1000;

function rows<T>(result: { results?: T[] } | T[] | null): T[] {
  if (!result) return [];
  return Array.isArray(result) ? result : (result.results ?? []);
}

export function newIngestId(): string {
  return 'ing_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

export interface InsertResult {
  id: string;
  inserted: boolean;
}

export async function insertIngested(db: SqlDb, row: IngestInsert): Promise<InsertResult> {
  const id = newIngestId();
  const at = new Date().toISOString();
  const res: any = await db
    .prepare(
      'INSERT OR IGNORE INTO hlp_ingested_data ' +
        '("id","source","instanceKey","eventType","externalEventId","deliveryMode","status","rawPayload","headersJson","receivedAt") ' +
        'VALUES (?,?,?,?,?,?,\'pending\',?,?,?)',
    )
    .bind(id, row.source, row.instanceKey, row.eventType, row.externalEventId, row.deliveryMode, row.rawPayload, row.headersJson, at)
    .run();
  const changes = Number(res?.meta?.changes ?? 0);
  if (changes > 0) return { id, inserted: true };
  if (row.externalEventId) {
    const existing = await db
      .prepare(`${SELECT_ALL} WHERE "source" = ? AND "externalEventId" = ?`)
      .bind(row.source, row.externalEventId)
      .first<IngestRow>();
    if (existing) return { id: existing.id, inserted: false };
  }
  return { id, inserted: false };
}

export async function getRow(db: SqlDb, id: string): Promise<IngestRow | null> {
  return (await db.prepare(`${SELECT_ALL} WHERE "id" = ?`).bind(id).first()) as IngestRow | null;
}

/** Claim up to `limit` rows for the runner: pending, or processing for a
 *  worker that died mid-flight (15 min). */
/** Providers inside their declared quiet window (IST) are not claimed. */
export function quietSourcesNow(now = new Date()): string[] {
  const hourIst = new Date(now.getTime() + 5.5 * 3600_000).getUTCHours();
  return listProviderManifests()
    .filter((m) => {
      const window = m.inbound.quietHoursIst;
      if (!window) return false;
      const [start, end] = window;
      return start < end ? hourIst >= start && hourIst < end : hourIst >= start || hourIst < end;
    })
    .map((m) => m.provider);
}

export async function claimBatch(
  db: SqlDb,
  opts: { limit?: number; source?: string; mode?: string } = {},
): Promise<IngestRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const conds = ['(("status" = \'pending\') OR ("status" = \'processing\' AND "receivedAt" < ?))'];
  const binds: unknown[] = [staleBefore];
  const quiet = quietSourcesNow();
  for (const provider of quiet) {
    // Instance rows are staged as provider:key; quiet hours apply to both.
    conds.push('("source" != ? AND "source" NOT LIKE ?)');
    binds.push(provider, `${provider}:%`);
  }
  if (opts.source) { conds.push('"source" = ?'); binds.push(opts.source); }
  if (opts.mode) { conds.push('"deliveryMode" = ?'); binds.push(opts.mode); }
  const claimed = rows<IngestRow>(
    (await db
      .prepare(`${SELECT_ALL} WHERE ${conds.join(' AND ')} ORDER BY "receivedAt" ASC LIMIT ?`)
      .bind(...binds, limit)
      .all()) as never,
  );
  if (!claimed.length) return [];
  const placeholders = claimed.map(() => '?').join(',');
  await db
    .prepare(`UPDATE hlp_ingested_data SET "status" = 'processing', "retryCount" = "retryCount" + 1 WHERE "id" IN (${placeholders})`)
    .bind(...claimed.map((r) => r.id))
    .run();
  return claimed.map((r) => ({ ...r, status: 'processing', retryCount: Number(r.retryCount) + 1 }));
}

export async function markProcessed(
  db: SqlDb,
  id: string,
  normalizedJson: string,
  coreRefId: string,
): Promise<void> {
  await db
    .prepare(
      'UPDATE hlp_ingested_data SET "status" = \'processed\', "normalizedJson" = ?, "coreRefId" = ?, ' +
        '"errorLog" = \'\', "processedAt" = ? WHERE "id" = ?',
    )
    .bind(normalizedJson, coreRefId, new Date().toISOString(), id)
    .run();
}

export async function markFailed(db: SqlDb, id: string, error: string): Promise<string> {
  const row = await getRow(db, id);
  const attempts = Number(row?.retryCount ?? 1);
  const dead = attempts >= MAX_ATTEMPTS;
  const message = String(error ?? 'unknown error').slice(0, 2000);
  const log = [row?.errorLog, `${new Date().toISOString()} ${message}`].filter(Boolean).join('\n').slice(-8000);
  await db
    .prepare('UPDATE hlp_ingested_data SET "status" = ?, "errorLog" = ? WHERE "id" = ?')
    .bind(dead ? 'dead_letter' : 'pending', log, id)
    .run();
  return dead ? 'dead_letter' : 'pending';
}

export async function replayRow(db: SqlDb, id: string): Promise<boolean> {
  const res: any = await db
    .prepare('UPDATE hlp_ingested_data SET "status" = \'pending\', "errorLog" = \'\', "retryCount" = 0 WHERE "id" = ?')
    .bind(id)
    .run();
  return Number(res?.meta?.changes ?? 0) > 0;
}

export interface IngestedFilters {
  source?: string;
  status?: string;
  mode?: string;
}

export async function listIngested(
  db: any,
  query: PageRequest,
  filters: IngestedFilters,
) {
  const where: string[] = [];
  const binds: unknown[] = [];
  for (const [column, value] of [
    ['source', filters.source],
    ['status', filters.status],
    ['deliveryMode', filters.mode],
  ] as const) {
    if (value) { where.push(`"${column}" = ?`); binds.push(value); }
  }
  if (query.q) {
    const clause = searchClause(['source', '"externalEventId"', '"coreRefId"'], query.q);
    if (clause.sql) { where.push(clause.sql); binds.push(...clause.binds); }
  }
  return pagedQuery<IngestRow>(
    db,
    {
      select: 'id, source, "instanceKey", "eventType", "externalEventId", "deliveryMode", status, "coreRefId", "retryCount", "errorLog", "receivedAt", "processedAt"',
      from: 'hlp_ingested_data',
      where,
      binds,
      orderBy: '"receivedAt" DESC, "id" DESC',
    },
    query,
  );
}

export async function ingestStats(db: SqlDb) {
  const byStatus = rows<{ status: string; n: number }>(
    (await db.prepare('SELECT "status", COUNT(*) AS n FROM hlp_ingested_data GROUP BY "status"').all()) as never,
  );
  const bySource = rows<{ source: string; n: number; lastAt: string }>(
    (await db
      .prepare('SELECT "source", COUNT(*) AS n, MAX("receivedAt") AS lastAt FROM hlp_ingested_data GROUP BY "source"')
      .all()) as never,
  );
  const counts: Record<string, number> = { pending: 0, processing: 0, processed: 0, dead_letter: 0 };
  for (const row of byStatus) counts[row.status] = Number(row.n);
  return { counts, sources: bySource.map((s) => ({ ...s, n: Number(s.n) })) };
}

export { parsePageQuery };
