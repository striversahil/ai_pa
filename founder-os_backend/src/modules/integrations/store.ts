// store.ts — Integrations persistence (raw D1, Worker-safe).
// Tables: IntegrationConnector / IntegrationSource / IntegrationEvent /
// IntegrationDelivery (migration 0180). No Prisma model and no shim accessor:
// the pipeline reads/writes these rows through explicit SQL only (same
// choice as the product-line batch + debtors import stores).

import { pagedQuery, likePattern, type Paged, type PageRequest } from '../../shared/paging';
import type { ConnectorRow, DeliveryRow, EventRow, SourceRow } from './types';

type Db = D1Database;

export function nowIso(): string {
  return new Date().toISOString();
}

const SOURCE_PATCH = ['name', 'status', 'config', 'mapping', 'lastError'];
const CONNECTOR_PATCH = ['name', 'icon', 'color', 'category', 'mapping', 'sample', 'status'];

async function patchRow(db: Db, table: string, id: string, patch: Record<string, unknown>, allowed: string[]): Promise<void> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const col of allowed) {
    if (!(col in patch)) continue;
    sets.push(`"${col}" = ?`);
    binds.push(patch[col] == null ? '' : patch[col]);
  }
  if (!sets.length) return;
  sets.push('"updatedAt" = ?');
  binds.push(nowIso(), id);
  await db.prepare(`UPDATE "${table}" SET ${sets.join(', ')} WHERE "id" = ?`).bind(...binds).run();
}

// ── Connectors (service types authored in the panel) ───────────────────────

export async function listConnectors(db: Db): Promise<ConnectorRow[]> {
  const res: any = await db.prepare('SELECT * FROM IntegrationConnector ORDER BY "createdAt" DESC').all();
  return (res?.results ?? []) as ConnectorRow[];
}

export async function getConnector(db: Db, idOrKey: string): Promise<ConnectorRow | null> {
  const row: any = await db.prepare('SELECT * FROM IntegrationConnector WHERE "id" = ? OR "key" = ? LIMIT 1').bind(idOrKey, idOrKey).first();
  return (row ?? null) as ConnectorRow | null;
}

