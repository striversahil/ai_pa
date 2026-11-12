// modules/core/finance.ts — dues + receivables mirror + shadow (Phase 5a).
// core_receipt holds MONEY-EXPECTED rows from two origins:
//   due: built by the ACCOUNTS domain (it owns statement/due-date math —
//        core never recomputes it). upsertReceipts() is the write fence.
//   receivable: mirrored from DebtorInvoice open balances by
//        mirrorReceivables() (full convergent refresh, 525 rows — cheap).
// masterCustomerId = UNIQUE exact match or '' (never guessed).
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

export interface DueReceiptInput {
  templateId: string;
  biller: string;
  category: string;
  amount: number;
  dueDate: string;
  statementDate?: string | null;
  identifier?: string;
}

const DUE_COLS = ['id', 'origin', 'templateId', 'biller', 'category', 'amount', 'dueDate', 'statementDate', 'identifier', 'status'];

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

async function writeAudit(entityId: string, changes: Record<string, unknown>, reason: string): Promise<void> {
  try {
    const p: any = prisma as any;
    if (!p || typeof p.coreAuditEvent?.create !== 'function') return;
    await p.coreAuditEvent.create({
      data: {
        id: newId(), actorType: 'SYSTEM', actorId: null, source: 'core-finance-mirror',
        entityType: 'core_receipt', entityId, operation: 'create',
        changes: JSON.stringify(changes), reason,
      },
    });
  } catch { /* audit best-effort */ }
}

/**
 * Write fence for due projections. Rows are built by the accounts domain
 * (statement math stays there — core never recomputes it). Called with the
 * full dues list on every calendar build, so core converges on reads;
 * template CRUD busts the calendar cache, which re-mirrors on next read.
 */
