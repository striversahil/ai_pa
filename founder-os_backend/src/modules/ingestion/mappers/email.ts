// email.ts — Gmail push/poll payload → lead. The body is decoded from the
// message payload when Gmail returns one; the subject is the product line.

import { normalizeIndianPhone } from '../pure';
import { text, type Mapper } from './types';
import type { CanonicalLead, MapperResult } from '../types';

function header(payload: Record<string, any>, name: string): string {
  const headers = payload?.payload?.headers ?? [];
  if (!Array.isArray(headers)) return '';
  const hit = headers.find((h: any) => String(h?.name ?? '').toLowerCase() === name.toLowerCase());
  return text(hit?.value, 500);
}

function bodyText(payload: Record<string, any>): string {
  const direct = payload?.snippet;
  if (direct) return text(direct, 4000);
  const data = payload?.payload?.body?.data;
  if (!data) return '';
  try {
    const bin = atob(String(data).replace(/-/g, '+').replace(/_/g, '/'));
    return text(bin, 4000);
  } catch {
    return '';
  }
}

export const mapGmail: Mapper = (payload, ctx) => {
  const warnings: string[] = [];
  const from = header(payload, 'From');
  const match = from.match(/<?([^<>\s]+@[^<>\s]+)>?/);
  const email = match ? match[1].toLowerCase() : '';
  const name = from.replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  const phone = normalizeIndianPhone(bodyText(payload));
  if (!phone) warnings.push('email has no Indian phone — lead will land unassigned');
  const lead: CanonicalLead = {
    kind: 'lead',
    source: ctx.source,
    instanceKey: ctx.instanceKey,
    externalId: text(payload?.id ?? payload?.messageId ?? header(payload, 'Message-Id'), 200),
    receivedAt: ctx.receivedAt,
    contactName: text(name, 200),
    company: '',
    phone,
    email,
    city: '',
    state: '',
    productInterest: text(header(payload, 'Subject'), 300),
    rawNotes: [header(payload, 'Subject'), bodyText(payload)].filter(Boolean).join('\n').slice(0, 4000),
    priority: 'medium',
  };
  return { lead, warnings };
};
