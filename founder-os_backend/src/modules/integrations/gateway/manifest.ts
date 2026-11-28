// manifest.ts — manifest.json is the ONE catalogue. This file only hydrates it.
// A provider exists because it is a key in the JSON: no second list to drift.

import raw from '../manifest.json';
import type {
  DeliveryMode,
  IdempotencySpec,
  InboundSpec,
  ManifestField,
  ProviderKey,
  ProviderManifest,
  ValidationResult,
  VerificationSpec,
} from './types';

interface RawProvider {
  label: string;
  category: string;
  direction: 'outbound' | 'inbound' | 'both';
  multiInstance?: boolean;
  instanceRequired?: boolean;
  description?: string;
  configFields?: ManifestField[];
  secretFields?: ManifestField[];
  outbound?: { supported?: boolean; defaultDeliveryMode?: DeliveryMode; operations?: string[] };
  inbound?: InboundSpec;
}

interface RawManifest {
  version: string;
  description?: string;
  defaults: { defaultInstanceKey?: string; maxRetriesBeforeDeadLetter?: number; batchClaimSize?: number; webhookRoutePattern?: string };
  categories?: Record<string, string>;
  providers: Record<string, RawProvider>;
}

const FILE = raw as unknown as RawManifest;

export const MANIFEST_VERSION = FILE.version;
export const MANIFEST_DEFAULTS = FILE.defaults;
export const MANIFEST_CATEGORIES: Record<string, string> = FILE.categories || {};

function hydrate(provider: string, p: RawProvider): ProviderManifest {
  const configFields = p.configFields || [];
  const secretFields = p.secretFields || [];
  const inbound: InboundSpec = { supported: false, ...(p.inbound || {}) };
  const outbound = { supported: false, ...(p.outbound || {}) };
  const mode = inbound.defaultDeliveryMode || outbound.defaultDeliveryMode || 'batch';
  return {
    provider,
    label: p.label,
    category: p.category,
    direction: p.direction,
    multiInstance: p.multiInstance !== false,
    instanceRequired: p.instanceRequired !== false,
    description: p.description,
    configFields,
    secretFields,
    outbound,
    inbound,
    fields: configFields.map((f) => ({ key: f.key, label: f.label, hint: f.hint, placeholder: f.placeholder, required: f.required })),
    supportsWebhook: !!inbound.supported,
    supportsPolling: !!inbound.poll?.supported,
    defaultDeliveryMode: mode,
    webhookPath: `/api/webhooks/${provider}`,
  };
}

const BY_KEY = new Map<string, ProviderManifest>();
for (const [key, value] of Object.entries(FILE.providers || {})) BY_KEY.set(key, hydrate(key, value));

/** Every provider, in manifest order. */
export function listProviderManifests(): ProviderManifest[] {
  return [...BY_KEY.values()];
}

export const PROVIDER_MANIFESTS: ProviderManifest[] = listProviderManifests();

export function getProviderManifest(provider: string): ProviderManifest | null {
  return BY_KEY.get(String(provider || '').trim().toLowerCase()) || null;
}

/** Back-compat alias used by the gateway. */
export const manifestFor = getProviderManifest;

export function providerKeys(): string[] {
  return [...BY_KEY.keys()];
}

export function isProvider(value: string): boolean {
  return BY_KEY.has(String(value || '').trim().toLowerCase());
}

/** Source stored on an ingested row for a provider-scoped webhook. */
export function webhookSourceFor(provider: string, instanceKey?: string): string {
  const key = String(instanceKey || '').trim();
  return key && key !== 'default' ? `${provider}:${key}` : provider;
}

/** Public URL a provider is told to POST to (default instance omits the key). */
export function resolveWebhookUrl(origin: string, provider: string, instanceKey?: string): string {
  const base = String(origin || '').replace(/\/+$/, '');
  const manifest = getProviderManifest(provider);
  const path = manifest?.webhookPath || `/api/webhooks/${provider}`;
  const key = String(instanceKey || '').trim();
  return key && key !== 'default' ? `${base}${path}/${encodeURIComponent(key)}` : `${base}${path}`;
}

export function verificationFor(provider: string): VerificationSpec | null {
  return getProviderManifest(provider)?.inbound.verification || null;
}

export function idempotencyFor(provider: string): IdempotencySpec | null {
  return getProviderManifest(provider)?.inbound.idempotencyKey || null;
}

export function inboundFor(provider: string): InboundSpec | null {
  return getProviderManifest(provider)?.inbound || null;
}

export function pollProviders(): ProviderManifest[] {
  return PROVIDER_MANIFESTS.filter((m) => m.inbound.poll?.supported);
}

function conditionMet(condition: ManifestField['requiredWhen'], config: Record<string, unknown>, secrets: Record<string, unknown>): boolean {
  if (!condition) return true;
  const value = config[condition.field] ?? secrets[condition.field];
  if (condition.includes !== undefined) return String(value ?? '').includes(condition.includes);
  if (condition.equals !== undefined) return String(value ?? '') === String(condition.equals);
  return value !== undefined && value !== null && value !== '';
}

function typeError(field: ManifestField, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (field.type === 'number' && Number.isNaN(Number(value))) return `${field.label} must be a number`;
  if (field.type === 'boolean' && typeof value !== 'boolean' && !['true', 'false', '0', '1'].includes(String(value)))
    return `${field.label} must be true/false`;
  if (field.type === 'json') {
    try {
      JSON.parse(typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
      return `${field.label} must be valid JSON`;
    }
  }
  if (field.type === 'select' && field.options?.length && !field.options.includes(String(value)))
    return `${field.label} must be one of ${field.options.join(', ')}`;
  return null;
}

/**
 * The console + webhook door validate through THIS function so `required` and
 * `requiredWhen` can never disagree with the manifest (e.g. Zoho oauth2 vs
 * raw_headers_bridge).
 */
export function validateInstancePayload(
  provider: string,
  config: Record<string, unknown> | undefined,
  secrets: Record<string, unknown> | undefined,
): ValidationResult {
  const manifest = getProviderManifest(provider);
  if (!manifest) return { ok: false, errors: [`unknown provider "${provider}"`] };
  const cfg = config || {};
  const sec = secrets || {};
  const errors: string[] = [];

  for (const field of manifest.configFields) {
    const present = cfg[field.key] !== undefined && cfg[field.key] !== null && cfg[field.key] !== '';
    const wanted = field.required || conditionMet(field.requiredWhen, cfg, sec);
    if (!present && wanted) errors.push(`${field.label} is required`);
    if (present) {
      const bad = typeError(field, cfg[field.key]);
      if (bad) errors.push(bad);
    }
  }
  for (const field of manifest.secretFields) {
    const present = sec[field.key] !== undefined && sec[field.key] !== null && sec[field.key] !== '';
    const wanted = field.required || conditionMet(field.requiredWhen, cfg, sec);
    if (!present && wanted) errors.push(`${field.label} is required`);
  }

  return { ok: errors.length === 0, errors };
}
