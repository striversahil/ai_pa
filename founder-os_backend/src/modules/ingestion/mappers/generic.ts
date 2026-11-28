// generic.ts — ONE mapper driven by the provider's manifest fieldMap.
//
// Portals, forms and social lead pushes all reduce to a lead; chat events
// (Messenger/Instagram DM/Telegram) reduce to a message. A new provider is a
// manifest entry with a fieldMap — not a new file.

import { getProviderManifest } from '../../integrations/gateway/manifest';
import { getPath, normalizeIndianPhone } from '../pure';
import { isoOrNow, text, type Mapper } from './types';
import type { CanonicalLead, CanonicalMessage, MapperResult } from '../types';

type Lookup = Record<string, unknown>;

function lower(obj: Record<string, any> | undefined): Lookup {
  const out: Lookup = {};
  for (const [k, v] of Object.entries(obj ?? {})) out[k.toLowerCase()] = v;
  return out;
}

/** Flatten the shapes portals actually send (flat, data.*, fields[{label,value}]). */
function flatten(payload: Record<string, any>): Lookup {
  const out: Lookup = lower(payload);
  for (const name of ['data', 'lead', 'enquiry', 'payload', 'message']) {
    const nested = payload?.[name];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      Object.assign(out, lower(nested as Record<string, any>));
    }
  }
  const fields = payload?.data?.fields ?? payload?.fields ?? payload?.data?.answers ?? [];
  if (Array.isArray(fields)) {
    for (const field of fields) {
      const label = text(field?.label ?? field?.key ?? field?.name ?? field?.question, 120).toLowerCase();
      if (label) out[label] = field?.value ?? field?.answer ?? field?.values ?? '';
    }
  }
  const entry = payload?.entry?.[0];
  const changeValue = entry?.changes?.[0]?.value;
  if (changeValue && typeof changeValue === 'object') Object.assign(out, lower(changeValue as Record<string, any>));
  return out;
}

function clean(value: unknown): string {
  const raw = text(value, 4000);
  return raw;
}

function valueFor(
  provider: string,
  payload: Record<string, any>,
  lookup: Lookup,
  canonical: string,
  fallbacks: string[],
): string {
  const mapped = getProviderManifest(provider)?.inbound.fieldMap?.[canonical];
  if (mapped) {
    const direct = getPath(payload, mapped);
    if (direct !== undefined && direct !== null && clean(direct)) return clean(direct);
    const flat = lookup[mapped.toLowerCase()];
    if (flat !== undefined && flat !== null && clean(flat)) return clean(flat);
  }
  for (const key of fallbacks) {
    const hit = lookup[key.toLowerCase()];
    if (hit !== undefined && hit !== null && clean(hit)) return clean(hit);
  }
  return '';
}

/** Chat payloads: an event with a sender + text and no phone field. */
function chatMessage(provider: string, payload: Record<string, any>, ctx: Parameters<Mapper>[1]): CanonicalMessage | null {
  const messaging = payload?.entry?.[0]?.messaging?.[0];
  const telegram = payload?.message;
  const sender = text(messaging?.sender?.id ?? telegram?.from?.id, 80);
  const body = text(messaging?.message?.text ?? telegram?.text, 4000);
  if (!messaging && !telegram) return null;
  if (!body && !messaging?.message?.attachments?.length) return null;
  const phoneField = valueFor(provider, payload, flatten(payload), 'phone', ['phone', 'mobile', 'contact']);
  if (phoneField) return null;
  const media = text(messaging?.message?.attachments?.[0]?.payload?.url, 1000);
  return {
    kind: 'message',
    source: ctx.source,
    instanceKey: ctx.instanceKey,
    externalId: text(messaging?.message?.mid ?? telegram?.message_id, 200),
    receivedAt: ctx.receivedAt,
    from: sender,
    to: '',
    contactName: text(telegram?.from?.first_name ?? messaging?.sender?.name, 200),
    text: body,
    mediaUrl: media,
    timestamp: isoOrNow(Number(messaging?.timestamp ?? telegram?.date) * 1000, ctx.receivedAt),
  };
}

export function genericMapper(provider: string): Mapper {
  return (payload, ctx) => {
    const warnings: string[] = [];
    const chat = chatMessage(provider, payload, ctx);
    if (chat) return { message: chat, warnings };

    const lookup = flatten(payload);
    const phone = normalizeIndianPhone(valueFor(provider, payload, lookup, 'phone', ['phone', 'mobile', 'contact_no', 'contact', 'sender_mobile', 'sender_phone']));
    if (!phone) warnings.push('no usable phone — lead will land unassigned');
    const lead: CanonicalLead = {
      kind: 'lead',
      source: ctx.source,
      instanceKey: ctx.instanceKey,
      externalId: text(valueFor(provider, payload, lookup, 'externalId', ['leadid', 'lead_id', 'id', 'event_id', 'responseid', 'response_id']), 200),
      receivedAt: ctx.receivedAt,
      contactName: text(valueFor(provider, payload, lookup, 'name', ['name', 'sender_name', 'contact_name', 'first_name', 'full name']), 200),
      company: text(valueFor(provider, payload, lookup, 'company', ['company', 'company_name', 'sender_company', 'organisation']), 200),
      phone,
      email: text(valueFor(provider, payload, lookup, 'email', ['email', 'sender_email', 'email_address']), 200).toLowerCase(),
      city: text(valueFor(provider, payload, lookup, 'city', ['city', 'sender_city', 'location']), 120),
      state: text(valueFor(provider, payload, lookup, 'state', ['state', 'sender_state', 'province']), 120),
      productInterest: text(valueFor(provider, payload, lookup, 'product', ['product', 'product_name', 'subject', 'category', 'requirement']), 300),
      rawNotes: text(valueFor(provider, payload, lookup, 'message', ['message', 'query', 'enquiry', 'content', 'notes', 'remarks', 'description']), 4000),
      priority: 'medium',
    };
    return { lead, warnings };
  };
}
