// types.ts — Integrations: one shape for every connector, source, event and
// delivery. `catalog.ts` owns the built-in types; `store.ts` owns persistence.

import type { MappingSpec } from './mapping';

export type AuthKind = 'webhook' | 'apiKey' | 'oauth2';
export type ConnectorStatus = 'live' | 'beta' | 'needs-setup';
export type SourceStatus = 'active' | 'paused';
export type IngestKind = 'lead' | 'visit' | 'expense' | 'message' | 'order' | 'enquiry' | 'raw';

/** A credential/config input the connect wizard renders for a connector. */
export interface CatalogField {
  key: string;
  label: string;
  placeholder?: string;
  hint?: string;
  /** Stored in CACHE_KV, never echoed back. */
  secret?: boolean;
  required?: boolean;
}

/** A service you can add: built-in (code) or user-authored (D1 row). */
export interface CatalogEntry {
  key: string;
  name: string;
  icon: string;
  color?: string;
  category: string;
  authKind: AuthKind;
  status: ConnectorStatus;
  docs?: string;
  hint?: string;
  /** Preset the mapping editor starts from (fields the service sends). */
  mapping: MappingSpec;
  fields?: CatalogField[];
  /** Already ingested by a native pipeline (WhatsApp) — shown, not duplicated. */
  native?: string;
  /** User-authored connector id (absent for built-ins). */
  customId?: string;
}

export interface ConnectorRow {
  id: string;
  key: string;
  name: string;
  icon: string;
  color: string;
  category: string;
  authKind: AuthKind;
  mapping: string;
  sample: string;
  status: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceRow {
  id: string;
  connectorKey: string;
  name: string;
  status: SourceStatus;
  config: string;
  /** Per-source mapping override; '' = inherit the connector preset. */
  mapping: string;
  eventCount: number;
  lastEventAt: string;
  lastError: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventRow {
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
  linkedType: string;
  linkedId: string;
  status: string;
  error: string;
  createdAt: string;
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

/** What the panel shows for one source: the row + its service + live counts. */
export interface SourceView extends SourceRow {
  connector: CatalogEntry;
  /** Present only on create/rotate — the one time the key is readable. */
  token?: string;
  webhookUrl?: string;
  /** Returned once at creation — the value to paste into the service. */
  signingSecret?: string;
}