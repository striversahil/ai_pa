// gateway-types.ts — the unified provider gateway (mig 0183) as the console
// sees it. Secret VALUES never appear here: only `secretKeys` names.

export interface ProviderField {
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
  required?: boolean;
}

export interface ProviderManifest {
  provider: string;
  label: string;
  category: string;
  hint?: string;
  fields: ProviderField[];
  secretFields: ProviderField[];
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
