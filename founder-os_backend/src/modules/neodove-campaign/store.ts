// store.ts — D1 persistence for NeoDove campaign pushes.
//
// Raw SQL (no Prisma shim): the Customer Master module already owns that
// pattern and this table set is Worker-only. MasterCustomer is READ ONLY here.

import { getD1Database } from '../../shared/prisma-d1';
import type {
  AgentTally, AssignedLead, CampaignAgent, Distribution, PushBatch, PushMode, PushStatus, SkippedLead,
} from './types';

export function campaignDb(): any {
  return getD1Database();
}

// ── Agents ─────────────────────────────────────────────────────────────────

const AGENT_COLUMNS = ['id', 'region', 'name', 'secretName', 'active', 'campaignUrl'].join(', ');

/**
 * Agents for a region. Includes inactive rows on purpose: a batch created
 * before an agent was disabled must still be able to finish sending its
 * pending leads. Callers filter on `active` when building a NEW push.
 *
 * `campaignUrl` (DB override, set from the Controller) is server-only — it is
 * never sent to the client. The `states` endpoint only exposes which source
 * is effective (db | secret | none) plus the configured flag.
 */
export async function listAgents(region: string): Promise<Array<CampaignAgent & { secretName: string; campaignUrl: string }>> {
  const db = campaignDb();
  if (!db) return [];
  try {
    const res = await db
      .prepare(`SELECT ${AGENT_COLUMNS} FROM NeoDoveAgent WHERE region = ? ORDER BY id`)
      .bind(region)
      .all();
    return ((res?.results ?? []) as any[]).map((row) => ({
      key: String(row?.id ?? ''),
      region: String(row?.region ?? ''),
      name: String(row?.name ?? ''),
      secretName: String(row?.secretName ?? ''),
      active: Number(row?.active ?? 0) === 1,
      configured: false,
      source: 'none' as const,
      campaignUrl: String(row?.campaignUrl ?? ''),
    }));
  } catch {
    // Table not applied yet — behave like "no agents configured".
    return [];
  }
}

/** Fetch one agent row by stable key (any region). Null when unknown. */
export async function getAgentRow(key: string): Promise<{ key: string; region: string; name: string; active: boolean } | null> {
  const db = campaignDb();
  if (!db) return null;
  const row: any = await db
    .prepare(`SELECT id, region, name, active FROM NeoDoveAgent WHERE id = ?`)
    .bind(String(key ?? '').trim())
    .first()
    .catch(() => null);
  if (!row?.id) return null;
  return {
    key: String(row.id),
    region: String(row.region ?? ''),
    name: String(row.name ?? ''),
    active: Number(row.active ?? 0) === 1,
  };
}

/**
 * Map (or clear) an agent's DB campaign URL. Empty string clears the override
 * so the Worker secret becomes effective again. Never logs or returns the URL.
 */
export async function setAgentUrl(key: string, url: string): Promise<void> {
  const db = campaignDb();
  if (!db) throw new Error('database unavailable');
  await db
    .prepare(`UPDATE NeoDoveAgent SET campaignUrl = ? WHERE id = ?`)
    .bind(String(url ?? ''), String(key ?? '').trim())
    .run();
}

/** Per-agent tallies for a batch, derived from the lead ledger. */
export async function agentTallies(batchId: string): Promise<AgentTally[]> {
  const db = campaignDb();
  if (!db) return [];
  try {
    const res = await db
      .prepare(
        `SELECT agentKey, status, COUNT(*) AS n
           FROM NeoDoveLeadPush
          WHERE batchId = ?
          GROUP BY agentKey, status`,
      )
      .bind(batchId)
      .all();
    const byAgent = new Map<string, AgentTally>();
    for (const row of ((res?.results ?? []) as any[])) {
      const key = String(row?.agentKey ?? '');
      if (!key) continue;
      let entry = byAgent.get(key);
      if (!entry) {
        entry = { agentKey: key, name: '', planned: 0, sent: 0, failed: 0, skipped: 0, pending: 0 };
        byAgent.set(key, entry);
      }
      const n = Number(row?.n ?? 0);
      const status = String(row?.status ?? '');
      if (status === 'sent') entry.sent += n;
      else if (status === 'failed') entry.failed += n;
      else if (status === 'skipped') entry.skipped += n;
      // `sending` is claimed-but-unfinished: still outstanding work.
      else if (status === 'pending' || status === 'sending') entry.pending += n;
      entry.planned += n;
    }
    return [...byAgent.values()].sort((a, b) => a.agentKey.localeCompare(b.agentKey));
  } catch {
    return [];
  }
}

