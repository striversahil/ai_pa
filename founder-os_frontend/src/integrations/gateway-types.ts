// gateway-types.ts — wire + manifest shapes for the root-only integration workspace.
// The manifest on the Worker is the single source of truth; this file only types
// what it serves, never a provider list of its own.

export type DeliveryMode = "realtime" | "batch";
export type FieldType = "text" | "number" | "boolean" | "json" | "select" | "password" | "url";

export interface RequiredWhen {
  field: string;
  equals?: unknown;
  in?: unknown[];
  includes?: string;
  truthy?: boolean;
}

export interface ProviderField {
  key: string;
  label: string;
  type?: FieldType | string;
  required?: boolean;
  requiredWhen?: RequiredWhen | null;
  options?: Array<string | number | { value: string; label?: string }>;
  defaultValue?: unknown;
  placeholder?: string;
  help?: string;
  hint?: string;
  secret?: boolean;
}

export interface PollSpec {
  supported?: boolean;
  intervalMinutes?: number;
  cursorField?: string;
  label?: string;
}

export interface InboundSpec {
  supported?: boolean;
  transport?: string;
  defaultDeliveryMode?: DeliveryMode | string;
  allowedDeliveryModes?: string[];
  normalizeQueryToBodyOnGet?: boolean;
  verification?: {
    kind?: string;
    header?: string;
    headerNameFromConfig?: string;
    algorithm?: "sha256" | "sha1";
    encoding?: "hex" | "base64";
    prefix?: string;
    secretField?: string;
    optionalIfSecretUnset?: boolean;
    field?: string;
    configField?: string;
    optionalIfConfigUnset?: boolean;
    [key: string]: unknown;
  } | null;
  signature?: {
    header?: string;
    optional?: boolean;
    [key: string]: unknown;
  } | null;
  challengeGet?: {
    modeParam?: string;
    expectedMode?: string;
    tokenParam?: string;
    challengeParam?: string;
    [key: string]: unknown;
  } | null;
  fieldMap?: Record<string, unknown>;
  labelAliases?: Record<string, unknown>;
  idempotencyKey?: {
    mode?: string;
    strategy?: string;
    path?: string;
    paths?: string[];
    fallbacks?: string[];
    configField?: string;
    parts?: string[];
    prefixes?: string[];
    [key: string]: unknown;
  } | null;
  mapper?: string;
  canonicalType?: string;
  targetSink?: string;
  liveEvent?: string;
  quietHoursIst?: [number, number] | number[] | null;
  poller?: PollSpec | null;
  poll?: PollSpec | null;
  [key: string]: unknown;
}

export interface OutboundSpec {
  supported?: boolean;
  adapter?: string;
  operations?: string[];
  capabilities?: string[];
  defaultDeliveryMode?: DeliveryMode | string;
  [key: string]: unknown;
}

export interface ProviderManifest {
  provider: string;
  label: string;
  category: string;
  description?: string;
  instanceRequired?: boolean;
  direction?: "inbound" | "outbound" | "both" | string;
  multiInstance?: boolean;
  supportsWebhook?: boolean;
  supportsPolling?: boolean;
  defaultDeliveryMode?: DeliveryMode | string;
  configFields: ProviderField[];
  secretFields: ProviderField[];
  inbound?: InboundSpec | null;
  outbound?: OutboundSpec | null;
  setupNotes?: string[];
  docsUrl?: string;
  docsLabel?: string;
  webhookPath?: string;
  defaultBaseUrl?: string;
  auth?: { strategy?: string; defaultBaseUrl?: string; [key: string]: unknown } | null;
  [key: string]: unknown;
}

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

export interface SourceStat { source: string; n: number; lastAt: string }

export interface IngestStats {
  counts: Record<string, number>;
  sources: SourceStat[];
}

export interface InstancesPayload {
  instances: InstanceView[];
  providers: ProviderManifest[];
  version: string;
  categories: Record<string, string>;
  stats: IngestStats;
}

export interface IngestedRow {
  id: string;
  source: string;
  instanceKey: string;
  externalEventId: string;
  status: string;
  deliveryMode: string;
  eventType: string;
  attempts: number;
  error: string;
  coreRefId: string;
  receivedAt: string;
  processedAt: string;
  [key: string]: unknown;
}

export interface IngestedDetail extends IngestedRow {
  headersJson: string;
  rawJson: string;
  normalizedJson: string;
  nextAttemptAt?: string;
  lockedAt?: string;
}

export interface TestResult { ok: boolean; detail?: string; [key: string]: unknown }