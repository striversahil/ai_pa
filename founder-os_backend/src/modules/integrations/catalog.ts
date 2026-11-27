// catalog.ts — the built-in service catalog (one list for the panel + guards).
//
// A built-in connector is code: it knows its own payload (Tally) or ships a
// preset mapping (IndiaMART, TradeIndia). Anything not listed here is added
// from the panel as a CUSTOM connector — a name + a MappingSpec, no deploy.

import type { CatalogEntry } from './types';
import type { MappingSpec } from './mapping';

/** IndiaMART CRM push (lead) — their keys are UPPERCASE. */
const INDIAMART: MappingSpec = {
  eventKind: 'lead',
  fields: {
    externalId: 'UNIQUE_QUERY_ID',
    occurredAt: 'QUERY_TIME',
    title: 'SUBJECT',
    summary: 'QUERY',
    company: 'COMPANY_NAME',
    contactName: 'NAME',
    phone: 'MOBILE',
    email: 'EMAIL',
    city: 'CITY',
  },
};

/** TradeIndia lead push — snake/lowercase keys, `enquiry` is the message. */
const TRADEINDIA: MappingSpec = {
  eventKind: 'lead',
  fields: {
    externalId: 'lead_id',
    occurredAt: 'created_at',
    title: 'subject',
    summary: 'enquiry',
    company: 'company',
    contactName: 'name',
    phone: 'mobile',
    email: 'email',
    city: 'city',
  },
};

/** Neutral guess: what most CRMs call things. The wizard edits this. */
const GENERIC: MappingSpec = {
  eventKind: 'lead',
  fields: {
    externalId: 'id',
    occurredAt: 'created_at',
    title: 'subject',
    summary: 'message',
    company: 'company',
    contactName: 'name',
    phone: 'phone',
    email: 'email',
    city: 'city',
  },
};

export const BUILTIN_CONNECTORS: CatalogEntry[] = [
  {
    key: 'tally',
    name: 'Tally.so forms',
    icon: '📋',
    color: '#111111',
    category: 'Forms',
    authKind: 'webhook',
    status: 'live',
    docs: 'https://tally.so/help/webhooks',
    hint: 'Every form submission arrives signed (HMAC-SHA256) and is stored with its answers.',
    // Tally's payload is normalized by the built-in adapter (fields[] + options).
    mapping: { fields: {} },
    fields: [{ key: 'apiKey', label: 'Tally API key (optional — used to list forms)', secret: true, placeholder: 'tly-…' }],
  },
  {
    key: 'generic',
    name: 'Custom webhook',
    icon: '🔗',
    color: '#0ea5e9',
    category: 'Custom',
    authKind: 'webhook',
    status: 'live',
    hint: 'Any service that can POST JSON. Map its keys to the activity fields yourself.',
    mapping: GENERIC,
  },
  {
    key: 'indiamart',
    name: 'IndiaMART',
    icon: '🛒',
    color: '#e8590c',
    category: 'B2B portal',
    authKind: 'webhook',
    status: 'live',
    docs: 'https://seller.indiamart.com/',
    hint: 'Seller panel → CRM integration → push leads to the URL below. Mapping is preset.',
    mapping: INDIAMART,
  },
  {
    key: 'tradeindia',
    name: 'TradeIndia',
    icon: '🏭',
    color: '#1e6fd9',
    category: 'B2B portal',
    authKind: 'webhook',
    status: 'live',
    docs: 'https://www.tradeindia.com/',
    hint: 'Lead push from the seller panel. Mapping is preset; edit it in the source drawer.',
    mapping: TRADEINDIA,
  },
  {
    key: 'meta',
    name: 'Facebook / Instagram',
    icon: '📣',
    color: '#1877f2',
    category: 'Social',
    authKind: 'oauth2',
    status: 'needs-setup',
    docs: 'https://developers.facebook.com/docs/messenger-platform/webhooks',
    hint: 'Needs a Meta app you own: Page access token + verify token. Nothing is fetched until that exists.',
    mapping: { ...GENERIC, fields: { ...GENERIC.fields, externalId: 'mid', summary: 'message.text' } },
    fields: [
      { key: 'pageId', label: 'Page ID', required: true, placeholder: '1029384756' },
      { key: 'verifyToken', label: 'Webhook verify token', secret: true, required: true },
      { key: 'pageAccessToken', label: 'Page access token', secret: true },
    ],
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    icon: '💬',
    color: '#25d366',
    category: 'Messaging',
    authKind: 'webhook',
    status: 'live',
    native: 'whatsapp',
    hint: 'Already ingested by the WhatsApp pipeline — open the WhatsApp tab. Not duplicated here.',
    mapping: { fields: {} },
  },
];

export function builtinConnector(key: string): CatalogEntry | null {
  return BUILTIN_CONNECTORS.find((c) => c.key === key) ?? null;
}

/** Services the picker offers as one-click "add" (no user-authored type). */
export function addableConnectors(): CatalogEntry[] {
  return BUILTIN_CONNECTORS.filter((c) => !c.native);
}
