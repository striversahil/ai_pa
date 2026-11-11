// modules/core/customers.ts — MasterCustomer → core_customer dual-write (Phase 3a).
// Rules (founder 2026-11-11/12): 1:1 mirror (duplicate groups carried, merge
// stays human review); hard-delete → DELETED tombstone, never row-deleted;
// Zoho links mirrored into core_zoho_link (system='zoho').
// This module NEVER throws: mirror failures are logged and swallowed so the
// live master-data behavior can never break. Dual-runtime safe: no-ops
// wherever D1 is unavailable (Express has no core tables).
import { prisma } from '../../shared/prisma';
import { getD1Database } from '../../shared/prisma-d1';
import { logger } from '../../shared/logger';

const MIRROR_COLUMNS = [
  'id', 'zohoCustomerId', 'region', 'zone', 'subArea', 'state', 'pincode',
  'displayName', 'companyName', 'customerType', 'customerTypeBase', 'customerTypeTag',
  'status', 'contactPerson', 'designation', 'phonesJson', 'emailsJson',
  'billingAddress', 'gstin', 'owner', 'pipelineStage', 'estimateCount',
  'lastEstimateDate', 'salesOrderCount', 'lastSalesOrderDate', 'cityZoho',
  'cityVerified', 'citySource', 'locationBasis', 'duplicateGroup',
  'duplicateConfidence', 'suggestedAction', 'duplicateReview', 'reviewedBy',
  'reviewedAt', 'notes', 'createdAt', 'updatedAt',
];

const QUOTED = MIRROR_COLUMNS.map((c) => `"${c}"`).join(', ');
const PLACEHOLDERS = MIRROR_COLUMNS.map(() => '?').join(',');
// D1 rejects INSERT…SELECT…ON CONFLICT, so every mirror is INSERT OR IGNORE
// (new rows) + UPDATE…FROM (refresh existing rows) on the same scope.
const REFRESH_SET = MIRROR_COLUMNS.filter((c) => c !== 'id')
  .map((c) => `"c"."${c}" = "s"."${c}"`).join(', ');
const SOURCE_COLS = MIRROR_COLUMNS.map((c) => `"s"."${c}"`).join(', ');

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
        id: newId(), actorType: 'SYSTEM', actorId: null, source: 'core-customer-mirror',
        entityType: 'core_customer', entityId: operation, operation: 'create',
        changes: JSON.stringify(changes), reason,
      },
    });
    void entityId;
  } catch { /* audit best-effort */ }
}

/**
 * Mirror MasterCustomer rows into core_customer (chunked INSERT…SELECT upsert)
 * and ensure their core_zoho_link rows. `where` scopes the projection:
 * by ids (single edit / import batch) or by duplicate group (review change).
 */
export async function mirrorCustomers(where: { ids?: string[]; group?: string }): Promise<void> {
  try {
    const db = getD1Database();
    if (!db) return;
    const chunks: Array<{ sql: string; params: any[] }> = [];
    if (where.group) {
      chunks.push({ sql: `WHERE "duplicateGroup" = ?`, params: [where.group] });
    } else if (where.ids && where.ids.length) {
      for (let i = 0; i < where.ids.length; i += 100) {
        const slice = where.ids.slice(i, i + 100);
        chunks.push({
          sql: `WHERE "id" IN (${slice.map(() => '?').join(',')})`,
          params: slice,
        });
      }
    } else return;
    let mirrored = 0;
    for (const ch of chunks) {
      const ins = await db.prepare(
        `INSERT OR IGNORE INTO "core_customer" (${QUOTED}) SELECT ${QUOTED} FROM "MasterCustomer" ${ch.sql}`,
      ).bind(...ch.params).run();
      mirrored += Number((ins as any)?.meta?.changes ?? 0) || 0;
      const upd = await db.prepare(
        `UPDATE "core_customer" AS "c" SET ${REFRESH_SET} FROM ` +
        `(SELECT ${QUOTED} FROM "MasterCustomer" ${ch.sql}) AS "s" WHERE "c"."id" = "s"."id"`,
      ).bind(...ch.params, ...ch.params).run();
      mirrored += Number((upd as any)?.meta?.changes ?? 0) || 0;
      await db.prepare(
        `INSERT OR IGNORE INTO "core_zoho_link" ("id", "system", "namespace", "externalId", "entityType", "entityId", "metadata") ` +
        `SELECT 'zoho-customer-' || "zohoCustomerId", 'zoho', '', "zohoCustomerId", 'customer', "id", ` +
        `json_object('displayName', "displayName", 'region', "region") FROM "MasterCustomer" ${ch.sql} ` +
        `AND "zohoCustomerId" IS NOT NULL AND "zohoCustomerId" <> ''`,
      ).bind(...ch.params).run().catch(() => null);
    }
    await writeAudit(where.group ?? `${where.ids?.length ?? 0}-rows`, 'customer-mirror',
      { scope: where.group ? { group: where.group } : { ids: where.ids?.length ?? 0 }, mirrored },
      'customer-dual-write: projected MasterCustomer rows + zoho links');
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorCustomers failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

/** Hard-delete path: core rows are never deleted — DELETED tombstone + audit. */
export async function mirrorCustomerRemoved(masterId: string, name: string): Promise<void> {
  try {
    const db = getD1Database();
    if (!db) return;
    await db.prepare(`UPDATE "core_customer" SET "status" = 'DELETED', "updatedAt" = ? WHERE "id" = ?`)
      .bind(new Date().toISOString(), masterId).run();
    await writeAudit(masterId, 'customer-tombstone', { name },
      'customer-dual-write: MasterCustomer hard-delete → DELETED tombstone (never row-deleted)');
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorCustomerRemoved failed (non-blocking)');
    } catch { /* never throw */ }
  }
}
