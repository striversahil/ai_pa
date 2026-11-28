// types.ts — the canonical shapes every inbound payload is reduced to.
//
// A provider payload NEVER reaches a domain store directly: the webhook
// stages the raw body in hlp_ingested_data, a pure mapper returns canonical
// data, and processor.ts is the only writer into queries/estimates/messages.

export type IngestSource =
  | 'zoho' | 'indiamart' | 'tradeindia' | 'justdial' | 'exportersindia'
  | 'alibaba' | 'whatsapp' | 'facebook' | 'instagram' | 'linkedin'
  | 'telegram' | 'tally' | 'google_forms' | 'gmail' | 'custom';

export type IngestStatus = 'pending' | 'processing' | 'processed' | 'dead_letter';

export interface CanonicalItem {
  name: string;
  qty: string;
  spec?: string;
  rate?: number;
  amount?: number;
}

export interface CanonicalLead {
  kind: 'lead';
  source: string;
  instanceKey: string;
  externalId: string;
  receivedAt: string;
  contactName: string;
  company: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  productInterest: string;
  rawNotes: string;
  priority: 'low' | 'medium' | 'high';
}

export interface CanonicalEstimate {
  kind: 'estimate';
  source: string;
  instanceKey: string;
  externalId: string;
  receivedAt: string;
  estimateNumber: string;
  status: string;
  customerName: string;
  organizationId: string;
  total: number;
  date: string;
  items: CanonicalItem[];
  comments: Array<{ author: string; body: string; at: string }>;
}

export interface CanonicalMessage {
  kind: 'message';
  source: string;
  instanceKey: string;
  externalId: string;
  receivedAt: string;
  from: string;
  to: string;
  contactName: string;
  text: string;
  mediaUrl: string;
  timestamp: string;
}

export interface CanonicalEmail {
  kind: 'email';
  source: string;
  instanceKey: string;
  externalId: string;
  receivedAt: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  timestamp: string;
}

export type Canonical = CanonicalLead | CanonicalEstimate | CanonicalMessage | CanonicalEmail;

export interface MapperResult {
  lead?: CanonicalLead;
  estimate?: CanonicalEstimate;
  message?: CanonicalMessage;
  email?: CanonicalEmail;
  warnings: string[];
}

export interface IngestRow {
  id: string;
  source: string;
  instanceKey: string;
  eventType: string;
  externalEventId: string | null;
  deliveryMode: string;
  status: string;
  rawPayload: string;
  headersJson: string;
  normalizedJson: string;
  coreRefId: string;
  retryCount: number;
  errorLog: string;
  receivedAt: string;
  processedAt: string | null;
}

/** The gateway owns the SQL shape; ingestion reuses the same minimal port. */
export type { SqlDb, SqlStatement } from '../integrations/gateway/types';

export interface IngestInsert {
  source: string;
  instanceKey: string;
  eventType: string;
  externalEventId: string | null;
  deliveryMode: string;
  rawPayload: string;
  headersJson: string;
}
