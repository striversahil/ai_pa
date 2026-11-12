// modules/core/leads.ts — Estimate/Enquiry → core_lead dual-write + shadow (Phase 7a).
// Rules (founder 2026-11-12, §13.15/§15): common ledger, two independent axes —
//   status (unqualified|qualified) + outcome (open|won|lost|dropped).
// Every estimate-backed lead is qualified (a quote was built; draft-vs-sent
// revisited in 7c); outcome derives from live status (declined→lost,
// accepted/confirmed/invoiced→won, else open). Orphan enquiries (no matching
// estimate) are unqualified/open. Declined rows are NEVER relabelled
// unqualified. Source normalises to the enum, raw preserved. Rates: header
// total in backfill; per-line expected/quoted arrive with 7b funnels.
// This module NEVER throws: mirror failures are logged and swallowed so live
// sales behavior can never break. Dual-runtime safe: no-ops without D1.
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

async function writeAudit(entityId: string, operation: string, changes: Record<string, unknown>, reason: string): Promise<void> {
  try {
    const p: any = prisma as any;
    if (!p || typeof p.coreAuditEvent?.create !== 'function') return;
    await p.coreAuditEvent.create({
      data: {
        id: newId(), actorType: 'SYSTEM', actorId: null, source: 'core-lead-mirror',
        entityType: 'core_lead', entityId, operation: 'create',
        changes: JSON.stringify(changes), reason,
      },
    });
  } catch { /* audit best-effort */ }
}

/** Normalised source enum; raw preserved by the caller. Never guesses. */
export function normalizeLeadSource(enquirySource: unknown, sourceLeadRaw: unknown): string {
  const es = String(enquirySource ?? '').trim().toLowerCase();
  if (es === 'ai') return 'AI';
  if (es === 'tl') return 'TL';
  if (es === 'b2b') return 'B2B';
  if (es === 'incoming') return 'Incoming';
  if (es === 'field staff') return 'FieldStaff';
  const sl = String(sourceLeadRaw ?? '').trim().toLowerCase();
  if (/^comapny/.test(sl) || /^company/.test(sl)) return 'CompanyData';
  if (/^ai/.test(sl)) return 'AI';
  if (/^indiamart/.test(sl)) return 'IndiaMART';
  if (/^refer/.test(sl)) return 'Referral';
  if (!sl) return es ? 'Other' : 'Unmapped';
  return 'Other';
}

function outcomeForStatus(status: unknown): 'open' | 'won' | 'lost' {
  const s = String(status ?? '').trim().toLowerCase();
  if (s === 'declined') return 'lost';
  if (s === 'accepted' || s === 'confirmed' || s === 'invoiced') return 'won';
  return 'open';
}

interface LeadRow { [k: string]: any }

const LEAD_COLS = [
  'id', 'dedupKey', 'leadNo', 'captureKind',
  'customerName', 'clientCompany', 'contactName', 'contactPhone', 'contactEmail',
  'location', 'region', 'assignedAgentId',
  'sourceName', 'sourceRaw', 'sourceRef',
  'productText', 'productId', 'qtyText', 'specText',
  'expectedRateAmount', 'expectedRateUnit', 'quotedRateAmount', 'quotedRateUnit',
  'status', 'outcome',
  'qualifiedBy', 'qualifiedByRole', 'qualifiedAt', 'qualifyNote',
  'disqualifyReason', 'reasonDetail', 'lostAt', 'wonAt',
  'enquiryId', 'estimateId', 'estNumber', 'occurredAt',
];

async function upsertLeadRow(db: any, row: LeadRow): Promise<void> {
  const cols = [...LEAD_COLS, 'createdAt', 'updatedAt'];
  const q = (c: string) => `"${c}"`;
  await db.prepare(
    `INSERT OR IGNORE INTO "core_lead" (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(',')})`,
  ).bind(...LEAD_COLS.map((c) => (row as any)[c] ?? null), nowIso(), nowIso()).run();
  const set = LEAD_COLS.filter((c) => c !== 'id').map((c) => `"${c}" = ?`).join(', ');
  await db.prepare(`UPDATE "core_lead" SET ${set}, "updatedAt" = ? WHERE "id" = ?`)
    .bind(...LEAD_COLS.filter((c) => c !== 'id').map((c) => (row as any)[c] ?? null), nowIso(), row.id).run();
}

