// modules/core/sales.ts — Estimate/Enquiry → core_sale/core_enquiry dual-write (Phase 3c).
// Rules (founder 2026-11-12): headers only (no line items); attribution carried
// as facts (region, createdBy, converter = closer-winner else generator else
// creator, closeDay/closeValue) — never recomputed; master link = UNIQUE exact
// name match or '' (never guessed); enquiries linked only (estNumber hits an
// estimate; unlinked rows stay out of core).
// This module NEVER throws: mirror failures are logged and swallowed so live
// sales behavior can never break. Dual-runtime safe: no-ops wherever D1 is
// unavailable (Express has no core tables).
import { prisma } from '../../shared/prisma';
import { getD1Database } from '../../shared/prisma-d1';
import { logger } from '../../shared/logger';

const SALE_COLS = [
  'id', 'estimateNumber', 'customerName', 'masterCustomerId', 'organizationId',
  'total', 'date', 'status', 'region', 'createdBy', 'converterId',
  'closeDay', 'closeValue', 'acceptedAt', 'declinedAt',
];
const ENQ_COLS = [
  'id', 'estNumber', 'estimateId', 'status', 'source', 'assignedAgentId',
  'clientCompany', 'contactName', 'contactPhone', 'rateStatus',
];

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

async function writeAudit(entityId: string, operation: string, changes: Record<string, unknown>, reason: string): Promise<void> {
  try {
    const p: any = prisma as any;
    if (!p || typeof p.coreAuditEvent?.create !== 'function') return;
    await p.coreAuditEvent.create({
      data: {
        id: newId(), actorType: 'SYSTEM', actorId: null, source: 'core-sales-mirror',
        entityType: operation === 'enquiry-mirror' ? 'core_enquiry' : 'core_sale',
        entityId, operation: 'create', changes: JSON.stringify(changes), reason,
      },
    });
  } catch { /* audit best-effort */ }
}

/** Unique exact name match → master id, else '' (ambiguous/unmatched never guessed). */
async function resolveMasterId(db: any, customerName: string): Promise<string> {
  const name = String(customerName ?? '').trim();
  if (!name) return '';
  try {
    const res = await db.prepare(
      `SELECT "id" FROM "MasterCustomer" WHERE "displayName" = ? OR "companyName" = ? LIMIT 2`,
    ).bind(name, name).all();
    const rows: any[] = (res as any)?.results ?? [];
    return rows.length === 1 ? String(rows[0].id ?? '') : '';
  } catch { return ''; }
}

/** Closer-kind winner, else generator-kind, else '' (caller falls back to createdBy). */
async function resolveConverter(db: any, estimateId: string): Promise<string> {
  try {
    for (const kind of ['closer', 'generator']) {
      const res = await db.prepare(
        `SELECT "telecallerId" FROM "TelecallerScoreEvent" WHERE "estimateId" = ? AND "kind" = ? ORDER BY "day" DESC LIMIT 1`,
      ).bind(estimateId, kind).all();
      const row: any = ((res as any)?.results ?? [])[0];
      if (row?.telecallerId) return String(row.telecallerId);
    }
  } catch { /* fall through */ }
  return '';
}

interface SaleRow { [k: string]: any }

async function buildSaleRow(db: any, estimateId: string): Promise<SaleRow | null> {
  const res = await db.prepare(`SELECT * FROM "Estimate" WHERE "estimateId" = ?`).bind(estimateId).all().catch(() => null);
  const e: any = ((res as any)?.results ?? [])[0];
  if (!e) return null;
  const createdBy = e.createdBy ? String(e.createdBy) : null;
  const converter = await resolveConverter(db, estimateId);
  return {
    id: estimateId,
    estimateNumber: String(e.estimateNumber ?? ''),
    customerName: String(e.customerName ?? ''),
    masterCustomerId: await resolveMasterId(db, e.customerName),
    organizationId: String(e.organizationId ?? ''),
    total: Number(e.total ?? 0) || 0,
    date: String(e.date ?? ''),
    status: String(e.status ?? ''),
    region: String(e.region ?? ''),
    createdBy,
    converterId: converter || createdBy || '',
    closeDay: e.acceptedAt ? String(e.acceptedAt) : null,
    closeValue: Number(e.total ?? 0) || 0,
    acceptedAt: e.acceptedAt ? String(e.acceptedAt) : null,
    declinedAt: e.declinedAt ? String(e.declinedAt) : null,
  };
}

async function upsertSaleRow(db: any, row: SaleRow): Promise<void> {
  const cols = [...SALE_COLS, 'createdAt', 'updatedAt'];
  const q = (c: string) => `"${c}"`;
  const params = SALE_COLS.map((c) => (row as any)[c] ?? null);
  await db.prepare(
    `INSERT OR IGNORE INTO "core_sale" (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(',')})`,
  ).bind(...params, nowIso(), nowIso()).run();
  const set = SALE_COLS.filter((c) => c !== 'id').map((c) => `"${c}" = ?`).join(', ');
  await db.prepare(`UPDATE "core_sale" SET ${set}, "updatedAt" = ? WHERE "id" = ?`)
    .bind(...SALE_COLS.filter((c) => c !== 'id').map((c) => (row as any)[c] ?? null), nowIso(), row.id).run();
}

/**
 * Mirror estimate headers into core_sale. Covers creates, metadata edits,
 * status transitions and region moves — every writer funnels here. Unlike the
 * backfill, closes are NOT skipped: a row that closes after 3c ships keeps its
 * close facts live in core.
 */