export async function upsertDueReceipts(rows: DueReceiptInput[]): Promise<void> {
  try {
    const db = getD1Database();
    const clean = (rows ?? []).filter((r) => r && r.templateId && r.dueDate);
    if (!db || !clean.length) return;
    const byTemplate = new Map<string, DueReceiptInput[]>();
    for (const r of clean) {
      const k = String(r.templateId);
      if (!byTemplate.has(k)) byTemplate.set(k, []);
      byTemplate.get(k)!.push(r);
    }
    for (const [tid, list] of byTemplate) {
      await db.prepare(`DELETE FROM "core_receipt" WHERE "origin" = 'due' AND "templateId" = ?`).bind(tid).run();
      for (const row of list) {
        const id = `due:${tid}:${row.dueDate}`;
        await db.prepare(
          `INSERT OR IGNORE INTO "core_receipt" ("id", "origin", "templateId", "biller", "category", "amount", "dueDate", "statementDate", "identifier", "status", "createdAt", "updatedAt") VALUES (?, 'due', ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        ).bind(id, tid, String(row.biller ?? ''), String(row.category ?? ''), Number(row.amount) || 0,
          String(row.dueDate), row.statementDate ?? null, String(row.identifier ?? ''), nowIso(), nowIso()).run();
      }
    }
    await writeAudit([...byTemplate.keys()][0], { templates: byTemplate.size }, 'finance-dual-write: projected dues');
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'upsertDueReceipts failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

/** Mark a due receipt paid (payDue funnel — the only paid transition). */
export async function markReceiptPaid(templateId: string, dueDate: string): Promise<void> {
  try {
    const db = getD1Database();
    if (!db || !templateId || !dueDate) return;
    await db.prepare(
      `UPDATE "core_receipt" SET "status" = 'paid', "updatedAt" = ? WHERE "origin" = 'due' AND "templateId" = ? AND "dueDate" = ?`,
    ).bind(nowIso(), String(templateId), String(dueDate).slice(0, 10)).run();
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'markReceiptPaid failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

/** Convergent refresh of receivable rows from open debtor invoices. */
export async function mirrorReceivables(invoiceIds?: string[]): Promise<void> {
  try {
    const db = getD1Database();
    if (!db) return;
    const scope = invoiceIds?.length
      ? `AND "DebtorInvoice"."id" IN (${invoiceIds.map(() => '?').join(',')})`
      : '';
    const params = invoiceIds?.length ? [...invoiceIds] : [];
    // Insert new opens.
    await db.prepare(
      `INSERT OR IGNORE INTO "core_receipt" ("id", "origin", "customerName", "masterCustomerId", "invoiceNo", "invoiceDate", "amount", "received", "balance", "dueDate", "status", "createdAt", "updatedAt")
       SELECT 'recv:' || "DebtorInvoice"."id", 'receivable', "DebtorInvoice"."customerName", '', "DebtorInvoice"."invoiceNo",
         "DebtorInvoice"."invoiceDate", "DebtorInvoice"."invoiceAmount",
         ("DebtorInvoice"."baseReceived" + "DebtorInvoice"."collectedAtImport"),
         ("DebtorInvoice"."invoiceAmount" - "DebtorInvoice"."baseReceived" - "DebtorInvoice"."collectedAtImport"),
         COALESCE("DebtorInvoice"."dueDate", ''), 'open', "DebtorInvoice"."createdAt", "DebtorInvoice"."updatedAt"
       FROM "DebtorInvoice" WHERE "DebtorInvoice"."deleted" = 0
         AND ("DebtorInvoice"."invoiceAmount" - "DebtorInvoice"."baseReceived" - "DebtorInvoice"."collectedAtImport") > 0 ${scope}`,
    ).bind(...params).run();
    // Refresh balances + resolve master links for mirrored rows.
    const rows: any[] = await db.prepare(
      `SELECT "DebtorInvoice".* FROM "DebtorInvoice" WHERE "DebtorInvoice"."deleted" = 0
        AND ("DebtorInvoice"."invoiceAmount" - "DebtorInvoice"."baseReceived" - "DebtorInvoice"."collectedAtImport") > 0 ${scope}`,
    ).bind(...params).all().then((r: any) => r?.results ?? []).catch(() => []);
    for (const inv of rows) {
      const masterId = await resolveMasterId(db, inv.customerName);
      await db.prepare(
        `UPDATE "core_receipt" SET "customerName" = ?, "masterCustomerId" = ?, "invoiceNo" = ?, "invoiceDate" = ?,
         "amount" = ?, "received" = ?, "balance" = ?, "dueDate" = ?, "updatedAt" = ? WHERE "id" = ?`,
      ).bind(String(inv.customerName ?? ''), masterId, String(inv.invoiceNo ?? ''), inv.invoiceDate ?? null,
        Number(inv.invoiceAmount) || 0, (Number(inv.baseReceived) || 0) + (Number(inv.collectedAtImport) || 0),
        (Number(inv.invoiceAmount) || 0) - (Number(inv.baseReceived) || 0) - (Number(inv.collectedAtImport) || 0),
        inv.dueDate ?? '', nowIso(), `recv:${inv.id}`).run();
    }
    // Fully-paid or deleted invoices leave core (their balance is zero).
    await db.prepare(
      `DELETE FROM "core_receipt" WHERE "origin" = 'receivable' AND "id" NOT IN (
         SELECT 'recv:' || "id" FROM "DebtorInvoice" WHERE "deleted" = 0
         AND ("invoiceAmount" - "baseReceived" - "collectedAtImport") > 0)`,
    ).run();
    await writeAudit(invoiceIds?.[0] ?? 'all', { invoices: rows.length }, 'finance-dual-write: projected receivables');
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorReceivables failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

// ── Phase 5a: finance shadow (accounts-read-only, log-only) ────────────────
// Compares calendar dues (rebuilt with the domain's own math at read time)
// vs core due-origin rows + receivable totals vs debtor open balances.
// Log-only `finance-shadow` DIFF rows, sig-deduped, throttled.

let lastFinanceShadowAt = 0;

function hashSig(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export interface CalendarDue {
  templateId: string;
  dueDate: string;
  amount: number;
}

export async function shadowCompareFinance(liveDues: CalendarDue[]): Promise<void> {
  try {
    const now = Date.now();
    if (now - lastFinanceShadowAt < 5 * 60 * 1000) return;
    lastFinanceShadowAt = now;
    const db = getD1Database();
    if (!db) return;
    const coreDues: any[] = await db.prepare(
      `SELECT "templateId", "dueDate", "amount" FROM "core_receipt" WHERE "origin" = 'due'`,
    ).all().then((r: any) => r?.results ?? []).catch(() => []);
    const coreByKey = new Map(coreDues.map((d) => [`${d.templateId}	${d.dueDate}`, Number(d.amount) || 0]));
    const liveByKey = new Map((liveDues ?? []).map((d) => [`${d.templateId}	${d.dueDate}`, Number(d.amount) || 0]));
    const dueDiffs: Array<{ key: string; live: number; core: number | null }> = [];
    for (const [k, amt] of liveByKey) {
      const c = coreByKey.get(k);
      if (c === undefined) dueDiffs.push({ key: k, live: amt, core: null });
      else if (Math.abs(amt - c) > 1) dueDiffs.push({ key: k, live: amt, core: c });
    }
    for (const [k, amt] of coreByKey) {
      if (!liveByKey.has(k)) dueDiffs.push({ key: k, live: 0, core: amt });
    }
    const liveRecv: any[] = await db.prepare(
      `SELECT COALESCE(SUM("invoiceAmount" - "baseReceived" - "collectedAtImport"), 0) AS "t", COUNT(*) AS "n" FROM "DebtorInvoice" WHERE "deleted" = 0 AND ("invoiceAmount" - "baseReceived" - "collectedAtImport") > 0`,
    ).all().then((r: any) => r?.results ?? []).catch(() => []);
    const coreRecv: any[] = await db.prepare(
      `SELECT COALESCE(SUM("balance"), 0) AS "t", COUNT(*) AS "n" FROM "core_receipt" WHERE "origin" = 'receivable'`,
    ).all().then((r: any) => r?.results ?? []).catch(() => []);
    const recvDiff: string[] = [];
    const lt = Number(liveRecv[0]?.t ?? 0), ct = Number(coreRecv[0]?.t ?? 0);
    if (Math.abs(lt - ct) > 1) recvDiff.push(`total ${lt} != ${ct}`);
    if (Number(liveRecv[0]?.n ?? 0) !== Number(coreRecv[0]?.n ?? 0)) recvDiff.push(`count ${liveRecv[0]?.n} != ${coreRecv[0]?.n}`);
    // Phase 5b promises: converge remark-parsed rows, then compare live source
    // counts (structured open + parsed open) vs core rows. Statuses derive on
    // read from the same collections on both sides, so counts catch gaps.
    const promDiff: string[] = [];
    try {
      await mirrorRemarkPromisesFull();
      const { derivePromiseStatus } = await import('./finance-parse');
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      const structOpen: any[] = await db.prepare(
        `SELECT COUNT(*) AS "n" FROM "PaymentCustomer" WHERE "promisedDate" IS NOT NULL AND "promisedDate" <> '' AND substr("promisedDate", 1, 10) >= ?`,
      ).bind(today).all().then((r: any) => r?.results ?? []).catch(() => []);
      const remarks: any[] = await db.prepare(
        `SELECT "day", "remark" FROM "PaymentCustomerRemark" WHERE "deleted" = 0`,
      ).all().then((r: any) => r?.results ?? []).catch(() => []);
      const { extractPromise } = await import('./finance-parse');
      let parsedOpen = 0;
      for (const rm of remarks) {
        const f = extractPromise(String(rm.remark ?? ''), String(rm.day ?? '').slice(0, 10));
        if (f && f.payByDate >= today) parsedOpen++;
      }
      const liveProm = Number(structOpen[0]?.n ?? 0) + parsedOpen;
      const coreProm: any[] = await db.prepare(`SELECT COUNT(*) AS "n" FROM "core_promise"`)
        .all().then((r: any) => r?.results ?? []).catch(() => []);
      const coreN = Number(coreProm[0]?.n ?? 0);
      if (liveProm !== coreN) promDiff.push(`count live=${liveProm} core=${coreN}`);
      // Derived-status sanity on the core side (kept needs a real collection).
      const coreRows: any[] = await db.prepare(`SELECT * FROM "core_promise" LIMIT 2000`)
        .all().then((r: any) => r?.results ?? []).catch(() => []);
      const cols: any[] = await db.prepare(
        `SELECT "customerName", "collectionDate" FROM "PaymentCollection" WHERE "deleted" = 0 AND "collectionDate" IS NOT NULL AND "collectionDate" <> ''`,
      ).all().then((r: any) => r?.results ?? []).catch(() => []);
      const dist: Record<string, number> = { open: 0, kept: 0, broken: 0 };
      for (const pr of coreRows) {
        const st = derivePromiseStatus(
          { promisedDate: String(pr.promisedDate ?? ''), startDay: String(pr.startDay ?? ''), customerName: String(pr.customerName ?? '') },
          (cols as any[]).map((c) => ({ customerName: String(c.customerName ?? ''), collectionDate: String(c.collectionDate ?? '') })),
          today,
        );
        dist[st]++;
      }
      void dist;
    } catch { /* promise check best-effort */ }
    if (!dueDiffs.length && !recvDiff.length && !promDiff.length) { await shadowHeartbeat('finance-shadow'); return; }
    const sig = hashSig(JSON.stringify({ dueDiffs, recvDiff, promDiff }));
    const recent: any[] = await db.prepare(
      `SELECT "detail" FROM "core_system_job" WHERE "key" = 'finance-shadow' ORDER BY "startedAt" DESC LIMIT 5`,
    ).all().then((r: any) => r?.results ?? []).catch(() => []);
    for (const j of recent) {
      try {
        if (JSON.parse(String((j as any)?.detail ?? '{}')).sig === sig) return;
      } catch { /* keep looking */ }
    }
    await db.prepare(
      `INSERT INTO "core_system_job" ("id", "key", "status", "startedAt", "finishedAt", "detail") VALUES (?, 'finance-shadow', 'DIFF', ?, ?, ?)`,
    ).bind(newId(), nowIso(), nowIso(), JSON.stringify({
      sig, dueDiffs: dueDiffs.length, recvDiff, promDiff,
      sample: { dueDiffs: dueDiffs.slice(0, 50) },
    })).run();
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'shadowCompareFinance failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

// ── Phase 5b: promise ledger (dated commitments, status derived on read) ────
// mirrorSituationPromise(customerKey): structured promisedDate → `prom-cust`
//   row; cleared promise → row deleted (a newer promise replaces it).
// mirrorRemarkPromise(remarkId): parsed remark date → `prom` row; unparseable
//   or deleted remark → row deleted.
// mirrorRemarkPromisesFull(): convergent full scan (called from the finance
//   shadow, throttled with it) so historical parsed remarks backfill on the
//   first read after deploy. Never throws.

export async function mirrorSituationPromise(customerKey: string): Promise<void> {
  try {
    const db = getD1Database();
    const key = String(customerKey ?? '').trim().toLowerCase();
    if (!db || !key) return;
    const row: any = await db.prepare(`SELECT * FROM "PaymentCustomer" WHERE "customerKey" = ?`)
      .bind(key).all().then((r: any) => (r?.results ?? [])[0]).catch(() => null);
    const id = `prom-cust:${key}`;
    const promisedDate = row ? String(row.promisedDate ?? '').slice(0, 10) : '';
    if (!row || !promisedDate) {
      await db.prepare(`DELETE FROM "core_promise" WHERE "id" = ?`).bind(id).run();
      return;
    }
    const startDay = String(row.promisedAt ?? row.situationUpdatedAt ?? row.updatedAt ?? nowIso()).slice(0, 10);
    const masterId = await resolveMasterId(db, row.customerName);
    await db.prepare(
      `INSERT OR IGNORE INTO "core_promise" ("id", "origin", "customerKey", "customerName", "masterCustomerId", "promisedDate", "startDay", "amount", "remarkId", "promisedBy", "createdAt", "updatedAt") VALUES (?, 'situation', ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
    ).bind(id, key, String(row.customerName ?? ''), masterId, promisedDate, startDay,
      String(row.promisedBy ?? row.situationUpdatedBy ?? ''), nowIso(), nowIso()).run();
    await db.prepare(
      `UPDATE "core_promise" SET "customerName" = ?, "masterCustomerId" = ?, "promisedDate" = ?, "startDay" = ?, "promisedBy" = ?, "updatedAt" = ? WHERE "id" = ?`,
    ).bind(String(row.customerName ?? ''), masterId, promisedDate, startDay,
      String(row.promisedBy ?? row.situationUpdatedBy ?? ''), nowIso(), id).run();
    await writeAudit(id, { customerKey: key, promisedDate }, 'finance-dual-write: projected structured promise');
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorSituationPromise failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

export async function mirrorRemarkPromise(remarkId: string): Promise<void> {
  try {
    const db = getD1Database();
    const rid = String(remarkId ?? '');
    if (!db || !rid) return;
    const id = `prom:${rid}`;
    const { extractPromise } = await import('./finance-parse');
    const r: any = await db.prepare(`SELECT * FROM "PaymentCustomerRemark" WHERE "id" = ?`)
      .bind(rid).all().then((x: any) => (x?.results ?? [])[0]).catch(() => null);
    if (!r || (r as any).deleted) {
      await db.prepare(`DELETE FROM "core_promise" WHERE "id" = ?`).bind(id).run();
      return;
    }
    const startDay = String((r as any).day ?? '').slice(0, 10) || nowIso().slice(0, 10);
    const found = extractPromise(String((r as any).remark ?? ''), startDay);
    if (!found) {
      await db.prepare(`DELETE FROM "core_promise" WHERE "id" = ?`).bind(id).run();
      return;
    }
    const key = String((r as any).customerKey ?? '').trim().toLowerCase();
    const masterId = await resolveMasterId(db, (r as any).customerName);
    await db.prepare(
      `INSERT OR IGNORE INTO "core_promise" ("id", "origin", "customerKey", "customerName", "masterCustomerId", "promisedDate", "startDay", "amount", "remarkId", "promisedBy", "createdAt", "updatedAt") VALUES (?, 'remark', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, key, String((r as any).customerName ?? ''), masterId, found.payByDate, startDay,
      found.amount, rid, String((r as any).actor ?? ''), nowIso(), nowIso()).run();
    await db.prepare(
      `UPDATE "core_promise" SET "customerKey" = ?, "customerName" = ?, "masterCustomerId" = ?, "promisedDate" = ?, "startDay" = ?, "amount" = ?, "promisedBy" = ?, "updatedAt" = ? WHERE "id" = ?`,
    ).bind(key, String((r as any).customerName ?? ''), masterId, found.payByDate, startDay,
      found.amount, String((r as any).actor ?? ''), nowIso(), id).run();
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorRemarkPromise failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

/** Full convergent scan of non-deleted remarks (chunked; throttled by caller). */
export async function mirrorRemarkPromisesFull(): Promise<{ parsed: number; kept: number }> {
  const out = { parsed: 0, kept: 0 };
  try {
    const db = getD1Database();
    if (!db) return out;
    const { extractPromise } = await import('./finance-parse');
    let cursor = '';
    for (let page = 0; page < 20; page++) {
      const rows: any[] = await db.prepare(
        `SELECT "id", "customerKey", "customerName", "day", "remark", "actor" FROM "PaymentCustomerRemark" WHERE "deleted" = 0 AND "id" > ? ORDER BY "id" LIMIT 200`,
      ).bind(cursor).all().then((r: any) => r?.results ?? []).catch(() => []);
      if (!rows.length) break;
      for (const r of rows) {
        out.parsed++;
        const startDay = String(r.day ?? '').slice(0, 10) || nowIso().slice(0, 10);
        const found = extractPromise(String(r.remark ?? ''), startDay);
        if (!found) continue;
        const id = `prom:${r.id}`;
        const masterId = await resolveMasterId(db, r.customerName);
        await db.prepare(
          `INSERT OR IGNORE INTO "core_promise" ("id", "origin", "customerKey", "customerName", "masterCustomerId", "promisedDate", "startDay", "amount", "remarkId", "promisedBy", "createdAt", "updatedAt") VALUES (?, 'remark', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, String(r.customerKey ?? '').trim().toLowerCase(), String(r.customerName ?? ''), masterId,
          found.payByDate, startDay, found.amount, String(r.id), String(r.actor ?? ''), nowIso(), nowIso()).run();
        out.kept++;
      }
      cursor = String(rows[rows.length - 1]?.id ?? '');
      if (rows.length < 200) break;
    }
    if (out.kept) await writeAudit('remark-scan', { parsed: out.parsed, kept: out.kept }, 'finance-dual-write: remark promise backfill scan');
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorRemarkPromisesFull failed (non-blocking)');
    } catch { /* never throw */ }
  }
  return out;
}