export async function insertConnector(db: Db, row: ConnectorRow): Promise<void> {
  await db.prepare(
    'INSERT INTO IntegrationConnector ("id","key","name","icon","color","category","authKind","mapping","sample","status","createdBy","createdByName","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).bind(row.id, row.key, row.name, row.icon, row.color, row.category, row.authKind, row.mapping, row.sample, row.status, row.createdBy, row.createdByName, row.createdAt, row.updatedAt).run();
}

export async function patchConnector(db: Db, id: string, patch: Record<string, unknown>): Promise<void> {
  await patchRow(db, 'IntegrationConnector', id, patch, CONNECTOR_PATCH);
}

export async function deleteConnector(db: Db, id: string): Promise<void> {
  await db.prepare('DELETE FROM IntegrationConnector WHERE "id" = ?').bind(id).run();
}

export async function connectorUsage(db: Db, connectorKey: string): Promise<number> {
  const row: any = await db.prepare('SELECT COUNT(*) AS n FROM IntegrationSource WHERE "connectorKey" = ?').bind(connectorKey).first();
  return Number(row?.n ?? 0);
}

// ── Sources (live connections) ─────────────────────────────────────────────

export async function listSources(db: Db): Promise<SourceRow[]> {
  const res: any = await db.prepare('SELECT * FROM IntegrationSource ORDER BY "createdAt" DESC').all();
  return (res?.results ?? []) as SourceRow[];
}

export async function getSource(db: Db, id: string): Promise<SourceRow | null> {
  const row: any = await db.prepare('SELECT * FROM IntegrationSource WHERE "id" = ? LIMIT 1').bind(id).first();
  return (row ?? null) as SourceRow | null;
}

export async function insertSource(db: Db, row: SourceRow): Promise<void> {
  await db.prepare(
    'INSERT INTO IntegrationSource ("id","connectorKey","name","status","tokenHash","config","mapping","eventCount","lastEventAt","lastError","createdBy","createdByName","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).bind(row.id, row.connectorKey, row.name, row.status, row.tokenHash, row.config, row.mapping, row.eventCount, row.lastEventAt, row.lastError, row.createdBy, row.createdByName, row.createdAt, row.updatedAt).run();
}

export async function patchSource(db: Db, id: string, patch: Record<string, unknown>): Promise<void> {
  await patchRow(db, 'IntegrationSource', id, patch, SOURCE_PATCH);
}

export async function setSourceToken(db: Db, id: string, tokenHash: string): Promise<void> {
  await db.prepare('UPDATE IntegrationSource SET "tokenHash" = ?, "updatedAt" = ? WHERE "id" = ?').bind(tokenHash, nowIso(), id).run();
}

export async function bumpSourceStats(db: Db, id: string, occurredAt: string): Promise<void> {
  await db.prepare('UPDATE IntegrationSource SET "eventCount" = "eventCount" + 1, "lastEventAt" = ?, "updatedAt" = ? WHERE "id" = ?').bind(occurredAt, nowIso(), id).run();
}

export async function deleteSource(db: Db, id: string, purgeEvents: boolean): Promise<void> {
  const stmts: any[] = [db.prepare('DELETE FROM IntegrationDelivery WHERE "sourceId" = ?').bind(id)];
  stmts.push(db.prepare(purgeEvents ? 'DELETE FROM IntegrationEvent WHERE "sourceId" = ?' : 'UPDATE IntegrationEvent SET "sourceId" = \'\' WHERE "sourceId" = ?').bind(id));
  stmts.push(db.prepare('DELETE FROM IntegrationSource WHERE "id" = ?').bind(id));
  await db.batch(stmts);
}

// ── Events (the normalized activity feed) ──────────────────────────────────

export interface EventFilters { q?: string; sourceId?: string; kind?: string; from?: string; to?: string }

export async function insertEvent(db: Db, row: EventRow): Promise<boolean> {
  const res: any = await db.prepare(
    'INSERT OR IGNORE INTO IntegrationEvent ("id","sourceId","connectorKey","externalId","kind","occurredAt","title","summary","company","contactName","phone","email","city","amount","payload","raw","linkedType","linkedId","status","error","createdAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).bind(row.id, row.sourceId, row.connectorKey, row.externalId, row.kind, row.occurredAt, row.title, row.summary, row.company, row.contactName, row.phone, row.email, row.city, row.amount, row.payload, row.raw, row.linkedType, row.linkedId, row.status, row.error, row.createdAt).run();
  return Number(res?.meta?.changes ?? 0) > 0;
}

export async function listEvents(db: Db, req: PageRequest, f: EventFilters): Promise<Paged<EventRow>> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (f.sourceId) { where.push('"sourceId" = ?'); binds.push(f.sourceId); }
  if (f.kind) { where.push('"kind" = ?'); binds.push(f.kind); }
  if (f.from) { where.push('"occurredAt" >= ?'); binds.push(f.from); }
  if (f.to) { where.push('"occurredAt" <= ?'); binds.push(f.to); }
  const q = (f.q ?? '').trim();
  if (q) {
    const like = likePattern(q);
    where.push('("title" LIKE ? OR "company" LIKE ? OR "contactName" LIKE ? OR "phone" LIKE ? OR "email" LIKE ? OR "summary" LIKE ?)');
    for (let i = 0; i < 6; i++) binds.push(like);
  }
  return pagedQuery<EventRow>(db, {
    select: '*', from: 'IntegrationEvent', where, binds, orderBy: '"occurredAt" DESC, "id" DESC',
  }, req);
}

export async function getEvent(db: Db, id: string): Promise<EventRow | null> {
  const row: any = await db.prepare('SELECT * FROM IntegrationEvent WHERE "id" = ? LIMIT 1').bind(id).first();
  return (row ?? null) as EventRow | null;
}

export async function updateEvent(db: Db, id: string, patch: Record<string, unknown>): Promise<EventRow | null> {
  const cols = ['externalId', 'kind', 'occurredAt', 'title', 'summary', 'company', 'contactName', 'phone', 'email', 'city', 'amount', 'payload', 'linkedType', 'linkedId', 'status', 'error'];
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const col of cols) {
    if (!(col in patch)) continue;
    sets.push(`"${col}" = ?`);
    binds.push(patch[col] == null ? null : patch[col]);
  }
  if (!sets.length) return getEvent(db, id);
  binds.push(id);
  await db.prepare(`UPDATE IntegrationEvent SET ${sets.join(', ')} WHERE "id" = ?`).bind(...binds).run();
  return getEvent(db, id);
}
// ── Deliveries (raw audit + replay) ────────────────────────────────────────

export async function insertDelivery(db: Db, row: DeliveryRow): Promise<void> {
  await db.prepare(
    'INSERT INTO IntegrationDelivery ("id","sourceId","receivedAt","status","httpStatus","error","bodyPreview","bytes","eventId") VALUES (?,?,?,?,?,?,?,?,?)',
  ).bind(row.id, row.sourceId, row.receivedAt, row.status, row.httpStatus, row.error, row.bodyPreview, row.bytes, row.eventId).run();
}

export async function patchDelivery(db: Db, id: string, patch: { status?: string; httpStatus?: number; error?: string; eventId?: string }): Promise<void> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const k of ['status', 'httpStatus', 'error', 'eventId'] as const) {
    if (!(k in patch)) continue;
    sets.push(`"${k}" = ?`);
    binds.push((patch as any)[k] ?? '');
  }
  if (!sets.length) return;
  binds.push(id);
  await db.prepare(`UPDATE IntegrationDelivery SET ${sets.join(', ')} WHERE "id" = ?`).bind(...binds).run();
}

export async function listDeliveries(db: Db, req: PageRequest, sourceId: string | null): Promise<Paged<DeliveryRow>> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (sourceId) { where.push('"sourceId" = ?'); binds.push(sourceId); }
  return pagedQuery<DeliveryRow>(db, {
    select: '*', from: 'IntegrationDelivery', where, binds, orderBy: '"receivedAt" DESC, "id" DESC',
  }, req);
}

export async function getDelivery(db: Db, id: string): Promise<DeliveryRow | null> {
  const row: any = await db.prepare('SELECT * FROM IntegrationDelivery WHERE "id" = ? LIMIT 1').bind(id).first();
  return (row ?? null) as DeliveryRow | null;
}