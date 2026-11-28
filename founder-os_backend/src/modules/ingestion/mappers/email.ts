// email.ts — Gmail message → CanonicalEmail (not a lead). The processor writes
// an Email row so the existing email-brain index picks it up; leads extracted
// from email remain the brain's job, never the ingestion door's.

import { text, isoOrNow, type Mapper } from './types';
import type { CanonicalEmail, MapperResult } from '../types';

function header(payload: Record<string, any>, name: string): string {
  const headers = payload?.payload?.headers ?? [];
  if (!Array.isArray(headers)) return '';
  const hit = headers.find((h: any) => String(h?.name ?? '').toLowerCase() === name.toLowerCase());
  return text(hit?.value, 1000);
}

function decode(data: unknown): string {
  if (!data) return '';
  try {
    const bin = atob(String(data).replace(/-/g, '+').replace(/_/g, '/'));
    return text(bin, 8000);
  } catch {
    return '';
  }
}

function walk(part: any): string {
  if (!part || typeof part !== 'object') return '';
  const mime = String(part.mimeType ?? '');
  const body = decode(part.body?.data);
  if (body && (!mime || mime === 'text/plain')) return body;
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      const found = walk(child);
      if (found) return found;
    }
  }
  return body;
}

export const mapGmail: Mapper = (payload, ctx) => {
  const warnings: string[] = [];
  const fromRaw = header(payload, 'From');
  const match = fromRaw.match(/<?([^<>\s]+@[^<>\s]+)>?/);
  const from = match ? match[1].toLowerCase() : '';
  const fromName = text(fromRaw.replace(/<[^>]*>/, '').replace(/"/g, '').trim(), 200);
  const subject = header(payload, 'Subject');
  const body = walk(payload?.payload) || text(payload?.snippet, 8000);
  const externalId = text(payload?.id ?? payload?.messageId ?? header(payload, 'Message-Id'), 200);
  if (!from) warnings.push('email has no usable From address');
  const email: CanonicalEmail = {
    kind: 'email',
    source: ctx.source,
    instanceKey: ctx.instanceKey,
    externalId,
    receivedAt: ctx.receivedAt,
    from,
    fromName,
    to: header(payload, 'To'),
    subject: subject || '(no subject)',
    body: body || subject,
    timestamp: isoOrNow(header(payload, 'Date') || payload?.internalDate, ctx.receivedAt),
  };
  return { email, warnings };
};
