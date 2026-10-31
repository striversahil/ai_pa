// store.ts — persistence for the Reporting Sheet (D1, raw SQL).
//
// Worker-only module (new surface; Express is frozen). Reads are small (a few
// dozen rows per period), so no keyset paging is needed — unlike the customer
// master, the payload stays tiny and cacheable per period.
import { getD1Database } from '../../shared/prisma-d1';
import type { ReportDepartment, ReportOrigin, ReportSection, TelecallerRow, RegionOrderRow } from './types';

export function reportDb(): any {
  return getD1Database();
}

export interface ReportEntryRow {
  department: string;
  section: string;
  payloadJson: string;
  telecallerRowsJson: string;
  regionOrdersJson: string;
  origin: string;
  submittedBy: string;
  submittedByName: string;
  updatedAt: string;
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function listPeriodEntries(period: string): Promise<ReportEntryRow[]> {
  const db = reportDb();
  if (!db) return [];
  const res = await db
    .prepare(
      `SELECT department, section, payloadJson, telecallerRowsJson, regionOrdersJson,
              origin, submittedBy, submittedByName, updatedAt
         FROM ReportEntry WHERE period = ? AND granularity = 'week'`,
    )
    .bind(period)
    .all();
  return ((res?.results ?? []) as any[]).map((r) => ({
    department: String(r.department ?? ''),
    section: String(r.section ?? ''),
    payloadJson: String(r.payloadJson ?? '{}'),
    telecallerRowsJson: String(r.telecallerRowsJson ?? '[]'),
    regionOrdersJson: String(r.regionOrdersJson ?? '[]'),
    origin: String(r.origin ?? 'manual'),
    submittedBy: String(r.submittedBy ?? ''),
    submittedByName: String(r.submittedByName ?? ''),
    updatedAt: String(r.updatedAt ?? ''),
  }));
}

/** Periods that have at least one entry — drives the picker's "has data" dot. */
export async function listFilledPeriods(limit = 12): Promise<string[]> {
  const db = reportDb();
  if (!db) return [];
  const res = await db
    .prepare(`SELECT DISTINCT period FROM ReportEntry WHERE granularity = 'week' ORDER BY period DESC LIMIT ?`)
    .bind(limit)
    .all();
  return ((res?.results ?? []) as any[]).map((r) => String(r.period));
}

function safeJsonParseArray(raw: string): any[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function cleanTelecallerRows(raw: string): TelecallerRow[] {
  return safeJsonParseArray(raw)
    .map((r: any) => ({
      name: String(r?.name ?? '').slice(0, 80),
      connected: Math.max(0, Math.floor(Number(r?.connected) || 0)),
      leads: Math.max(0, Math.floor(Number(r?.leads) || 0)),
    }))
    .filter((r) => r.name)
    .slice(0, 60);
}

export function cleanRegionOrders(raw: string): RegionOrderRow[] {
  return safeJsonParseArray(raw)
    .map((r: any) => ({
      region: String(r?.region ?? '').slice(0, 8).toUpperCase(),
      orders: Math.max(0, Math.floor(Number(r?.orders) || 0)),
      value: Math.max(0, Math.floor(Number(r?.value) || 0)),
    }))
    .filter((r) => r.region)
    .slice(0, 12);
}

export async function upsertEntry(args: {
  period: string;
  department: ReportDepartment;
  section: ReportSection;
  payloadJson: string;
  telecallerRows: TelecallerRow[];
  regionOrders: RegionOrderRow[];
  origin: ReportOrigin;
  actorId: string;
  actorName: string;
}): Promise<void> {
  const db = reportDb();
  if (!db) throw new Error('database not ready');
  const iso = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO ReportEntry (
         id, period, granularity, department, section, payloadJson,
         telecallerRowsJson, regionOrdersJson, origin,
         submittedBy, submittedByName, createdAt, updatedAt
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(period, granularity, department, section) DO UPDATE SET
         payloadJson = excluded.payloadJson,
         telecallerRowsJson = excluded.telecallerRowsJson,
         regionOrdersJson = excluded.regionOrdersJson,
         origin = excluded.origin,
         submittedBy = excluded.submittedBy,
         submittedByName = excluded.submittedByName,
         updatedAt = excluded.updatedAt`,
    )
    .bind(
      newId(), args.period, 'week', args.department, args.section, args.payloadJson,
      JSON.stringify(args.telecallerRows), JSON.stringify(args.regionOrders), args.origin,
      args.actorId, args.actorName, iso, iso,
    )
    .run();
}

export async function insertReportAudit(entry: {
  actorId: string;
  actorName: string;
  action: string;
  entityId: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const db = reportDb();
  if (!db) return;
  await db
    .prepare(
      `INSERT INTO ReportAudit (id, actorId, actorName, action, entityId, detail, createdAt)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(
      newId(), entry.actorId, entry.actorName, entry.action, entry.entityId,
      JSON.stringify(entry.detail ?? {}), new Date().toISOString(),
    )
    .run();
}
