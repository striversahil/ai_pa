// types.ts — the panel's view of the ingestion hub.
//
// Mirror of founder-os_backend/src/modules/integrations/types.ts (the route
// adds the panel-only bits: webhook URLs, secret flags, parsed mapping).
// Keep the two in step — a new ingest kind or auth kind is a contract change.

export type AuthKind = "webhook" | "hmac" | "oauth2" | "api-key" | "none";
export type ConnectorStatus = "live" | "beta" | "needs-setup";
export type SourceStatus = "active" | "paused";
export type IngestKind = "lead" | "visit" | "expense" | "message" | "order" | "enquiry" | "raw";

export type DateFormat = "iso" | "epoch_s" | "epoch_ms" | "dd-mm-yyyy" | "yyyy-mm-dd";

export interface MappingSpec {
  itemsPath?: string;
  fields?: Record<string, string>;
  literals?: Record<string, string>;
  occurredAtFormat?: DateFormat;
  eventKind?: IngestKind;
}

export interface CatalogField {
  key: string;
  label: string;
  secret?: boolean;
  hint?: string;
  placeholder?: string;
}

/** A service type: built in (code) or authored in the panel (D1 row). */
export interface CatalogEntry {
  key: string;
  name: string;
  icon?: string;
  color?: string;
  category: string;
  authKind: AuthKind;
  status: ConnectorStatus;
  docs?: string;
  hint?: string;
  mapping: MappingSpec;
  fields?: CatalogField[];
  native?: string;
  customId?: string;
}

/** A live connection (one per portal account you wire up). */
export interface IntegrationSource {
  id: string;
  connectorKey: string;
  name: string;
  status: SourceStatus;
  tokenHash: string;
  config: Record<string, unknown>;
  /** Raw override ('' = inherit the service preset). */
  mapping: string;
  mappingSpec: MappingSpec;
  eventCount: number;
  lastEventAt: string;
  lastError: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  connector: CatalogEntry;
  webhookUrl: string;
  webhookPrefix: string;
  secrets: Record<string, boolean>;
  signingSecret?: string;
  token?: string;
}

export interface IntegrationEventRow {
  id: string;
  sourceId: string;
  connectorKey: string;
  externalId: string;
  kind: string;
  occurredAt: string;
  title: string;
  summary: string;
  company: string;
  contactName: string;
  phone: string;
  email: string;
  city: string;
  amount: number | null;
  payload: string;
  raw: string;
  hasPayload?: boolean;
  linkedType: string;
  linkedId: string;
  status: string;
  error: string;
  createdAt: string;
}

export interface EventDetail extends IntegrationEventRow {
  payloadObject: Record<string, unknown>;
  rawObject: Record<string, unknown>;
}

export interface DeliveryRow {
  id: string;
  sourceId: string;
  receivedAt: string;
  status: string;
  httpStatus: number;
  error: string;
  bodyPreview: string;
  bytes: number;
  eventId: string;
}

export interface CustomConnector {
  id: string;
  key: string;
  name: string;
  icon: string;
  color: string;
  category: string;
  mapping: string;
  mappingSpec: MappingSpec;
  sample: string;
  status: string;
  createdAt: string;
}

export interface IntegrationsPayload {
  ok: boolean;
  sources: IntegrationSource[];
  catalog: CatalogEntry[];
  connectors: CustomConnector[];
  stats: { sources: number; events: number; lastEventAt: string };
}