/** Customer columns the selector needs — no addresses, no notes. */
const CUSTOMER_COLUMNS = [
  'id', 'zohoCustomerId', 'region', 'state',
  'companyName', 'displayName', 'contactPerson', 'phonesJson', 'emailsJson',
].join(', ');

/** Every customer row for one region + state (bounded by the master's size). */
export async function listCustomersByState(region: string, state: string): Promise<any[]> {
  const db = campaignDb();
  if (!db) return [];
  const res = await db
    .prepare(`SELECT ${CUSTOMER_COLUMNS} FROM MasterCustomer WHERE region = ? AND state = ? ORDER BY id`)
    .bind(region, state)
    .all();
  return (res?.results ?? []) as any[];
}

/** Region-scoped state list with phone coverage — the dropdown's source. */
export async function listStateCounts(region: string): Promise<Array<{ state: string; total: number; withPhone: number }>> {
  const db = campaignDb();
  if (!db) return [];
  const res = await db
    .prepare(
      `SELECT state,
              COUNT(*) AS total,
              SUM(CASE WHEN phonesJson NOT IN ('[]', '') AND phonesJson IS NOT NULL THEN 1 ELSE 0 END) AS withPhone
         FROM MasterCustomer
        WHERE region = ?
        GROUP BY state
        ORDER BY total DESC, state ASC`,
    )
    .bind(region)
    .all();
  return ((res?.results ?? []) as any[]).map((r) => ({
    state: String(r?.state ?? ''),
    total: Number(r?.total ?? 0),
    withPhone: Number(r?.withPhone ?? 0),
  }));
}

/** Last completed LIVE push per state — the "this will duplicate" warning. */
export async function lastLivePushes(region: string): Promise<Map<string, { at: string; count: number }>> {
  const db = campaignDb();
  const out = new Map<string, { at: string; count: number }>();
  if (!db) return out;
  try {
    const res = await db
      .prepare(
        `SELECT state, MAX(finishedAt) AS at, SUM(sent) AS sent
           FROM NeoDovePushBatch
          WHERE region = ? AND mode = 'live' AND status = 'done'
          GROUP BY state`,
      )
      .bind(region)
      .all();
    for (const row of ((res?.results ?? []) as any[])) {
      const state = String(row?.state ?? '');
      if (!state) continue;
      out.set(state, { at: String(row?.at ?? ''), count: Number(row?.sent ?? 0) });
    }
  } catch {
    // Fresh DB without the ledger table — the UI simply shows no history.
  }
  return out;
}

// ── Batches ────────────────────────────────────────────────────────────────

const BATCH_COLUMNS = [
  'id', 'region', 'state', 'mode', 'status', 'total', 'planned', 'sent', 'failed', 'skipped', 'pending',
  'distribution', 'agentKey',
  'requestedBy', 'requestedByName', 'campaignHost', 'detail1', 'error',
  'createdAt', 'updatedAt', 'finishedAt',
].join(', ');

function toBatch(row: any): PushBatch {
  return {
    id: String(row?.id ?? ''),
    region: String(row?.region ?? ''),
    state: String(row?.state ?? ''),
    mode: (String(row?.mode ?? 'dry-run') as PushMode),
    status: (String(row?.status ?? 'queued') as PushStatus),
    total: Number(row?.total ?? 0),
    planned: Number(row?.planned ?? 0),
    sent: Number(row?.sent ?? 0),
    failed: Number(row?.failed ?? 0),
    skipped: Number(row?.skipped ?? 0),
    pending: Number(row?.pending ?? 0),
    distribution: (String(row?.distribution ?? '') as Distribution) || 'split',
    agentKey: String(row?.agentKey ?? ''),
    requestedBy: String(row?.requestedBy ?? ''),
    requestedByName: String(row?.requestedByName ?? ''),
    campaignHost: String(row?.campaignHost ?? ''),
    detail1: String(row?.detail1 ?? ''),
    error: row?.error == null ? null : String(row.error),
    createdAt: String(row?.createdAt ?? ''),
    updatedAt: String(row?.updatedAt ?? ''),
    finishedAt: row?.finishedAt == null ? null : String(row.finishedAt),
  };
}

