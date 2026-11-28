// whatsapp.ts — Meta Cloud webhook → ONE inbound message. Delivery-status
// callbacks carry no content: they are acknowledged without a canonical row.

import { normalizeIndianPhone } from '../pure';
import { isoOrNow, pick, text, type Mapper } from './types';
import type { CanonicalMessage, MapperResult } from '../types';

function mediaRef(message: any): string {
  for (const kind of ['image', 'video', 'audio', 'document', 'sticker']) {
    const id = message?.[kind]?.id;
    if (id) return `${kind}:${id}`;
  }
  return '';
}

export const mapWhatsApp: Mapper = (payload, ctx) => {
  const value = payload?.entry?.[0]?.changes?.[0]?.value ?? {};
  const message = value?.messages?.[0];
  const warnings: string[] = [];
  if (!message) {
    if (value?.statuses?.length) return { warnings: ['delivery-status callback (no message)'] };
    return { warnings: ['whatsapp payload carries no message'] };
  }
  const body =
    text(message?.text?.body, 4000) ||
    text(message?.button?.text, 1000) ||
    text(message?.interactive?.button_reply?.title ?? message?.interactive?.list_reply?.title, 1000) ||
    text(message?.image?.caption ?? message?.video?.caption ?? message?.document?.caption, 4000);
  const fromRaw = text(message?.from, 40);
  const phone = normalizeIndianPhone(fromRaw);
  if (!phone) warnings.push('sender is not a usable Indian number — kept raw');
  const contact = value?.contacts?.[0];
  const canonical: CanonicalMessage = {
    kind: 'message',
    source: ctx.source,
    instanceKey: ctx.instanceKey,
    externalId: text(message?.id, 200),
    receivedAt: ctx.receivedAt,
    from: phone || fromRaw,
    to: text(value?.metadata?.display_phone_number, 40),
    contactName: text(contact?.profile?.name ?? value?.contacts?.[0]?.wa_id, 200),
    text: body,
    mediaUrl: mediaRef(message),
    timestamp: isoOrNow(Number(message?.timestamp) * 1000, ctx.receivedAt),
  };
  return { message: canonical, warnings };
};

/** Custom/generic lead payload: the long tail without a dedicated mapper. */
export const mapCustomLead: Mapper = (payload, ctx) => {
  const phone = normalizeIndianPhone(pick(payload, ['phone', 'mobile', 'contact', 'contactPhone']));
  const warnings: string[] = [];
  if (!phone) warnings.push('custom payload has no usable phone');
  return {
    lead: {
      kind: 'lead',
      source: ctx.source,
      instanceKey: ctx.instanceKey,
      externalId: text(pick(payload, ['id', 'event_id', 'externalId', 'reference']), 200),
      receivedAt: ctx.receivedAt,
      contactName: text(pick(payload, ['name', 'contactName', 'contact_name']), 200),
      company: text(pick(payload, ['company', 'companyName', 'company_name']), 200),
      phone,
      email: text(pick(payload, ['email', 'contactEmail']), 200).toLowerCase(),
      city: text(pick(payload, ['city', 'location']), 120),
      state: text(pick(payload, ['state']), 120),
      productInterest: text(pick(payload, ['product', 'interest', 'requirement', 'subject']), 300),
      rawNotes: text(pick(payload, ['notes', 'message', 'description', 'enquiry']), 4000),
      priority: 'medium',
    },
    warnings,
  };
};