/** Deterministic single enquiry per estNumber (lowest id wins). */
async function findEnquiry(db: any, estNumber: string): Promise<any | null> {
  const num = String(estNumber ?? '').trim();
  if (!num) return null;
  try {
    const res = await db.prepare(`SELECT * FROM "Enquiry" WHERE "estNumber" = ? ORDER BY "id" LIMIT 1`)
      .bind(num).all().catch(() => null);
    return ((res as any)?.results ?? [])[0] ?? null;
  } catch { return null; }
}

function firstNonBlank(...vals: unknown[]): string {
  for (const v of vals) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return '';
}

async function buildEstimateLead(db: any, estimateId: string): Promise<LeadRow | null> {
  const res = await db.prepare(`SELECT * FROM "Estimate" WHERE "estimateId" = ?`).bind(estimateId).all().catch(() => null);
  const s: any = ((res as any)?.results ?? [])[0];
  if (!s) return null;
  const e: any = await findEnquiry(db, String(s.estimateNumber ?? ''));
  const outcome = outcomeForStatus(s.status);
  return {
    id: `lead-est:${estimateId}`,
    dedupKey: `est:${estimateId}`,
    leadNo: '',
    captureKind: 'sync',
    customerName: String(s.customerName ?? ''),
    clientCompany: String(e?.clientCompany ?? ''),
    contactName: firstNonBlank(e?.contactName, s.contactName),
    contactPhone: firstNonBlank(e?.contactPhone, s.contactPhone),
    contactEmail: firstNonBlank(e?.contactEmail, s.contactEmail),
    location: firstNonBlank(e?.location, s.location),
    region: String(s.region ?? ''),
    assignedAgentId: firstNonBlank(s.assignedTelecallerId, e?.assignedAgentId),
    sourceName: normalizeLeadSource(e?.source, s.sourceLead),
    sourceRaw: firstNonBlank(s.sourceLead, e?.source),
    sourceRef: String(e?.enquiryNumber ?? ''),
    productText: String(e?.title ?? ''),
    productId: '',
    qtyText: '',
    specText: '',
    expectedRateAmount: null,
    expectedRateUnit: '',
    quotedRateAmount: Number(s.total ?? 0) || 0,
    quotedRateUnit: '',
    status: 'qualified',
    outcome,
    qualifiedBy: String(s.createdBy ?? ''),
    qualifiedByRole: '',
    qualifiedAt: String(s.date ?? ''),
    qualifyNote: '',
    disqualifyReason: 'other',
    reasonDetail: '',
    lostAt: outcome === 'lost' ? String(s.declinedAt ?? '') : '',
    wonAt: outcome === 'won' ? String(s.acceptedAt ?? '') : '',
    enquiryId: String(e?.id ?? ''),
    estimateId: String(estimateId),
    estNumber: String(s.estimateNumber ?? ''),
    occurredAt: firstNonBlank(s.declinedAt, s.acceptedAt, s.date, nowIso().slice(0, 10)),
  };
}

async function buildEnquiryLead(db: any, enquiryId: string): Promise<LeadRow | null> {
  const res = await db.prepare(`SELECT * FROM "Enquiry" WHERE "id" = ?`).bind(enquiryId).all().catch(() => null);
  const e: any = ((res as any)?.results ?? [])[0];
  if (!e) return null;
  // Linked enquiries converge via their estimate row (single row per quote).
  const num = String(e.estNumber ?? '').trim();
  if (num) {
    try {
      const sres = await db.prepare(`SELECT "estimateId" FROM "Estimate" WHERE "estimateNumber" = ? LIMIT 1`)
        .bind(num).all().catch(() => null);
      const sid = String(((sres as any)?.results ?? [])[0]?.estimateId ?? '');
      if (sid) return buildEstimateLead(db, sid);
    } catch { /* fall through to orphan shape */ }
  }
  return {
    id: `lead-enq:${enquiryId}`,
    dedupKey: `enq:${enquiryId}`,
    leadNo: '',
    captureKind: 'sync',
    customerName: firstNonBlank(e.contactName, e.clientCompany),
    clientCompany: String(e.clientCompany ?? ''),
    contactName: String(e.contactName ?? ''),
    contactPhone: String(e.contactPhone ?? ''),
    contactEmail: String(e.contactEmail ?? ''),
    location: String(e.location ?? ''),
    region: '',
    assignedAgentId: String(e.assignedAgentId ?? ''),
    sourceName: normalizeLeadSource(e.source, ''),
    sourceRaw: String(e.source ?? ''),
    sourceRef: String(e.enquiryNumber ?? ''),
    productText: String(e.title ?? ''),
    productId: '',
    qtyText: '',
    specText: '',
    expectedRateAmount: null,
    expectedRateUnit: '',
    quotedRateAmount: null,
    quotedRateUnit: '',
    status: 'unqualified',
    outcome: 'open',
    qualifiedBy: '',
    qualifiedByRole: '',
    qualifiedAt: '',
    qualifyNote: '',
    disqualifyReason: 'other',
    reasonDetail: '',
    lostAt: '',
    wonAt: '',
    enquiryId: String(enquiryId),
    estimateId: '',
    estNumber: String(e.estNumber ?? ''),
    occurredAt: String(e.createdAt ?? '').slice(0, 10) || nowIso().slice(0, 10),
  };
}

