// processor.ts — the ONLY writer from a staged row into a domain store.
//
// lead      → Enquiry via the canonical enquiry intake (never a direct
//             core_lead write; the ERP core stays locked).
// message   → Message (wamid is UNIQUE, so a retry is a no-op).
// estimate  → normalized + linked (coreRefId). Estimate rows themselves are
//             written by the zoho-sync runner, which owns org/status rules.

import { prisma } from '../../shared/prisma-d1';
import { createEnquiryStore } from '../enquiries/store';
import { enquiryCreate } from '../enquiries/routes';
import { mapInbound } from './mappers';
import { normalizeIndianPhone } from './pure';
import { getRow, markFailed, markProcessed } from './store';
import type { CanonicalEstimate, CanonicalLead, CanonicalMessage, IngestRow, SqlDb } from './types';

export interface ProcessorContext {
  db: SqlDb;
  env: Record<string, unknown>;
}

export interface ProcessOutcome {
  ok: boolean;
  coreRefId?: string;
  error?: string;
}

function systemViewer(source: string): any {
  // The intake only reads isRoot + scopes; an ingestion actor is neither root
  // nor able to see procurement margins, so it gets the plainest viewer.
  return {
    user: { id: 'ingestion', email: '', name: `Ingestion (${source})` },
    scopes: [],
    roles: [],
    isRoot: false,
    isAdmin: false,
  };
}

async function existingEnquiryId(db: SqlDb, phone: string): Promise<string> {
  if (!phone) return '';
  const digits = phone.replace(/[^0-9]/g, '').slice(-10);
  const hit = await db
    .prepare('SELECT "id" FROM "Enquiry" WHERE "contactPhone" IN (?, ?) ORDER BY "createdAt" DESC LIMIT 1')
    .bind(phone, digits)
    .first<{ id: string }>();
  return String(hit?.id ?? '');
}

async function routeLead(ctx: ProcessorContext, lead: CanonicalLead): Promise<{ ref: string; linked: boolean }> {
  const phone = normalizeIndianPhone(lead.phone) || lead.phone;
  const existing = await existingEnquiryId(ctx.db, phone);
  if (existing) return { ref: existing, linked: true };

  const created = await enquiryCreate(createEnquiryStore(ctx.env), systemViewer(lead.source), {
    source: 'B2B',
    contactName: lead.contactName,
    clientCompany: lead.company,
    contactPhone: phone,
    contactEmail: lead.email,
    location: [lead.city, lead.state].filter(Boolean).join(', '),
    title: lead.productInterest || `Portal lead — ${lead.source}`,
    description: lead.rawNotes,
    sourceLead: `${lead.source}${lead.instanceKey && lead.instanceKey !== 'default' ? `:${lead.instanceKey}` : ''}`,
    priority: lead.priority,
  });
  if (created.status !== 201) {
    throw new Error(`enquiry intake rejected the lead: ${(created.body as any)?.error ?? created.status}`);
  }
  return { ref: String((created.body as any)?.id ?? ''), linked: false };
}

async function routeMessage(message: CanonicalMessage): Promise<{ ref: string; linked: boolean }> {
  if (!message.externalId) throw new Error('message has no provider id');
  try {
    await prisma.message.create({
      data: {
        id: crypto.randomUUID(),
        wahaMessageId: `wa:${message.externalId}`,
        chatId: message.from || message.contactName,
        sender: 'contact',
        body: message.text || `[${message.mediaUrl || 'media'}]`,
        timestamp: new Date(message.timestamp),
      },
    });
    return { ref: message.externalId, linked: false };
  } catch (error: any) {
    // UNIQUE wamid = the exact same message again; that is a success, not a
    // failure, or Meta's retries would fill the dead-letter queue.
    if (/UNIQUE|constraint/i.test(String(error?.message ?? ''))) {
      return { ref: message.externalId, linked: true };
    }
    throw error;
  }
}

function routeEstimate(estimate: CanonicalEstimate): { ref: string; linked: boolean } {
  const ref = estimate.estimateNumber || estimate.externalId;
  if (!ref) throw new Error('estimate has no number or id');
  return { ref, linked: false };
}

export async function processIngestedRow(ctx: ProcessorContext, id: string): Promise<ProcessOutcome> {
  const row: IngestRow | null = await getRow(ctx.db, id);
  if (!row) return { ok: false, error: 'ingested row not found' };
  let payload: Record<string, any> = {};
  try {
    payload = JSON.parse(row.rawPayload || '{}');
  } catch {
    await markFailed(ctx.db, id, 'raw payload is not JSON');
    return { ok: false, error: 'raw payload is not JSON' };
  }

  const mapped = mapInbound(row.source, payload, {
    source: row.source,
    instanceKey: row.instanceKey,
    receivedAt: row.receivedAt,
  });
  const normalized = JSON.stringify({
    canonical: mapped.lead ?? mapped.estimate ?? mapped.message ?? null,
    warnings: mapped.warnings,
  });

  try {
    const canonical = mapped.lead ?? mapped.estimate ?? mapped.message;
    if (!canonical) {
      // Delivery-status callbacks and provider pings: staged + acknowledged.
      await markProcessed(ctx.db, id, normalized, '');
      return { ok: true };
    }
    const routed =
      canonical.kind === 'lead' ? await routeLead(ctx, canonical)
      : canonical.kind === 'message' ? await routeMessage(canonical)
      : routeEstimate(canonical);
    await markProcessed(ctx.db, id, normalized, routed.ref);
    return { ok: true, coreRefId: routed.ref };
  } catch (error: any) {
    const message = String(error?.message ?? 'processing failed');
    await markFailed(ctx.db, id, message);
    return { ok: false, error: message };
  }
}
