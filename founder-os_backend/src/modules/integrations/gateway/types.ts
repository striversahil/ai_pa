// types.ts — the integration vocabulary. No I/O, no env, no DOM.
//
// An INSTANCE is one provider ACCOUNT (a Zoho org, a WABA number, a portal
// seller). (provider, instanceKey) is the address; `call('zoho')` hits the
// default one, `call('zoho', { instanceKey: 'dpg' })` the named one.
// The provider catalogue itself lives in ../manifest.json (v2.0.0).

/** Providers are data now: any key present in manifest.json is valid. */
export type ProviderKey = string;

export type DeliveryMode = 'realtime' | 'batch';
export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'json';

export interface FieldCondition {
  field: string;
  equals?: string | number | boolean;
  includes?: string;
}

export interface ManifestField {
  key: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  requiredWhen?: FieldCondition;
  options?: string[];
  placeholder?: string;
  hint?: string;
  defaultValue?: string | number | boolean;
}

export type VerificationKind = 'hmac' | 'field_match' | 'optional_header_token' | 'none';

export interface VerificationSpec {
  kind: VerificationKind;
  header?: string;
  algorithm?: 'sha256' | 'sha1';
  encoding?: 'hex' | 'base64';
  prefix?: string;
  secretField?: string;
  configField?: string;
  field?: string;
  optionalIfSecretUnset?: boolean;
  optionalIfConfigUnset?: boolean;
  /** Header name is read from this config field (custom providers). */
  headerNameFromConfig?: string;
}

export interface ChallengeSpec {
  modeParam: string;
  expectedMode: string;
  tokenParam: string;
  challengeParam: string;
}

export interface IdempotencySpec {
  mode: 'path' | 'composite' | 'config_path';
  path?: string;
  paths?: string[];
  fallbacks?: string[];
  parts?: string[];
  prefixes?: string[];
  configField?: string;
}

export interface PollSpec {
  supported: boolean;
  intervalMinutes?: number;
  cursorField?: string;
}

export interface InboundSpec {
  supported: boolean;
  transport?: string;
  methods?: string[];
  defaultDeliveryMode?: DeliveryMode;
  allowedDeliveryModes?: DeliveryMode[];
  quietHoursIst?: [number, number];
  liveEvent?: string;
  challengeGet?: ChallengeSpec;
  normalizeQueryToBodyOnGet?: boolean;
  verification?: VerificationSpec;
  idempotencyKey?: IdempotencySpec;
  fieldMap?: Record<string, string>;
  labelAliases?: Record<string, string>;
  mapper?: string;
  canonicalType?: string;
  targetSink?: string;
  poll?: PollSpec;
}

export interface OutboundSpec {
  supported: boolean;
  adapter?: string;
  defaultDeliveryMode?: DeliveryMode;
  capabilities?: string[];
  operations?: string[];
}

/** One provider as declared in manifest.json, hydrated for the app. */
export interface ProviderManifest {
  provider: ProviderKey;
  label: string;
  category: string;
  direction: 'outbound' | 'inbound' | 'both';
  multiInstance: boolean;
  instanceRequired: boolean;
  description?: string;
  configFields: ManifestField[];
  secretFields: ManifestField[];
  outbound: OutboundSpec;
  inbound: InboundSpec;
  /** Legacy flat views kept for the existing console + gateway. */
  fields: { key: string; label: string; hint?: string; placeholder?: string; required?: boolean }[];
  supportsWebhook: boolean;
  supportsPolling: boolean;
  defaultDeliveryMode: DeliveryMode;
  webhookPath: string;
  /** Manifest-owned adapter defaults surfaced read-only in the console. */
  defaultBaseUrl?: string;
  auth?: { strategy?: string; defaultBaseUrl?: string } | null;
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

export interface ValidationResult { ok: boolean; errors: string[] }

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
