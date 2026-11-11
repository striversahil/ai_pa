// modules/core/stock.ts — stock ledger dual-write + shadow (Phase 4b).
// Mirrors StockMovement → core_stock_entry, StockReservation →
// core_reservation, StockLocation → core_warehouse. ids reused verbatim.
// Entries/reservations refresh status transitions (approve/release) via
// UPDATE…FROM; warehouses refresh name/active. Item master stays legacy.
// This module NEVER throws. Dual-runtime safe (D1-null no-op off-Worker).
import { prisma } from '../../shared/prisma';
import { getD1Database } from '../../shared/prisma-d1';
import { logger } from '../../shared/logger';

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
        id: newId(), actorType: 'SYSTEM', actorId: null, source: 'core-stock-mirror',
        entityType: operation, entityId, operation: 'create',
        changes: JSON.stringify(changes), reason,
      },
    });
  } catch { /* audit best-effort */ }
}

const ENTRY_COLS = ['id', 'itemId', 'day', 'kind', 'qty', 'locationId', 'toLocationId', 'rate', 'status', 'refType', 'refId', 'note', 'createdBy'];
const RES_COLS = ['id', 'itemId', 'locationId', 'qty', 'refType', 'refId', 'status', 'day', 'createdBy'];

/** Mirror stock entries by id (post + approve transitions converge here). */
export async function mirrorStockEntries(ids: string[]): Promise<void> {
  try {
    const db = getD1Database();
    const clean = [...new Set((ids ?? []).map((s) => String(s ?? '')).filter(Boolean))];
    if (!db || !clean.length) return;
    for (let i = 0; i < clean.length; i += 50) {
      const slice = clean.slice(i, i + 50);
      const q = `(${slice.map(() => '?').join(',')})`;
      const rows: any[] = await db.prepare(`SELECT * FROM "StockMovement" WHERE "id" IN ${q}`)
        .bind(...slice).all().then((r: any) => r?.results ?? []).catch(() => []);
      for (const m of rows) {
        await db.prepare(`INSERT OR IGNORE INTO "core_stock_entry" (${ENTRY_COLS.map((c) => `"${c}"`).join(', ')}, "createdAt") VALUES (${ENTRY_COLS.map(() => '?').join(',')}, ?)`)
          .bind(...ENTRY_COLS.map((c) => (m as any)[c] ?? null), String((m as any).createdAt ?? nowIso())).run();
        await db.prepare(`UPDATE "core_stock_entry" SET ${ENTRY_COLS.filter((c) => c !== 'id').map((c) => `"${c}" = ?`).join(', ')} WHERE "id" = ?`)
          .bind(...ENTRY_COLS.filter((c) => c !== 'id').map((c) => (m as any)[c] ?? null), String(m.id)).run();
      }
    }
    await writeAudit(clean[0], 'core_stock_entry', { ids: clean.length }, 'stock-dual-write: projected movements');
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorStockEntries failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

/** Mirror reservations by id (reserve/release transitions converge here). */
export async function mirrorReservations(ids: string[]): Promise<void> {
  try {
    const db = getD1Database();
    const clean = [...new Set((ids ?? []).map((s) => String(s ?? '')).filter(Boolean))];
    if (!db || !clean.length) return;
    for (let i = 0; i < clean.length; i += 50) {
      const slice = clean.slice(i, i + 50);
      const q = `(${slice.map(() => '?').join(',')})`;
      const rows: any[] = await db.prepare(`SELECT * FROM "StockReservation" WHERE "id" IN ${q}`)
        .bind(...slice).all().then((r: any) => r?.results ?? []).catch(() => []);
      for (const r of rows) {
        await db.prepare(`INSERT OR IGNORE INTO "core_reservation" (${RES_COLS.map((c) => `"${c}"`).join(', ')}, "createdAt") VALUES (${RES_COLS.map(() => '?').join(',')}, ?)`)
          .bind(...RES_COLS.map((c) => (r as any)[c] ?? null), String((r as any).createdAt ?? nowIso())).run();
        await db.prepare(`UPDATE "core_reservation" SET ${RES_COLS.filter((c) => c !== 'id').map((c) => `"${c}" = ?`).join(', ')} WHERE "id" = ?`)
          .bind(...RES_COLS.filter((c) => c !== 'id').map((c) => (r as any)[c] ?? null), String(r.id)).run();
      }
    }
    await writeAudit(clean[0], 'core_reservation', { ids: clean.length }, 'stock-dual-write: projected reservations');
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorReservations failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

/** Mirror a warehouse row (create/location changes are rare). */
export async function mirrorWarehouse(id: string): Promise<void> {
  try {
    const db = getD1Database();
    if (!db || !id) return;
    const row: any = await db.prepare(`SELECT * FROM "StockLocation" WHERE "id" = ?`).bind(String(id))
      .all().then((r: any) => (r?.results ?? [])[0]).catch(() => null);
    if (!row) return;
    await db.prepare(`INSERT OR IGNORE INTO "core_warehouse" ("id", "name", "active", "createdAt") VALUES (?, ?, ?, ?)`)
      .bind(String(row.id), String(row.name ?? ''), Number(row.active) ? 1 : 0, String(row.createdAt ?? nowIso())).run();
    await db.prepare(`UPDATE "core_warehouse" SET "name" = ?, "active" = ? WHERE "id" = ?`)
      .bind(String(row.name ?? ''), Number(row.active) ? 1 : 0, String(row.id)).run();
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorWarehouse failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

// ── Phase 4b: stock shadow (stock-read-only, log-only) ───────────────────────
// Compares per-item approved sums + reservation states + warehouse list.
// Log-only `stock-shadow` DIFF rows, sig-deduped, throttled.

let lastStockShadowAt = 0;

function hashSig(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

async function sumsByItem(db: any, table: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rows: any[] = await db.prepare(
    `SELECT "itemId", SUM("qty") AS "q" FROM "${table}" WHERE "status" = 'approved' GROUP BY "itemId"`,
  ).all().then((r: any) => r?.results ?? []).catch(() => []);
  for (const r of rows) out.set(String(r.itemId), Number(r.q) || 0);
  return out;
}

export async function shadowCompareStock(): Promise<void> {
  try {
    const now = Date.now();
    if (now - lastStockShadowAt < 5 * 60 * 1000) return;
    lastStockShadowAt = now;
    const db = getD1Database();
    if (!db) return;
    const [liveSums, coreSums] = await Promise.all([sumsByItem(db, 'StockMovement'), sumsByItem(db, 'core_stock_entry')]);
    const sumDiffs: Array<{ itemId: string; live: number; core: number }> = [];
    for (const [item, q] of liveSums) {
      const c = coreSums.get(item) ?? 0;
      if (Math.abs(q - c) > 1e-6) sumDiffs.push({ itemId: item, live: q, core: c });
    }
    for (const [item, q] of coreSums) {
      if (!liveSums.has(item)) sumDiffs.push({ itemId: item, live: 0, core: q });
    }
    const liveRes: any[] = await db.prepare(`SELECT "id", "status" FROM "StockReservation"`).all().then((r: any) => r?.results ?? []).catch(() => []);
    const coreRes: any[] = await db.prepare(`SELECT "id", "status" FROM "core_reservation"`).all().then((r: any) => r?.results ?? []).catch(() => []);
    const coreResById = new Map(coreRes.map((r) => [String(r.id), String(r.status)]));
    const resDiffs: Array<{ id: string; live: string; core: string }> = [];
    for (const r of liveRes) {
      const c = coreResById.get(String(r.id));
      if (c === undefined) resDiffs.push({ id: String(r.id), live: String(r.status), core: '(missing)' });
      else if (c !== String(r.status)) resDiffs.push({ id: String(r.id), live: String(r.status), core: c });
    }
    const liveWh: any[] = await db.prepare(`SELECT "id", "name", "active" FROM "StockLocation"`).all().then((r: any) => r?.results ?? []).catch(() => []);
    const coreWh: any[] = await db.prepare(`SELECT "id", "name", "active" FROM "core_warehouse"`).all().then((r: any) => r?.results ?? []).catch(() => []);
    const whDiffs: string[] = [];
    if (liveWh.length !== coreWh.length) whDiffs.push(`count ${liveWh.length} != ${coreWh.length}`);
    const coreWhById = new Map(coreWh.map((r) => [String(r.id), r]));
    for (const w of liveWh) {
      const c = coreWhById.get(String(w.id));
      if (!c) { whDiffs.push(`missing ${w.id}`); continue; }
      if (String((c as any).name) !== String(w.name) || Number((c as any).active ? 1 : 0) !== Number(w.active ? 1 : 0)) whDiffs.push(`changed ${w.id}`);
    }
    if (!sumDiffs.length && !resDiffs.length && !whDiffs.length) return;
    const sig = hashSig(JSON.stringify({ sumDiffs, resDiffs, whDiffs }));
    const recent: any[] = await db.prepare(
      `SELECT "detail" FROM "core_system_job" WHERE "key" = 'stock-shadow' ORDER BY "startedAt" DESC LIMIT 5`,
    ).all().then((r: any) => r?.results ?? []).catch(() => []);
    for (const j of recent) {
      try {
        if (JSON.parse(String((j as any)?.detail ?? '{}')).sig === sig) return;
      } catch { /* keep looking */ }
    }
    await db.prepare(
      `INSERT INTO "core_system_job" ("id", "key", "status", "startedAt", "finishedAt", "detail") VALUES (?, 'stock-shadow', 'DIFF', ?, ?, ?)`,
    ).bind(newId(), nowIso(), nowIso(), JSON.stringify({
      sig, sumDiffs: sumDiffs.length, resDiffs: resDiffs.length, whDiffs,
      sample: { sumDiffs: sumDiffs.slice(0, 30), resDiffs: resDiffs.slice(0, 30) },
    })).run();
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'shadowCompareStock failed (non-blocking)');
    } catch { /* never throw */ }
  }
}
