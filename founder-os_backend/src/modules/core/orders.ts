// modules/core/orders.ts — CrmSalesOrder/* → core order spine dual-write (Phase 4a).
// Rules (founder 2026-11-12): mirror + shadow first, flip later; open orders
// only (cancelled/void/source-deleted stay legacy — the sync never creates
// history rows for closed orders, neither do we). ids reused verbatim;
// masterCustomerId = UNIQUE exact match or '' (never guessed).
// Writes funnel through the CRM store (syncOrders + floor mutations); every
// hook calls mirrorOrders(ids) which re-projects header + lines + events +
// proofs + attachments for those orders (convergent regardless of what
// changed). Events/proofs/attachments are append-only: INSERT OR IGNORE only.
// This module NEVER throws. Dual-runtime safe (D1-null no-op off-Worker).
import { prisma } from '../../shared/prisma';
import { getD1Database } from '../../shared/prisma-d1';
import { logger } from '../../shared/logger';
import { shadowHeartbeat } from './notify';

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

async function resolveOrderMasterId(db: any, customerName: string): Promise<string> {
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

const ORDER_UPDATABLE = [
  'soNumber', 'zohoId', 'customerName', 'value', 'currency', 'orderStatus',
  'invoicedStatus', 'shippedStatus', 'paidStatus', 'status', 'salesperson',
  'referenceNumber', 'region', 'billingAddress', 'shippingAddress',
  'paymentTerms', 'createdDate', 'lifecycle', 'sourceState', 'fingerprint',
  'missCount', 'lastSeenAt', 'deletedDetectedAt',
  'localCancelledAt', 'localCancelledBy', 'localCancelReason',
];

const LINE_COLS = [
  'id', 'soId', 'lineKey', 'name', 'sku', 'description', 'qty', 'unit',
  'rate', 'itemTotal', 'dispatchState', 'tentativeDispatchDate', 'delayReason',
  'dispatchedQty', 'dispatchedAt', 'scheduledBy', 'scheduledAt',
  'amendedQty', 'removedAt', 'removedBy', 'isLocalAdded',
];
const LINE_UPDATABLE = LINE_COLS.filter((c) => c !== 'id' && c !== 'soId' && c !== 'createdAt');

/**
 * Re-project orders (header + lines + append-only children) into core.
 * Open orders only — cancelled/void/source-deleted rows are skipped (legacy
 * keeps them; a row that returns to open re-mirrors on the next write).
 */
export async function mirrorOrders(orderIds: string[]): Promise<void> {
  try {
    const db = getD1Database();
    const ids = [...new Set((orderIds ?? []).map((s) => String(s ?? '')).filter(Boolean))];
    if (!db || !ids.length) return;
    for (let i = 0; i < ids.length; i += 50) {
      const slice = ids.slice(i, i + 50);
      const q = `(${slice.map(() => '?').join(',')})`;
      // Headers: refresh live values (UPDATE…FROM), insert new rows.
      const rows: any[] = await db.prepare(`SELECT * FROM "CrmSalesOrder" WHERE "id" IN ${q}`)
        .bind(...slice).all().then((r: any) => r?.results ?? []).catch(() => []);
      for (const o of rows) {
        const st = String(o.status ?? '').toLowerCase();
        if (['cancelled', 'void'].includes(st) || String(o.sourceState ?? '') === 'deleted_source') continue;
        const masterId = await resolveOrderMasterId(db, o.customerName);
        await db.prepare(
          `INSERT OR IGNORE INTO "core_sales_order" ("id", "org") VALUES (?, ?)`,
        ).bind(String(o.id), String(o.org ?? '')).run();
        const set = [...ORDER_UPDATABLE.map((c) => `"${c}" = ?`), `"masterCustomerId" = ?`, `"updatedAt" = ?`].join(', ');
        const vals = ORDER_UPDATABLE.map((c) => (o as any)[c] ?? null);
        await db.prepare(`UPDATE "core_sales_order" SET ${set} WHERE "id" = ?`)
          .bind(...vals, masterId, nowIso(), String(o.id)).run();
        await db.prepare(
          `INSERT OR IGNORE INTO "core_zoho_link" ("id", "system", "namespace", "externalId", "entityType", "entityId", "metadata") VALUES (?, 'zoho', ?, ?, 'sales_order', ?, ?)`,
        ).bind(`zoho-order-${o.org}-${o.soNumber}`, String(o.org ?? ''), String(o.soNumber ?? ''),
          String(o.id), JSON.stringify({ customerName: o.customerName ?? '', lifecycle: o.lifecycle ?? '' })).run().catch(() => null);
      }
      // Lines: full refresh per order (scoped to mirrored orders only).
      const lines: any[] = await db.prepare(`SELECT "CrmSoItem".* FROM "CrmSoItem" WHERE "soId" IN ${q}`)
        .bind(...slice).all().then((r: any) => r?.results ?? []).catch(() => []);
      for (const l of lines) {
        const cols = [...LINE_COLS, 'createdAt', 'updatedAt'];
        await db.prepare(`INSERT OR IGNORE INTO "core_so_line" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(',')})`)
          .bind(...LINE_COLS.map((c) => (l as any)[c] ?? null), (l as any).createdAt ?? nowIso(), nowIso()).run();
        const set = [...LINE_UPDATABLE.map((c) => `"${c}" = ?`), `"updatedAt" = ?`].join(', ');
        await db.prepare(`UPDATE "core_so_line" SET ${set} WHERE "id" = ?`)
          .bind(...LINE_UPDATABLE.map((c) => (l as any)[c] ?? null), nowIso(), String(l.id)).run();
      }
      // Append-only children: insert new rows only.
      for (const [src, dst, cols] of [
        ['CrmScheduleEvent', 'core_stage_event', ['id', 'soId', 'soNumber', 'itemId', 'kind', 'fromDate', 'toDate', 'reason', 'actor', 'qty', 'day', 'createdAt']],
        ['CrmDispatchProof', 'core_dispatch_proof', ['id', 'soId', 'soNumber', 'invoiceId', 'beforeId', 'afterId', 'actor', 'day', 'createdAt']],
      ] as Array<[string, string, string[]]>) {
        const kids: any[] = await db.prepare(`SELECT * FROM "${src}" WHERE "soId" IN ${q}`)
          .bind(...slice).all().then((r: any) => r?.results ?? []).catch(() => []);
        for (const k of kids) {
          await db.prepare(`INSERT OR IGNORE INTO "${dst}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(',')})`)
            .bind(...cols.map((c) => (k as any)[c] ?? null)).run();
        }
      }
      const atts: any[] = await db.prepare(
        `SELECT "SoAttachment".* FROM "SoAttachment" WHERE "soNumber" IN (SELECT "soNumber" FROM "CrmSalesOrder" WHERE "id" IN ${q})`)
        .bind(...slice).all().then((r: any) => r?.results ?? []).catch(() => []);
      for (const a of atts) {
        await db.prepare(`INSERT OR IGNORE INTO "core_attachment" ("id", "soNumber", "kind", "fileName", "mime", "size", "storageKey", "uploadedBy", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(String(a.id), String(a.soNumber ?? ''), String(a.kind ?? 'other'), String(a.fileName ?? ''),
            String(a.mime ?? 'application/octet-stream'), Number(a.size) || 0, String(a.kvKey ?? ''),
            String(a.uploadedBy ?? ''), String(a.createdAt ?? nowIso())).run();
      }
    }
    try {
      const p: any = prisma as any;
      if (p && typeof p.coreAuditEvent?.create === 'function') {
        await p.coreAuditEvent.create({
          data: {
            id: newId(), actorType: 'SYSTEM', actorId: null, source: 'core-orders-mirror',
            entityType: 'core_sales_order', entityId: ids[0], operation: 'create',
            changes: JSON.stringify({ scope: { ids: ids.length } }),
            reason: 'orders-dual-write: projected order spine + children',
          },
        });
      }
    } catch { /* audit best-effort */ }
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorOrders failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

/** Sync-tick entry: resolve order ids from org|soNumber keys, then mirror. */
export async function mirrorOrdersByKeys(keys: string[]): Promise<void> {
  try {
    const db = getD1Database();
    const clean = [...new Set((keys ?? []).map((s) => String(s ?? '')).filter(Boolean))];
    if (!db || !clean.length) return;
    const ids: string[] = [];
    for (let i = 0; i < clean.length; i += 50) {
      const slice = clean.slice(i, i + 50);
      const rows: any[] = await db.prepare(
        `SELECT "id" FROM "CrmSalesOrder" WHERE ("org" || '|' || "soNumber") IN (${slice.map(() => '?').join(',')})`)
        .bind(...slice).all().then((r: any) => r?.results ?? []).catch(() => []);
      for (const r of rows) ids.push(String(r.id));
    }
    if (ids.length) await mirrorOrders(ids);
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorOrdersByKeys failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

// ── Phase 4a: floor shadow (floor-read-only, log-only) ───────────────────────
// Served values NEVER change — the floor keeps reading Crm* tables. Compares
// open-order headers (any field, ₹1 on value), per-lineKey line state, and
// stage-event counts. Log-only `floor-shadow` DIFF rows, sig-deduped.

let lastFloorShadowAt = 0;

function hashSig(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const FLOOR_HEAD_COLS = ['soNumber', 'customerName', 'orderStatus', 'invoicedStatus', 'shippedStatus', 'paidStatus', 'status', 'salesperson', 'referenceNumber', 'region', 'billingAddress', 'shippingAddress', 'createdDate', 'lifecycle', 'sourceState'] as const;
const FLOOR_LINE_COLS = ['lineKey', 'name', 'sku', 'qty', 'rate', 'itemTotal', 'dispatchState', 'tentativeDispatchDate', 'dispatchedQty', 'amendedQty', 'removedAt'] as const;

export async function shadowCompareFloor(): Promise<void> {
  try {
    const now = Date.now();
    if (now - lastFloorShadowAt < 5 * 60 * 1000) return;
    lastFloorShadowAt = now;
    const db = getD1Database();
    if (!db) return;
    const live: any[] = await db.prepare(
      `SELECT * FROM "CrmSalesOrder" WHERE lower("status") NOT IN ('cancelled', 'void') AND "sourceState" <> 'deleted_source' LIMIT 2000`,
    ).all().then((r: any) => r?.results ?? []).catch(() => []);
    const core: any[] = await db.prepare(`SELECT * FROM "core_sales_order" LIMIT 2000`)
      .all().then((r: any) => r?.results ?? []).catch(() => []);
    const coreById = new Map(core.map((c) => [String(c.id), c]));
    const missing: string[] = [];
    const extra: string[] = [];
    const changed: Array<{ id: string; fields: string[] }> = [];
    for (const o of live) {
      const id = String(o.id);
      const c = coreById.get(id);
      if (!c) { missing.push(id); continue; }
      const fields: string[] = [];
      for (const col of FLOOR_HEAD_COLS) {
        if (String((o as any)[col] ?? '') !== String((c as any)[col] ?? '')) fields.push(col);
      }
      if (Math.abs((Number(o.value) || 0) - (Number((c as any).value) || 0)) > 1) fields.push('value');
      const freshMaster = await resolveOrderMasterId(db, o.customerName);
      if (freshMaster !== String((c as any).masterCustomerId ?? '')) fields.push('masterCustomerId');
      if (fields.length) changed.push({ id, fields });
    }
    const liveIds = new Set(live.map((o) => String(o.id)));
    for (const c of core) if (!liveIds.has(String(c.id))) extra.push(`${String(c.id)} (left open scope?)`);
    // Lines: per-lineKey state on mirrored orders.
    const lineDiffs: Array<{ soId: string; lineKey: string; fields: string[] }> = [];
    if (live.length) {
      const ids = live.map((o) => String(o.id));
      const liveLines: any[] = [];
      const coreLines: any[] = [];
      for (let i = 0; i < ids.length; i += 50) {
        const slice = ids.slice(i, i + 50);
        const q = `(${slice.map(() => '?').join(',')})`;
        liveLines.push(...await db.prepare(`SELECT * FROM "CrmSoItem" WHERE "soId" IN ${q}`).bind(...slice).all().then((r: any) => r?.results ?? []).catch(() => []));
        coreLines.push(...await db.prepare(`SELECT * FROM "core_so_line" WHERE "soId" IN ${q}`).bind(...slice).all().then((r: any) => r?.results ?? []).catch(() => []));
      }
      const coreByLine = new Map(coreLines.map((l) => [`${l.soId}	${l.lineKey}`, l]));
      for (const l of liveLines) {
        const k = `${l.soId}	${l.lineKey}`;
        const c = coreByLine.get(k);
        if (!c) { lineDiffs.push({ soId: String(l.soId), lineKey: String(l.lineKey), fields: ['missing-in-core'] }); continue; }
        const fields = FLOOR_LINE_COLS.filter((col) => String((l as any)[col] ?? '') !== String((c as any)[col] ?? ''));
        if (Math.abs((Number(l.itemTotal) || 0) - (Number((c as any).itemTotal) || 0)) > 1 && !fields.includes('itemTotal')) fields.push('itemTotal');
        if (fields.length) lineDiffs.push({ soId: String(l.soId), lineKey: String(l.lineKey), fields });
      }
    }
    if (!missing.length && !extra.length && !changed.length && !lineDiffs.length) { await shadowHeartbeat('floor-shadow'); return; }
    const sig = hashSig(JSON.stringify({ missing, extra, changed, lineDiffs }));
    const recent: any[] = await db.prepare(
      `SELECT "detail" FROM "core_system_job" WHERE "key" = 'floor-shadow' ORDER BY "startedAt" DESC LIMIT 5`,
    ).all().then((r: any) => r?.results ?? []).catch(() => []);
    for (const j of recent) {
      try {
        if (JSON.parse(String((j as any)?.detail ?? '{}')).sig === sig) return;
      } catch { /* keep looking */ }
    }
    await db.prepare(
      `INSERT INTO "core_system_job" ("id", "key", "status", "startedAt", "finishedAt", "detail") VALUES (?, 'floor-shadow', 'DIFF', ?, ?, ?)`,
    ).bind(newId(), nowIso(), nowIso(), JSON.stringify({
      sig, openChecked: live.length, missing: missing.length, extra: extra.length,
      changed: changed.length, lineDiffs: lineDiffs.length,
      sample: { missing: missing.slice(0, 20), extra: extra.slice(0, 20), changed: changed.slice(0, 50), lineDiffs: lineDiffs.slice(0, 50) },
    })).run();
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'shadowCompareFloor failed (non-blocking)');
    } catch { /* never throw */ }
  }
}
