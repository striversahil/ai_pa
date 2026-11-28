// pure.ts — column lists + row mapping for the Customer push store.
import type { PushBatch, PushMode, PushStatus, PushTarget, Distribution } from '../types';

/** Live-book predicate (mirrors master-data/store): tombstones are never pushed. */
export const LIVE_CUSTOMER_WHERE = `(status IS NULL OR status <> 'DELETED')`;

/** Customer columns the selector needs — no addresses, no notes. */
export const CUSTOMER_COLUMNS = [
  'id', 'zohoCustomerId', 'region', 'state', 'district',
  'companyName', 'displayName', 'contactPerson', 'phonesJson', 'emailsJson',
  'customerTypeBase',
].join(', ');

export const BATCH_COLUMNS = [
  'id', 'region', 'state', 'district', 'clientType', 'mode', 'status', 'total', 'planned', 'sent', 'failed', 'skipped', 'pending',
  'distribution', 'agentKey',
  'requestedBy', 'requestedByName', 'campaignHost', 'detail1', 'error',
  'createdAt', 'updatedAt', 'finishedAt', 'target',
].join(', ');

export function toBatch(row: any): PushBatch {
  return {
    id: String(row?.id ?? ''),
    region: String(row?.region ?? ''),
    state: String(row?.state ?? ''),
    district: String(row?.district ?? ''),
    clientType: String(row?.clientType ?? ''),
    mode: (String(row?.mode ?? 'live') as PushMode),
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
    target: (String(row?.target ?? '') === 'neodove' ? 'neodove' : 'dialer') as PushTarget,
  };
}

export const PATCHABLE = new Set([
  'status', 'mode', 'total', 'sent', 'failed', 'skipped', 'pending', 'error', 'updatedAt', 'finishedAt',
]);

export const LEAD_COLUMNS = [
  'id', 'batchId', 'customerId', 'zohoCustomerId', 'region', 'state',
  'mobile', 'name', 'email', 'status', 'skipReason', 'agentKey', 'createdAt',
].join(', ');

// D1 caps bound parameters per statement (100); 13 columns × 7 rows = 91.
export const INSERT_CHUNK = 7;
