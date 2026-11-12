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
import { shadowHeartbeat } from './notify';

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

// ── Phase 3d: sales shadow (leaderboard-only, log-only, ₹1 money tolerance) ──
// Served values NEVER change — the leaderboard keeps reading Estimate + score
// events. Two comparisons, one log:
//   A. headers: live OPEN estimates (sent/draft) vs core_sale (any field;
//      money within ₹1; createdAt/updatedAt excluded — mirror timestamps).
//   B. ledger: core rows closed after 3c (closeDay set) vs score events —
//      converterId must equal the closer-winner else generator, closeDay must
//      equal the winning event day. Pre-3c closes (in the ledger but not in
//      core) are out of scope until the finance cut-over — never logged.
// Flip gate: legacy score-event writes stop after 7 days of closes with zero
// DIFF rows. Throttled in-memory (best-effort across isolates).

const SALE_SHADOW_COLS = ['estimateNumber', 'customerName', 'organizationId', 'status', 'region', 'date'] as const;

let lastSalesShadowAt = 0;

async function readAllSalesShadow(db: any, table: string, where: string): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  let cursor = '';
  for (let page = 0; page < 40; page++) {
    const res = await db.prepare(
      `SELECT * FROM "${table}" WHERE "id" > ? ${where} ORDER BY "id" LIMIT 500`,
    ).bind(cursor).all().catch(() => null);
    const rows: any[] = ((res as any)?.results ?? []);
    if (!rows.length) break;
    for (const r of rows) out.set(String(r.id ?? r.estimateId ?? ''), r);
    cursor = String(rows[rows.length - 1]?.id ?? rows[rows.length - 1]?.estimateId ?? '');
    if (rows.length < 500) break;
  }
  return out;
}