export async function mirrorSales(estimateIds: string[]): Promise<void> {
  try {
    const db = getD1Database();
    const ids = [...new Set((estimateIds ?? []).map((s) => String(s ?? '')).filter(Boolean))];
    if (!db || !ids.length) return;
    for (const id of ids) {
      try {
        const row = await buildSaleRow(db, id);
        if (!row) continue;
        await upsertSaleRow(db, row);
        await db.prepare(
          `INSERT OR IGNORE INTO "core_zoho_link" ("id", "system", "namespace", "externalId", "entityType", "entityId", "metadata") VALUES (?, 'zoho', '', ?, 'sale', ?, ?)`,
        ).bind(`zoho-sale-${id}`, id, id,
          JSON.stringify({ estimateNumber: row.estimateNumber, customerName: row.customerName, status: row.status })).run().catch(() => null);
      } catch { /* per-row best-effort */ }
    }
    await writeAudit(ids[0], 'sale-mirror', { ids: ids.length }, 'sales-dual-write: projected estimate headers + zoho links');
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorSales failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

/** Resolve the estimateId for an enquiry (estNumber + org preference on clashes). */
async function resolveEstimateId(db: any, estNumber: string, organizationId: string): Promise<string> {
  const num = String(estNumber ?? '').trim();
  if (!num) return '';
  try {
    const res = await db.prepare(`SELECT "estimateId", "organizationId" FROM "Estimate" WHERE "estimateNumber" = ? LIMIT 5`)
      .bind(num).all();
    const rows: any[] = (res as any)?.results ?? [];
    if (!rows.length) return '';
    const org = String(organizationId ?? '');
    const same = rows.find((r) => String(r.organizationId ?? '') === org);
    const untagged = rows.find((r) => !String(r.organizationId ?? ''));
    return String((same ?? untagged ?? rows[0]).estimateId ?? '');
  } catch { return ''; }
}

async function upsertEnquiryRow(db: any, q: any): Promise<boolean> {
  const estimateId = await resolveEstimateId(db, q.estNumber, q.organizationId);
  if (!estimateId) return false; // unlinked rows stay out of core
  const params = [q.id, String(q.estNumber ?? ''), estimateId, String(q.status ?? 'new'),
    String(q.source ?? 'TL'), String(q.assignedAgentId ?? ''), String(q.clientCompany ?? ''),
    String(q.contactName ?? ''), String(q.contactPhone ?? ''), String(q.rateStatus ?? '')];
  await db.prepare(
    `INSERT OR IGNORE INTO "core_enquiry" (${ENQ_COLS.map((c) => `"${c}"`).join(', ')}, "createdAt", "updatedAt") VALUES (${ENQ_COLS.map(() => '?').join(',')}, ?, ?)`,
  ).bind(...params, nowIso(), nowIso()).run();
  const set = ENQ_COLS.filter((c) => c !== 'id').map((c) => `"${c}" = ?`).join(', ');
  await db.prepare(`UPDATE "core_enquiry" SET ${set}, "updatedAt" = ? WHERE "id" = ?`)
    .bind(...params.slice(1), nowIso(), q.id).run();
  return true;
}

/** Mirror enquiry headers (create/edit/auto-sent). Unlinked rows are skipped. */
export async function mirrorEnquiries(enquiryIds: string[]): Promise<void> {
  try {
    const db = getD1Database();
    const ids = [...new Set((enquiryIds ?? []).map((s) => String(s ?? '')).filter(Boolean))];
    if (!db || !ids.length) return;
    let mirrored = 0;
    for (let i = 0; i < ids.length; i += 50) {
      const slice = ids.slice(i, i + 50);
      const res = await db.prepare(`SELECT * FROM "Enquiry" WHERE "id" IN (${slice.map(() => '?').join(',')})`)
        .bind(...slice).all().catch(() => null);
      for (const q of ((res as any)?.results ?? []) as any[]) {
        try {
          if (await upsertEnquiryRow(db, q)) mirrored++;
        } catch { /* per-row best-effort */ }
      }
    }
    if (mirrored) await writeAudit(ids[0], 'enquiry-mirror', { ids: ids.length, mirrored }, 'sales-dual-write: projected linked enquiry headers');
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorEnquiries failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

/** After a status transition, mirror the linked enquiries (auto-sent path). */
export async function mirrorEnquiriesForSales(estimateIds: string[]): Promise<void> {
  try {
    const db = getD1Database();
    const ids = [...new Set((estimateIds ?? []).map((s) => String(s ?? '')).filter(Boolean))];
    if (!db || !ids.length) return;
    const nums = new Set<string>();
    for (let i = 0; i < ids.length; i += 50) {
      const slice = ids.slice(i, i + 50);
      const res = await db.prepare(`SELECT "estimateNumber" FROM "Estimate" WHERE "estimateId" IN (${slice.map(() => '?').join(',')})`)
        .bind(...slice).all().catch(() => null);
      for (const r of ((res as any)?.results ?? []) as any[]) {
        const n = String(r?.estimateNumber ?? '').trim();
        if (n) nums.add(n);
      }
    }
    if (!nums.size) return;
    const arr = [...nums];
    const qids: string[] = [];
    for (let i = 0; i < arr.length; i += 50) {
      const slice = arr.slice(i, i + 50);
      const res = await db.prepare(`SELECT "id" FROM "Enquiry" WHERE "estNumber" IN (${slice.map(() => '?').join(',')})`)
        .bind(...slice).all().catch(() => null);
      for (const r of ((res as any)?.results ?? []) as any[]) qids.push(String(r.id));
    }
    if (qids.length) await mirrorEnquiries(qids);
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorEnquiriesForSales failed (non-blocking)');
    } catch { /* never throw */ }
  }
}
