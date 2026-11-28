// tally.ts — Tally form submission → lead. Fields arrive as [{label,value}]
// (or a flat object), so labels are normalized before mapping.

import { normalizeIndianPhone } from '../pure';
import { amount, isoOrNow, pick, text, type Mapper } from './types';
import type { CanonicalItem, CanonicalLead, CanonicalEstimate, MapperResult } from '../types';

function fieldMap(payload: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  const fields = payload?.data?.fields ?? payload?.fields ?? [];
  if (Array.isArray(fields)) {
    for (const field of fields) {
      const label = text(field?.label ?? field?.key ?? field?.name, 120).toLowerCase();
      if (label) out[label] = field?.value ?? field?.answer ?? '';
    }
  }
  for (const [k, v] of Object.entries(payload?.data ?? {})) out[String(k).toLowerCase()] = v;
  for (const [k, v] of Object.entries(payload ?? {})) out[String(k).toLowerCase()] = v;
  return out;
}

function value(map: Record<string, any>, keys: string[]): any {
  for (const key of keys) {
    const hit = map[key.toLowerCase()];
    if (hit !== undefined && hit !== null && String(hit).trim() !== '') return hit;
  }
  return '';
}

export const mapTally: Mapper = (payload, ctx) => {
  const map = fieldMap(payload);
  const warnings: string[] = [];
  const externalId = text(
    payload?.data?.responseId ?? payload?.data?.submissionId ?? payload?.eventId ?? value(map, ['response id', 'submission id']),
    200,
  );
  const isEstimate = /estimate|quotation|quote/i.test(
    text(payload?.data?.formName ?? payload?.formName ?? value(map, ['form name']), 200),
  );
  const items: CanonicalItem[] = [];
  const product = text(value(map, ['product', 'product name', 'item', 'requirement']), 300);
  const qty = text(value(map, ['quantity', 'qty']), 60);
  if (product || qty) items.push({ name: product || 'Requirement', qty: qty || '1', spec: text(value(map, ['specification', 'spec']), 500) });
  if (isEstimate) {
    const estimate: CanonicalEstimate = {
      kind: 'estimate',
      source: ctx.source,
      instanceKey: ctx.instanceKey,
      externalId,
      receivedAt: ctx.receivedAt,
      estimateNumber: text(value(map, ['estimate number', 'est no', 'estimate no']), 80),
      status: text(value(map, ['status']), 60) || 'draft',
      customerName: text(value(map, ['customer', 'customer name', 'client', 'name']), 200),
      organizationId: '',
      total: amount(value(map, ['total', 'amount', 'value'])),
      date: isoOrNow(value(map, ['date', 'estimate date']), ctx.receivedAt),
      items,
      comments: [],
    };
    return { estimate, warnings };
  }
  const phone = normalizeIndianPhone(value(map, ['phone', 'mobile', 'contact', 'whatsapp']));
  if (!phone) warnings.push('tally submission has no usable phone');
  const lead: CanonicalLead = {
    kind: 'lead',
    source: ctx.source,
    instanceKey: ctx.instanceKey,
    externalId,
    receivedAt: ctx.receivedAt,
    contactName: text(value(map, ['name', 'contact name', 'full name']), 200),
    company: text(value(map, ['company', 'company name', 'organisation', 'organization']), 200),
    phone,
    email: text(value(map, ['email', 'email address']), 200).toLowerCase(),
    city: text(value(map, ['city', 'location']), 120),
    state: text(value(map, ['state']), 120),
    productInterest: product,
    rawNotes: text(value(map, ['message', 'notes', 'requirement', 'remarks']), 4000),
    priority: 'medium',
  };
  return { lead, warnings };
};