export async function shadowCompareSales(): Promise<void> {
  try {
    const now = Date.now();
    if (now - lastSalesShadowAt < 5 * 60 * 1000) return;
    lastSalesShadowAt = now;
    const db = getD1Database();
    if (!db) return;
    const [live, core] = await Promise.all([
      readAllSalesShadow(db, 'Estimate', `AND lower("status") IN ('sent', 'draft')`),
      readAllSalesShadow(db, 'core_sale', ''),
    ]);
    const missing: string[] = [];
    const extra: string[] = [];
    const changed: Array<{ id: string; fields: string[] }> = [];
    for (const [id, e] of live) {
      const c = core.get(id);
      if (!c) { missing.push(id); continue; }
      const fields: string[] = [];
      for (const col of SALE_SHADOW_COLS) {
        if (String((e as any)[col] ?? '') !== String((c as any)[col] ?? '')) fields.push(col);
      }
      if (Math.abs((Number((e as any).total) || 0) - (Number((c as any).total) || 0)) > 1) fields.push('total');
      if (String((e as any).createdBy ?? '') !== String((c as any).createdBy ?? '')) fields.push('createdBy');
      const freshMaster = await resolveMasterId(db, (e as any).customerName);
      if (freshMaster !== String((c as any).masterCustomerId ?? '')) fields.push('masterCustomerId');
      if (fields.length) changed.push({ id, fields });
    }
    // Core rows whose live row is no longer open: newly-closed (verify via the
    // ledger below) vs anything else (triage).
    const closedCheck: string[] = [];
    for (const [id, c] of core) {
      if (live.has(id)) continue;
      const lr: any = await db.prepare(`SELECT "status" FROM "Estimate" WHERE "estimateId" = ?`).bind(id).all()
        .then((r: any) => (r?.results ?? [])[0]).catch(() => null);
      const st = String(lr?.status ?? '').toLowerCase();
      if (['accepted', 'confirmed', 'declined'].includes(st)) closedCheck.push(id);
      else extra.push(`${id} (live:${st || 'gone'})`);
    }
    // Ledger compare on newly-closed core rows only.
    const ledger: Array<{ id: string; issue: string }> = [];
    for (const id of closedCheck) {
      const c = core.get(id);
      try {
        const res = await db.prepare(
          `SELECT "telecallerId", "kind", "day" FROM "TelecallerScoreEvent" WHERE "estimateId" = ? AND "kind" IN ('generator', 'closer') ORDER BY "day" DESC`,
        ).bind(id).all().catch(() => null);
        const evts: any[] = ((res as any)?.results ?? []);
        if (!evts.length) { ledger.push({ id, issue: 'no-credit-row' }); continue; }
        const winner = evts.find((e) => String(e.kind) === 'closer') ?? evts.find((e) => String(e.kind) === 'generator') ?? evts[0];
        if (String((c as any).converterId ?? '') !== String(winner.telecallerId ?? '')) {
          ledger.push({ id, issue: `converter ${String((c as any).converterId ?? '')} != ledger ${String(winner.telecallerId ?? '')}` });
        }
        if (String((c as any).closeDay ?? '') !== String(winner.day ?? '')) {
          ledger.push({ id, issue: `closeDay ${String((c as any).closeDay ?? '')} != ledger day ${String(winner.day ?? '')}` });
        }
        const live2: any = await db.prepare(`SELECT "total", "acceptedAt" FROM "Estimate" WHERE "estimateId" = ?`).bind(id).all()
          .then((r: any) => (r?.results ?? [])[0]).catch(() => null);
        if (Math.abs((Number((c as any).closeValue) || 0) - (Number(live2?.total) || 0)) > 1) {
          ledger.push({ id, issue: 'closeValue != live total' });
        }
        if (String((c as any).closeDay ?? '') !== String(live2?.acceptedAt ?? '')) {
          ledger.push({ id, issue: 'closeDay != acceptedAt' });
        }
      } catch { /* per-row best-effort */ }
    }
    if (!missing.length && !extra.length && !changed.length && !ledger.length) { await shadowHeartbeat('sales-shadow'); return; } // quiet run: heartbeat only
    const sig = hashSig(JSON.stringify({ missing, extra, changed, ledger }));
    const recent: any[] = await db.prepare(
      `SELECT "detail" FROM "core_system_job" WHERE "key" = 'sales-shadow' ORDER BY "startedAt" DESC LIMIT 5`,
    ).all().then((r: any) => r?.results ?? []).catch(() => []);
    for (const j of recent) {
      try {
        if (JSON.parse(String((j as any)?.detail ?? '{}')).sig === sig) return;
      } catch { /* keep looking */ }
    }
    await db.prepare(
      `INSERT INTO "core_system_job" ("id", "key", "status", "startedAt", "finishedAt", "detail") VALUES (?, 'sales-shadow', 'DIFF', ?, ?, ?)`,
    ).bind(
      newId(), nowIso(), nowIso(),
      JSON.stringify({
        sig, openChecked: live.size, coreRows: core.size, newlyClosed: closedCheck.length,
        missing: missing.length, extra: extra.length, changed: changed.length, ledger: ledger.length,
        sample: { missing: missing.slice(0, 20), extra: extra.slice(0, 20), changed: changed.slice(0, 50), ledger: ledger.slice(0, 50) },
      }),
    ).run();
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'shadowCompareSales failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

function hashSig(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ── Phase 3e: close-credit dual ledger (1:1 mirror of TelecallerScoreEvent) ──
// Single funnel: recordScoreEvent (scoring.ts) calls mirrorCreditRow with the
// same id; deleteCloseHistory (reset purge) calls mirrorCreditPurge. Both are
// best-effort and Dual-runtime safe (no-op wherever D1 is unavailable).

export interface CreditRow {
  id: string;
  telecallerId: string;
  estimateId: string;
  kind: string;
  delta: number;
  day: string;
  reason: string | null;
  createdAt: string;
}

export async function mirrorCreditRow(row: CreditRow): Promise<void> {
  try {
    const db = getD1Database();
    if (!db || !row.id) return;
    await db.prepare(
      `INSERT OR IGNORE INTO "core_credit" ("id", "telecallerId", "estimateId", "kind", "delta", "day", "reason", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(row.id, String(row.telecallerId ?? ''), String(row.estimateId ?? ''), String(row.kind ?? ''),
      Number(row.delta) || 0, String(row.day ?? ''), row.reason ?? null, row.createdAt).run();
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorCreditRow failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

export async function mirrorCreditPurge(ids: string[]): Promise<void> {
  try {
    const db = getD1Database();
    const clean = [...new Set((ids ?? []).map((s) => String(s ?? '')).filter(Boolean))];
    if (!db || !clean.length) return;
    for (let i = 0; i < clean.length; i += 50) {
      const slice = clean.slice(i, i + 50);
      await db.prepare(`DELETE FROM "core_credit" WHERE "id" IN (${slice.map(() => '?').join(',')})`)
        .bind(...slice).run();
    }
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorCreditPurge failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

// ── Phase 3e: ledger shadow (per-estimate per-kind, paise-exact) ─────────────
// Compares SUM(delta) GROUP BY (estimateId, kind) across the full history of
// both ledgers. Pre-3c rows exist in both (backfilled) so the whole history
// must match, not just new closes. Log-only `ledger-shadow` DIFF rows,
// sig-deduped, throttled. The human-confirmed stop needs 7 days of closes
// with zero DIFFs — reviewers check the `closesSeen` count, not just silence.

let lastLedgerShadowAt = 0;

async function ledgerSums(db: any, table: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const idCol = table === 'core_credit' ? '"id"' : '"id"';
  let cursor = '';
  for (let page = 0; page < 40; page++) {
    const res = await db.prepare(
      `SELECT ${idCol} AS "i", "estimateId", "kind", "delta" FROM "${table}" WHERE "id" > ? ORDER BY "id" LIMIT 500`,
    ).bind(cursor).all().catch(() => null);
    const rows: any[] = ((res as any)?.results ?? []);
    if (!rows.length) break;
    for (const r of rows) {
      const key = `${String(r.estimateId ?? '')}	${String(r.kind ?? '')}`;
      out.set(key, (out.get(key) ?? 0) + (Number(r.delta) || 0));
    }
    cursor = String(rows[rows.length - 1]?.i ?? '');
    if (rows.length < 500) break;
  }
  return out;
}

export async function shadowCompareLedger(): Promise<{ diffs: number; closesSeen: number }> {
  const out = { diffs: 0, closesSeen: 0 };
  try {
    const now = Date.now();
    if (now - lastLedgerShadowAt < 5 * 60 * 1000) return out;
    lastLedgerShadowAt = now;
    const db = getD1Database();
    if (!db) return out;
    const [legacy, core] = await Promise.all([ledgerSums(db, 'TelecallerScoreEvent'), ledgerSums(db, 'core_credit')]);
    const keys = new Set([...legacy.keys(), ...core.keys()]);
    const mismatches: Array<{ key: string; legacy: number; core: number }> = [];
    for (const k of keys) {
      const a = legacy.get(k) ?? 0;
      const b = core.get(k) ?? 0;
      if (a !== b) mismatches.push({ key: k, legacy: a, core: b });
    }
    out.diffs = mismatches.length;
    // closesSeen: distinct estimates with a close-kind row in the last 7 days
    // (the matching-week clock only advances when closes actually happen).
    try {
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
      const res = await db.prepare(
        `SELECT COUNT(DISTINCT "estimateId") AS "n" FROM "TelecallerScoreEvent" WHERE "day" >= ? AND ("kind" IN ('generator', 'closer') OR ("kind" = '' AND "delta" > 0))`,
      ).bind(weekAgo).all().catch(() => null);
      out.closesSeen = Number(((res as any)?.results ?? [])[0]?.n ?? 0) || 0;
    } catch { /* closesSeen best-effort */ }
    if (!mismatches.length) { await shadowHeartbeat('ledger-shadow'); return out; } // quiet run: heartbeat only
    const sig = hashSig(JSON.stringify(mismatches));
    const recent: any[] = await db.prepare(
      `SELECT "detail" FROM "core_system_job" WHERE "key" = 'ledger-shadow' ORDER BY "startedAt" DESC LIMIT 5`,
    ).all().then((r: any) => r?.results ?? []).catch(() => []);
    for (const j of recent) {
      try {
        if (JSON.parse(String((j as any)?.detail ?? '{}')).sig === sig) return out;
      } catch { /* keep looking */ }
    }
    await db.prepare(
      `INSERT INTO "core_system_job" ("id", "key", "status", "startedAt", "finishedAt", "detail") VALUES (?, 'ledger-shadow', 'DIFF', ?, ?, ?)`,
    ).bind(newId(), nowIso(), nowIso(), JSON.stringify({
      sig, groups: keys.size, mismatches: mismatches.length, closesSeen: out.closesSeen,
      sample: mismatches.slice(0, 50),
    })).run();
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'shadowCompareLedger failed (non-blocking)');
    } catch { /* never throw */ }
  }
  return out;
}
