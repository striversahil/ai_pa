// zoho-estimate.ts — Zoho Books estimate payload (webhook or poller row).
// Accepts both the raw shape and an already-canonical one (idempotent).

import { amount, isoOrNow, pick, text, type Mapper } from './types';
import type { CanonicalEstimate, CanonicalItem, MapperResult } from '../types';

export const mapZohoEstimate: Mapper = (payload, ctx) => {
  const est = payload?.estimate ?? payload ?? {};
  const estimateId = text(est.estimate_id ?? est.estimateId ?? payload?.estimate_id, 120);
  const stamp = text(est.last_modified_time ?? est.lastModifiedTime ?? payload?.last_modified_time, 80);
  const estimateNumber = text(est.estimate_number ?? est.estimateNumber, 80);
  const externalId = estimateId ? (stamp ? `${estimateId}:${stamp}` : estimateId) : estimateNumber;
  const warnings: string[] = [];
  if (!estimateNumber && !estimateId) warnings.push('zoho payload has neither estimate_id nor estimate_number');

  const rawItems = Array.isArray(est.line_items) ? est.line_items : [];
  const items: CanonicalItem[] = rawItems.map((item: any) => ({
    name: text(item?.name ?? item?.item_name, 300),
    qty: text(item?.quantity ?? item?.qty, 60) || '1',
    spec: text(item?.description ?? item?.spec, 500),
    rate: amount(item?.rate),
    amount: amount(item?.item_total ?? item?.amount),
  }));

  const rawComments = Array.isArray(payload?.comments) ? payload.comments : [];
  const comments = rawComments.map((c: any) => ({
    author: text(c?.comment_by ?? c?.author ?? c?.created_by, 120),
    body: text(c?.description ?? c?.comment ?? c?.body, 4000),
    at: isoOrNow(c?.time ?? c?.created_time ?? c?.date, ctx.receivedAt),
  }));

  const estimate: CanonicalEstimate = {
    kind: 'estimate',
    source: ctx.source,
    instanceKey: ctx.instanceKey,
    externalId,
    receivedAt: ctx.receivedAt,
    estimateNumber,
    status: text(est.status, 60) || 'draft',
    customerName: text(est.customer_name ?? est.customerName, 200),
    organizationId: text(est.organization_id ?? est.organizationId, 60),
    total: amount(est.total),
    date: isoOrNow(est.date, ctx.receivedAt),
    items,
    comments,
  };
  return { estimate, warnings };
};