export async function insertBatch(batch: PushBatch): Promise<void> {
  const db = campaignDb();
  if (!db) throw new Error('database unavailable');
  await db
    .prepare(
      `INSERT INTO NeoDovePushBatch (${BATCH_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      batch.id, batch.region, batch.state, batch.mode, batch.status,
      batch.total, batch.planned, batch.sent, batch.failed, batch.skipped, batch.pending,
      batch.distribution, batch.agentKey,
      batch.requestedBy, batch.requestedByName, batch.campaignHost, batch.detail1, batch.error,
      batch.createdAt, batch.updatedAt, batch.finishedAt,
    )
    .run();
}

export async function getBatch(id: string): Promise<PushBatch | null> {
  const db = campaignDb();
  if (!db) return null;
  const row = await db.prepare(`SELECT ${BATCH_COLUMNS} FROM NeoDovePushBatch WHERE id = ?`).bind(id).first();
  return row ? toBatch(row) : null;
}

const PATCHABLE = new Set([
  'status', 'mode', 'total', 'sent', 'failed', 'skipped', 'pending', 'error', 'updatedAt', 'finishedAt',
]);

export async function updateBatch(id: string, patch: Record<string, unknown>): Promise<void> {
  const db = campaignDb();
  if (!db) return;
  const keys = Object.keys(patch).filter((k) => PATCHABLE.has(k));
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  await db.prepare(`UPDATE NeoDovePushBatch SET ${sets} WHERE id = ?`)
    .bind(...keys.map((k) => patch[k] as any), id)
    .run();
}

/** Recompute the batch tallies from the ledger (single source of truth). */
export async function recountBatch(id: string): Promise<PushBatch | null> {
  const db = campaignDb();
  if (!db) return null;
  const res = await db
    .prepare(`SELECT status, COUNT(*) AS n FROM NeoDoveLeadPush WHERE batchId = ? GROUP BY status`)
    .bind(id)
    .all();
  const counts: Record<string, number> = {};
  for (const row of ((res?.results ?? []) as any[])) counts[String(row?.status ?? '')] = Number(row?.n ?? 0);
  const sent = counts.sent ?? 0;
  const failed = counts.failed ?? 0;
  const skipped = counts.skipped ?? 0;
  // Rows claimed but not yet marked still count as outstanding work — without
  // this a batch could be declared done mid-chunk.
  const pending = (counts.pending ?? 0) + (counts.sending ?? 0);
  const total = sent + failed + skipped + pending;
  await updateBatch(id, {
    sent, failed, skipped, pending, total, updatedAt: new Date().toISOString(),
  });
  return getBatch(id);
}

export async function listBatches(region: string, limit = 20): Promise<PushBatch[]> {
  const db = campaignDb();
  if (!db) return [];
  const res = region
    ? await db.prepare(`SELECT ${BATCH_COLUMNS} FROM NeoDovePushBatch WHERE region = ? ORDER BY createdAt DESC LIMIT ?`).bind(region, limit).all()
    : await db.prepare(`SELECT ${BATCH_COLUMNS} FROM NeoDovePushBatch ORDER BY createdAt DESC LIMIT ?`).bind(limit).all();
  return ((res?.results ?? []) as any[]).map(toBatch);
}

// ── Leads ──────────────────────────────────────────────────────────────────

const LEAD_COLUMNS = [
  'id', 'batchId', 'customerId', 'zohoCustomerId', 'region', 'state',
  'mobile', 'name', 'email', 'status', 'skipReason', 'agentKey', 'createdAt',
].join(', ');

// D1 caps bound parameters per statement (100); 13 columns × 7 rows = 91.
const INSERT_CHUNK = 7;

export async function insertLeadRows(
  batchId: string,
  region: string,
  state: string,
  leads: AssignedLead[],
  skipped: SkippedLead[],
  dryRun: boolean,
): Promise<void> {
  const db = campaignDb();
  if (!db) throw new Error('database unavailable');
  const now = new Date().toISOString();
  type Row = (string | null)[];
  const rows: Row[] = [];

  for (const { lead, agentKey } of leads) {
    rows.push([
      `${batchId}:${lead.customerId}`, batchId, lead.customerId, lead.zohoCustomerId, region, state,
      lead.mobile, lead.name, lead.email,
      // A dry run resolves and validates everything, but is terminal immediately.
      dryRun ? 'skipped' : 'pending',
      dryRun ? 'dry_run' : null,
      agentKey,
      now,
    ]);
  }
  for (const skip of skipped) {
    rows.push([
      `${batchId}:${skip.customerId}`, batchId, skip.customerId, '', region, state,
      '', skip.name, '', 'skipped', skip.reason, '', now,
    ]);
  }

  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values: any[] = [];
    for (const row of chunk) values.push(...row);
    await db
      .prepare(`INSERT INTO NeoDoveLeadPush (${LEAD_COLUMNS}) VALUES ${placeholders}`)
      .bind(...values)
      .run();
  }
}

/** Recycle claims a dead runner left behind (tab closed mid-chunk). */
export async function recoverStuckClaims(batchId: string, ageMs = 5 * 60_000): Promise<number> {
  const db = campaignDb();
  if (!db) return 0;
  const cutoff = new Date(Date.now() - ageMs).toISOString();
  try {
    const res = await db
      .prepare(
        `UPDATE NeoDoveLeadPush
            SET status = 'pending', claimedAt = NULL
          WHERE batchId = ? AND status = 'sending' AND (claimedAt IS NULL OR claimedAt < ?)`,
      )
      .bind(batchId, cutoff)
      .run();
    return Number(res?.meta?.changes ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Atomically claim the next chunk. Two runners (the browser loop and the cron
 * drain) must never send the same lead — the UPDATE is the lock, and the
 * re-select only returns rows this call actually claimed.
 */
export async function claimPending(batchId: string, limit: number): Promise<any[]> {
  const db = campaignDb();
  if (!db) return [];
  const claimedAt = new Date().toISOString();
  const candidates = await db
    .prepare(
      `SELECT id FROM NeoDoveLeadPush
        WHERE batchId = ? AND status = 'pending'
        ORDER BY id
        LIMIT ?`,
    )
    .bind(batchId, limit)
    .all();
  const ids = ((candidates?.results ?? []) as any[]).map((r) => String(r?.id ?? '')).filter(Boolean);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  try {
    await db
      .prepare(
        `UPDATE NeoDoveLeadPush SET status = 'sending', claimedAt = ?
          WHERE id IN (${placeholders}) AND status = 'pending'`,
      )
      .bind(claimedAt, ...ids)
      .run();
  } catch {
    return [];
  }
  const mine = await db
    .prepare(
      `SELECT id, customerId, mobile, name, email, agentKey
         FROM NeoDoveLeadPush
        WHERE id IN (${placeholders}) AND status = 'sending' AND claimedAt = ?`,
    )
    .bind(...ids, claimedAt)
    .all();
  return (mine?.results ?? []) as any[];
}

export interface LeadOutcome {
  id: string;
  ok: boolean;
  httpStatus: number | null;
  body: string;
}

/** Record a whole chunk in one D1 batch (one subrequest, not N). */
export async function markOutcomes(outcomes: LeadOutcome[]): Promise<void> {
  const db = campaignDb();
  if (!db || outcomes.length === 0) return;
  const now = new Date().toISOString();
  const statements = outcomes.map((outcome) => {
    if (outcome.ok) {
      return db
        .prepare(
          `UPDATE NeoDoveLeadPush
              SET status = 'sent', httpStatus = ?, responseText = ?, attempts = attempts + 1,
                  pushedAt = ?, skipReason = NULL
            WHERE id = ?`,
        )
        .bind(outcome.httpStatus ?? 200, outcome.body.slice(0, 500), now, outcome.id);
    }
    return db
      .prepare(
        `UPDATE NeoDoveLeadPush
            SET status = 'failed', httpStatus = ?, responseText = ?, attempts = attempts + 1
          WHERE id = ?`,
      )
      .bind(outcome.httpStatus, outcome.body.slice(0, 500), outcome.id);
  });
  if (typeof db.batch === 'function') {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) await statement.run();
}

export async function listFailedLeads(batchId: string, limit = 50): Promise<any[]> {
  const db = campaignDb();
  if (!db) return [];
  const res = await db
    .prepare(
      `SELECT name, mobile, httpStatus, responseText
         FROM NeoDoveLeadPush
        WHERE batchId = ? AND status = 'failed'
        ORDER BY id
        LIMIT ?`,
    )
    .bind(batchId, limit)
    .all();
  return (res?.results ?? []) as any[];
}

/** Batches with work left — the cron drain's queue. */
export async function batchesWithPending(limit = 3): Promise<string[]> {
  const db = campaignDb();
  if (!db) return [];
  try {
    const res = await db
      .prepare(
        `SELECT id FROM NeoDovePushBatch
          WHERE status IN ('queued', 'running') AND pending > 0
          ORDER BY createdAt
          LIMIT ?`,
      )
      .bind(limit)
      .all();
    return ((res?.results ?? []) as any[]).map((r) => String(r?.id ?? '')).filter(Boolean);
  } catch {
    return [];
  }
}