/** Mirror estimate-backed leads (creates, edits, status transitions, re-homes). */
export async function mirrorLeadsForEstimates(estimateIds: string[]): Promise<void> {
  try {
    const db = getD1Database();
    const ids = [...new Set((estimateIds ?? []).map((s) => String(s ?? '')).filter(Boolean))];
    if (!db || !ids.length) return;
    for (const id of ids) {
      try {
        const row = await buildEstimateLead(db, id);
        if (!row) continue;
        await upsertLeadRow(db, row);
      } catch { /* per-row best-effort */ }
    }
    await writeAudit(ids[0], 'lead-mirror', { ids: ids.length }, 'lead-dual-write: projected estimate leads');
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorLeadsForEstimates failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

/** Mirror enquiry leads (orphans insert; linked converge via their estimate). */
export async function mirrorLeadsForEnquiries(enquiryIds: string[]): Promise<void> {
  try {
    const db = getD1Database();
    const ids = [...new Set((enquiryIds ?? []).map((s) => String(s ?? '')).filter(Boolean))];
    if (!db || !ids.length) return;
    for (const id of ids) {
      try {
        const row = await buildEnquiryLead(db, id);
        if (!row) continue;
        await upsertLeadRow(db, row);
        if (String(row.id ?? '').startsWith('lead-est:')) {
          // Converged via its estimate row — the ai_intake reject (if any) retires.
          await db.prepare(`DELETE FROM "core_lead" WHERE "id" = ?`).bind(`lead-ai:${id}`).run().catch(() => null);
        }
      } catch { /* per-row best-effort */ }
    }
    await writeAudit(ids[0], 'lead-mirror', { ids: ids.length }, 'lead-dual-write: projected enquiry leads');
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorLeadsForEnquiries failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

// ── Phase 7a: lead shadow (counts only, log-only) ────────────────────────────
// Served values NEVER change — the daily-enquiry report + leaderboard keep
// reading Estimate/Enquiry. Three comparisons, one log:
//   A. estimates: live Estimate count vs est-origin core rows.
//   B. declines: live declined vs core qualified/lost.
//   C. orphans: live quoteless enquiries vs core enq-origin unqualified rows.
// Quiet runs leave a heartbeat (zero DIFFs ≠ never ran).

let lastLeadShadowAt = 0;

function hashSig(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export async function shadowCompareLeads(): Promise<void> {
  try {
    const now = Date.now();
    if (now - lastLeadShadowAt < 5 * 60 * 1000) return;
    lastLeadShadowAt = now;
    const db = getD1Database();
    if (!db) return;
    const q = async (sql: string, ...params: any[]): Promise<any[]> => {
      try {
        const r: any = await db.prepare(sql).bind(...params).all();
        return r?.results ?? [];
      } catch { return []; }
    };
    const liveEst = Number((await q(`SELECT COUNT(*) AS "n" FROM "Estimate"`))[0]?.n ?? 0);
    const liveDeclined = Number((await q(
      `SELECT COUNT(*) AS "n" FROM "Estimate" WHERE LOWER(TRIM("status")) = 'declined'`))[0]?.n ?? 0);
    const liveOrphan = Number((await q(
      `SELECT COUNT(*) AS "n" FROM "Enquiry" e WHERE NOT EXISTS (SELECT 1 FROM "Estimate" s WHERE s."estimateNumber" = e."estNumber")`))[0]?.n ?? 0);
    const coreEst = Number((await q(
      `SELECT COUNT(*) AS "n" FROM "core_lead" WHERE "dedupKey" LIKE 'est:%'`))[0]?.n ?? 0);
    const coreLost = Number((await q(
      `SELECT COUNT(*) AS "n" FROM "core_lead" WHERE "status" = 'qualified' AND "outcome" = 'lost'`))[0]?.n ?? 0);
    const coreOrphan = Number((await q(
      `SELECT COUNT(*) AS "n" FROM "core_lead" WHERE "dedupKey" LIKE 'enq:%'`))[0]?.n ?? 0);
    const diffs: string[] = [];
    if (liveEst !== coreEst) diffs.push(`estimates live=${liveEst} core=${coreEst}`);
    if (liveDeclined !== coreLost) diffs.push(`declined live=${liveDeclined} core=${coreLost}`);
    if (liveOrphan !== coreOrphan) diffs.push(`orphans live=${liveOrphan} core=${coreOrphan}`);
    if (!diffs.length) { await shadowHeartbeat('lead-shadow'); return; }
    const sig = hashSig(JSON.stringify(diffs));
    const recent: any[] = await q(
      `SELECT "detail" FROM "core_system_job" WHERE "key" = 'lead-shadow' ORDER BY "startedAt" DESC LIMIT 5`);
    for (const j of recent) {
      try {
        if (JSON.parse(String((j as any)?.detail ?? '{}')).sig === sig) return;
      } catch { /* keep looking */ }
    }
    await db.prepare(
      `INSERT INTO "core_system_job" ("id", "key", "status", "startedAt", "finishedAt", "detail") VALUES (?, 'lead-shadow', 'DIFF', ?, ?, ?)`,
    ).bind(newId(), nowIso(), nowIso(), JSON.stringify({
      sig, diffs,
      live: { estimates: liveEst, declined: liveDeclined, orphans: liveOrphan },
      core: { estimates: coreEst, lost: coreLost, orphans: coreOrphan },
    })).run();
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'shadowCompareLeads failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

// ── Phase 7b: AI-intake reject (all lines Uncategorized, ≥1 line) ───────────
// captureKind='ai_intake', status unqualified, outcome open, reason
// out_of_scope. Idempotent on dedupKey `ai:<enquiryId>`. If the enquiry later
// links to an estimate, the estimate row (`lead-est:`) owns it and this row
// is removed by mirrorLeadsForEnquiries. Never throws.
export async function mirrorAiIntakeReject(enquiryId: string, verbatims: string[]): Promise<void> {
  try {
    const db = getD1Database();
    const eid = String(enquiryId ?? '');
    if (!db || !eid) return;
    const eres: any = await db.prepare(`SELECT * FROM "Enquiry" WHERE "id" = ?`).bind(eid).all().catch(() => null);
    const e: any = ((eres as any)?.results ?? [])[0];
    if (!e) return;
    const num = String(e.estNumber ?? '').trim();
    if (num) {
      try {
        const sres: any = await db.prepare(`SELECT "estimateId" FROM "Estimate" WHERE "estimateNumber" = ? LIMIT 1`).bind(num).all().catch(() => null);
        if (((sres as any)?.results ?? [])[0]?.estimateId) {
          await db.prepare(`DELETE FROM "core_lead" WHERE "id" = ?`).bind(`lead-ai:${eid}`).run().catch(() => null);
          return;
        }
      } catch { /* fall through to insert */ }
    }
    const texts = (verbatims ?? []).map((v) => String(v ?? '').trim()).filter(Boolean);
    if (!texts.length) return; // empty text stays out — human triage via Enquiries
    const now = nowIso();
    const id = `lead-ai:${eid}`;
    await db.prepare(
      `INSERT OR IGNORE INTO "core_lead" ("id", "dedupKey", "leadNo", "captureKind", "customerName", "clientCompany", "contactName", "contactPhone", "contactEmail", "location", "region", "assignedAgentId", "sourceName", "sourceRaw", "sourceRef", "productText", "productId", "qtyText", "specText", "expectedRateAmount", "expectedRateUnit", "quotedRateAmount", "quotedRateUnit", "status", "outcome", "qualifiedBy", "qualifiedByRole", "qualifiedAt", "qualifyNote", "disqualifyReason", "reasonDetail", "lostAt", "wonAt", "enquiryId", "estimateId", "estNumber", "occurredAt", "createdAt", "updatedAt") VALUES (?, ?, '', 'ai_intake', ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, '', '', '', NULL, '', NULL, '', 'unqualified', 'open', '', '', '', '', 'out_of_scope', '', '', '', ?, '', ?, ?, ?, ?)`,
    ).bind(id, `ai:${eid}`,
      firstNonBlank(e.contactName, e.clientCompany), String(e.clientCompany ?? ''),
      String(e.contactName ?? ''), String(e.contactPhone ?? ''), String(e.contactEmail ?? ''),
      String(e.location ?? ''), String(e.assignedAgentId ?? ''),
      normalizeLeadSource(e.source, ''), String(e.source ?? ''), String(e.enquiryNumber ?? ''),
      texts.join(' ‖ ').slice(0, 500),
      eid, num, now.slice(0, 10), now, now).run();
    await db.prepare(`UPDATE "core_lead" SET "productText" = ?, "updatedAt" = ? WHERE "id" = ?`)
      .bind(texts.join(' ‖ ').slice(0, 500), now, id).run();
    await writeAudit(id, 'lead-mirror', { kind: 'ai_intake_reject' }, 'lead-dual-write: all-Uncategorized intake');
  } catch (e: any) {
    try {
      logger.warn({ err: e?.message }, 'mirrorAiIntakeReject failed (non-blocking)');
    } catch { /* never throw */ }
  }
}

// ── Phase 7c: qualification gate (server-enforced) ──────────────────────────
// qualifyLead: unqualified → qualified (outcome untouched). dropLead: open →
// dropped + reason. Callers enforce requireLeadQualifier first; region scoping
// for TLs is enforced HERE (defence in depth — never trust the route alone).

export interface LeadActor {
  name: string;
  role: string;
  regions: string[] | null; // null = all-power (root/MIS/sales-head)
}

function istDay(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  } catch { return new Date().toISOString().slice(0, 10); }
}

export const LEAD_DROP_REASONS = new Set([
  'no_response', 'wrong_number', 'price_too_high', 'no_budget', 'not_genuine',
  'out_of_scope', 'duplicate', 'competitor_won', 'client_cancelled', 'other',
]);

async function loadLeadRow(db: any, id: string): Promise<any | null> {
  try {
    const r: any = await db.prepare(`SELECT * FROM "core_lead" WHERE "id" = ?`).bind(String(id)).all();
    return (r?.results ?? [])[0] ?? null;
  } catch { return null; }
}

export async function qualifyLead(id: string, actor: LeadActor, note: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = getD1Database();
    if (!db) return { ok: false, error: 'unavailable' };
    const row = await loadLeadRow(db, id);
    if (!row) return { ok: false, error: 'no such lead' };
    if (String(row.status ?? '') !== 'unqualified') return { ok: false, error: 'already qualified' };
    if (actor.regions) {
      const lr = String(row.region ?? '');
      if (!lr || !actor.regions.includes(lr)) return { ok: false, error: 'outside your regions' };
    }
    const now = nowIso();
    await db.prepare(
      `UPDATE "core_lead" SET "status" = 'qualified', "qualifiedBy" = ?, "qualifiedByRole" = ?, "qualifiedAt" = ?, "qualifyNote" = ?, "updatedAt" = ? WHERE "id" = ?`,
    ).bind(String(actor.name ?? ''), String(actor.role ?? ''), istDay(), String(note ?? '').slice(0, 500), now, String(id)).run();
    await writeAudit(String(id), 'lead-qualify', { by: actor.name, role: actor.role }, 'lead-gate: TL/head qualified the lead — quotation unlocked');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'qualify failed' };
  }
}

export async function dropLead(id: string, actor: LeadActor, reason: string, detail: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = getD1Database();
    if (!db) return { ok: false, error: 'unavailable' };
    const row = await loadLeadRow(db, id);
    if (!row) return { ok: false, error: 'no such lead' };
    if (String(row.outcome ?? '') !== 'open') return { ok: false, error: 'already closed' };
    const r = String(reason ?? 'other');
    if (!LEAD_DROP_REASONS.has(r)) return { ok: false, error: 'bad reason' };
    if (actor.regions) {
      const lr = String(row.region ?? '');
      if (!lr || !actor.regions.includes(lr)) return { ok: false, error: 'outside your regions' };
    }
    const now = nowIso();
    await db.prepare(
      `UPDATE "core_lead" SET "outcome" = 'dropped', "disqualifyReason" = ?, "reasonDetail" = ?, "updatedAt" = ? WHERE "id" = ?`,
    ).bind(r, String(detail ?? '').slice(0, 500), now, String(id)).run();
    await writeAudit(String(id), 'lead-drop', { by: actor.name, reason: r }, 'lead-gate: lead dropped with reason');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'drop failed' };
  }
}
