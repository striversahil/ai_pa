// types.ts — the outbound facade's vocabulary. No I/O, no env, no DOM.
//
// An INSTANCE is one provider ACCOUNT (a Zoho org, a WABA number, a portal
// seller). (provider, instanceKey) is the address; `call('zoho')` hits the
// default one, `call('zoho', { instanceKey: 'dpg' })` the named one.

export type ProviderKey =
  | 'zoho' | 'whatsapp' | 'tally' | 'tradeindia' | 'justdial'
  | 'alibaba' | 'openai' | 'custom';

export type DeliveryMode = 'realtime' | 'batch';

export interface ProviderField {
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
  required?: boolean;
}

export interface ProviderManifest {
  provider: ProviderKey;
  label: string;
  category: string;
  hint?: string;
  /** Non-secret config (organizationId, phoneNumberId, pollUrl…). */
  fields: ProviderField[];
  /** Encrypted at rest with the vault key; never returned by any route. */
  secretFields: ProviderField[];
  supportsWebhook: boolean;
  supportsPolling: boolean;
  defaultDeliveryMode: DeliveryMode;
  /** false for `openai` (keys live in Setting ai:providers, not here). */
  instanceRequired: boolean;
  /** Path a provider posts to; the panel shows the resolved absolute URL. */
  webhookPath: string;
}

export interface InstanceRow {
  id: string;
  provider: string;
  instanceKey: string;
  label: string;
  isDefault: number | boolean;
  enabled: number | boolean;
  deliveryMode: string;
  baseUrl: string;
  encryptedSecrets: string;
  configJson: string;
  createdAt: string;
  updatedAt: string;
}

/** Decrypted at call time, inside the Worker only. */
export interface ResolvedInstance {
  id: string;
  provider: string;
  instanceKey: string;
  label: string;
  deliveryMode: DeliveryMode;
  baseUrl: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

/** What the console may see: config + which secret NAMES are set. */
export interface InstanceView {
  id: string;
  provider: string;
  instanceKey: string;
  label: string;
  isDefault: boolean;
  enabled: boolean;
  deliveryMode: DeliveryMode;
  baseUrl: string;
  config: Record<string, unknown>;
  hasSecrets: boolean;
  secretKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationAdapter<T = unknown> {
  provider: ProviderKey;
  connect(instance: ResolvedInstance): Promise<T>;
}

export interface CallOptions {
  /** Named account; omitted = the instance flagged isDefault (else 'default'). */
  instanceKey?: string;
}

/** The handful of D1 methods the gateway stores need. */
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  run(): Promise<unknown>;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] } | T[]>;
}

export interface SqlDb {
  prepare(sql: string): SqlStatement;
  batch?(statements: SqlStatement[]): Promise<unknown>;
}

export class IntegrationError extends Error {
  readonly status: number;
  readonly provider: string;
  constructor(provider: string, message: string, status = 503) {
    super(message);
    this.name = 'IntegrationError';
    this.provider = provider;
    this.status = status;
  }
}
