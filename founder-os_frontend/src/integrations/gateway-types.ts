// gateway-types.ts — manifest v2.0.0 as the console sees it. Secret VALUES
// never appear here: only `secretKeys` names.

export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'json';

export interface FieldCondition {
  field: string;
  equals?: string | number | boolean;
  includes?: string;
}

export interface ProviderField {
  key: string;
  label: string;
  type?: FieldType;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  requiredWhen?: FieldCondition;
  options?: string[];
  defaultValue?: string | number | boolean;
}

export interface InboundSpec {
  supported: boolean;
  methods?: string[];
  defaultDeliveryMode?: 'realtime' | 'batch';
  challengeGet?: boolean;
  verification?: { kind: string; header?: string };
  poll?: { supported: boolean; configPath?: string };
  fieldMap?: Record<string, string>;
}

export interface ProviderManifest {
  provider: string;
  label: string;
  category: string;
  direction: 'outbound' | 'inbound' | 'both';
  multiInstance: boolean;
  description?: string;
  configFields: ProviderField[];
  secretFields: ProviderField[];
  outbound: { supported: boolean; operations?: string[] };
  inbound: InboundSpec;
  /** Legacy flat view (config fields only). */
  fields: ProviderField[];
  supportsWebhook: boolean;
  supportsPolling: boolean;
  defaultDeliveryMode: 'realtime' | 'batch';
  instanceRequired: boolean;
  webhookPath: string;
}

export interface InstanceView {
  id: string;
  provider: string;
  instanceKey: string;
  label: string;
  isDefault: boolean;
  enabled: boolean;
  deliveryMode: 'realtime' | 'batch';
  baseUrl: string;
  config: Record<string, unknown>;
  hasSecrets: boolean;
  secretKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface IngestStats {
  counts: Record<string, number>;
  sources: Array<{ source: string; n: number; lastAt: string }>;
}

export interface InstancesPayload {
  version?: string;
  categories?: Record<string, string>;
  instances: InstanceView[];
  providers: ProviderManifest[];
  stats: IngestStats;
}

export interface IngestedRow {
  id: string;
  source: string;
  instanceKey: string;
  eventType: string;
  externalEventId: string;
  deliveryMode: 'realtime' | 'batch';
  status: 'pending' | 'processing' | 'processed' | 'dead_letter';
  coreRefId: string;
  retryCount: number;
  errorLog: string;
  receivedAt: string;
  processedAt: string | null;
}

export interface IngestedDetail extends IngestedRow {
  rawPayload: string;
  normalizedJson: string;
  headersJson: string;
}

export interface InstanceDraft {
  provider: string;
  instanceKey: string;
  label: string;
  deliveryMode: 'realtime' | 'batch';
  baseUrl: string;
  isDefault: boolean;
  enabled: boolean;
  config: Record<string, string>;
  secrets: Record<string, string>;
}
