// b2b-portals.ts — TradeIndia / Justdial / Alibaba lead shapes. All three
// push a flat-ish inquiry object; only the field names differ.

import { normalizeIndianPhone } from '../pure';
import { amount, isoOrNow, pick, pickDeep, text, type Mapper, type MapperContext } from './types';
import type { CanonicalLead, MapperResult } from '../types';

function lead(ctx: MapperContext, values: Partial<CanonicalLead>, notes: string): MapperResult {
  const phone = normalizeIndianPhone(values.phone);
  const warnings: string[] = [];
  if (!phone) warnings.push('no usable phone — lead will land unassigned with an empty contact');
  const canonical: CanonicalLead = {
    kind: 'lead',
    source: ctx.source,
    instanceKey: ctx.instanceKey,
    externalId: text(values.externalId, 200),
    receivedAt: ctx.receivedAt,
    contactName: text(values.contactName, 200),
    company: text(values.company, 200),
    phone,
    email: text(values.email, 200).toLowerCase(),
    city: text(values.city, 120),
    state: text(values.state, 120),
    productInterest: text(values.productInterest, 300),
    rawNotes: text(notes, 4000),
    priority: values.priority === 'high' ? 'high' : 'medium',
  };
  return { lead: canonical, warnings };
}

export const mapTradeindia: Mapper = (payload, ctx) => {
  const id = pickDeep(payload, ['rfi_id', 'rfiid', 'query_id', 'enquiry_id', 'id']);
  return lead(ctx, {
    externalId: id,
    contactName: pickDeep(payload, ['sender_name', 'name', 'contact_person', 'buyer_name']),
    company: pickDeep(payload, ['sender_company', 'company_name', 'company']),
    phone: pickDeep(payload, ['sender_mobile', 'mobile', 'phone', 'contact_no', 'sender_phone']),
    email: pickDeep(payload, ['sender_email', 'email', 'contact_email']),
    city: pickDeep(payload, ['sender_city', 'city']),
    state: pickDeep(payload, ['sender_state', 'state']),
    productInterest: pickDeep(payload, ['subject', 'product_name', 'category', 'enquiry_subject']),
    priority: pickDeep(payload, ['priority']) === 'high' ? 'high' : 'medium',
  }, pickDeep(payload, ['enquiry', 'message', 'requirement', 'description', 'query']));
};

export const mapJustdial: Mapper = (payload, ctx) => {
  const id = pickDeep(payload, ['leadid', 'lead_id', 'id', 'query_id']);
  return lead(ctx, {
    externalId: id,
    contactName: pickDeep(payload, ['name', 'contact_name', 'consumer_name']),
    company: pickDeep(payload, ['company', 'company_name']),
    phone: pickDeep(payload, ['mobile', 'phone', 'contact_no', 'number']),
    email: pickDeep(payload, ['email', 'email_id']),
    city: pickDeep(payload, ['city', 'area']),
    state: pickDeep(payload, ['state']),
    productInterest: pickDeep(payload, ['category', 'service', 'query', 'product']),
    priority: pickDeep(payload, ['lead_type', 'priority']) === 'high' ? 'high' : 'medium',
  }, pickDeep(payload, ['query', 'message', 'description', 'remark']));
};

export const mapAlibaba: Mapper = (payload, ctx) => {
  const id = pickDeep(payload, ['requestid', 'request_id', 'inquiry_id', 'id']);
  const qty = text(pickDeep(payload, ['quantity', 'qty']), 60);
  const product = text(pickDeep(payload, ['product_name', 'subject', 'product']), 300);
  const notes = [
    text(pickDeep(payload, ['content', 'message', 'inquiry_content', 'description']), 3000),
    qty ? `Quantity: ${qty}` : '',
  ].filter(Boolean).join('\n');
  return lead(ctx, {
    externalId: id,
    contactName: pickDeep(payload, ['contactname', 'contact_name', 'buyer_name', 'name']),
    company: pickDeep(payload, ['companyname', 'company_name', 'company']),
    phone: pickDeep(payload, ['phone', 'mobile', 'telephone', 'contact_phone']),
    email: pickDeep(payload, ['email', 'contact_email']),
    city: pickDeep(payload, ['city']),
    state: pickDeep(payload, ['province', 'state']),
    productInterest: product,
    priority: amount(pickDeep(payload, ['order_amount', 'amount'])) > 0 ? 'high' : 'medium',
  }, notes);
};
