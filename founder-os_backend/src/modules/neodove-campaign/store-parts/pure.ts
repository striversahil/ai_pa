// Extracted verbatim from store.ts by scripts/refactor/split-module.mjs.
// store.ts re-exports everything public here, so existing imports keep working.
import type { PushBatch, PushMode, PushStatus, Distribution } from "../types";

// ── Agents ─────────────────────────────────────────────────────────────────

export const AGENT_COLUMNS = ['id', 'region', 'name', 'secretName', 'active', 'campaignUrl', 'kind'].join(', ');

/** Customer columns the selector needs — no addresses, no notes. */
/** Live-book predicate (mirrors master-data/store LIVE_WHERE): tombstones
 *  (`status='DELETED'`) are never pushed, counted, or listed. */
export const LIVE_CUSTOMER_WHERE = `(status IS NULL OR status <> 'DELETED')`;

export const CUSTOMER_COLUMNS = [
  'id', 'zohoCustomerId', 'region', 'state', 'district',
  'companyName', 'displayName', 'contactPerson', 'phonesJson', 'emailsJson',
  'customerTypeBase',
].join(', ');

// ── Batches ────────────────────────────────────────────────────────────────

export const BATCH_COLUMNS = [
  'id', 'region', 'state', 'district', 'clientType', 'mode', 'status', 'total', 'planned', 'sent', 'failed', 'skipped', 'pending',
  'distribution', 'agentKey',
  'requestedBy', 'requestedByName', 'campaignHost', 'detail1', 'error',
  'createdAt', 'updatedAt', 'finishedAt',
].join(', ');

export function toBatch(row: any): PushBatch {
  return {
    id: String(row?.id ?? ''),
    region: String(row?.region ?? ''),
    state: String(row?.state ?? ''),
    district: String(row?.district ?? ''),
    clientType: String(row?.clientType ?? ''),
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

export const PATCHABLE = new Set([
  'status', 'mode', 'total', 'sent', 'failed', 'skipped', 'pending', 'error', 'updatedAt', 'finishedAt',
]);

// ── Leads ──────────────────────────────────────────────────────────────────

export const LEAD_COLUMNS = [
  'id', 'batchId', 'customerId', 'zohoCustomerId', 'region', 'state',
  'mobile', 'name', 'email', 'status', 'skipReason', 'agentKey', 'createdAt',
].join(', ');

// D1 caps bound parameters per statement (100); 13 columns × 7 rows = 91.
export const INSERT_CHUNK = 7;
