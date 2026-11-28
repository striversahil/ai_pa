// manifest.ts — manifest.json is the ONE catalogue. This file only hydrates it.
// A provider exists because it is a key in the JSON: no second list to drift.

import raw from '../manifest.json';
import type {
  ChallengeSpec,
  DeliveryMode,
  FieldCondition,
  IdempotencySpec,
  InboundSpec,
  ManifestField,
  PollSpec,
  ProviderKey,
  ProviderManifest,
  ValidationResult,
  VerificationSpec,
} from './types';

type RawCondition = FieldCondition | Record<string, string | number | boolean>;

interface RawField {
  key: string;
  label: string;
  type?: ManifestField['type'];
  required?: boolean;
  requiredWhen?: RawCondition;
  options?: string[];
  placeholder?: string;
  hint?: string;
  default?: string | number | boolean;
  defaultValue?: string | number | boolean;
}

interface RawSignature {
  algorithm?: string;
  headerName?: string;
  header?: string;
  headerNameFromConfig?: string;
  secretKey?: string;
  secretField?: string;
  encoding?: string;
  prefix?: string;
  optionalIfSecretUnset?: boolean;
}

interface RawVerification extends RawSignature {
  type?: string;
  kind?: string;
  payloadPath?: string;
  field?: string;
  configKey?: string;
  configField?: string;
  optionalIfConfigUnset?: boolean;
  // The manifest groups these under `inbound.verification`, while the loader
  // also accepts the flat `inbound.signaturePost`/`challengeGet` shape.
  signaturePost?: RawSignature;
  challengeGet?: RawChallenge | boolean;
}

interface RawChallenge {
  modeParam?: string;
  expectedMode?: string;
  tokenParam?: string;
  challengeParam?: string;
}

interface RawIdempotency {
  strategy?: string;
  mode?: IdempotencySpec['mode'];
  path?: string;
  paths?: string[];
  fallbackPaths?: string[];
  configKey?: string;
  configField?: string;
  parts?: string[];
  prefixes?: string[];
}

interface RawQuietHours {
  enabled?: boolean;
  pauseStart?: string;
  pauseEnd?: string;
}

interface RawInbound {
  supported?: boolean;
  transport?: string;
  defaultDeliveryMode?: DeliveryMode;
  allowedDeliveryModes?: DeliveryMode[];
  verification?: RawVerification;
  signaturePost?: RawSignature;
  challengeGet?: RawChallenge | boolean;
  idempotencyKey?: RawIdempotency;
  mapper?: string;
  canonicalType?: string;
  targetSink?: string;
  liveEvent?: string;
  fieldMap?: Record<string, string>;
  labelAliases?: Record<string, string>;
  normalizeQueryToBodyOnGet?: boolean;
  quietHoursIst?: RawQuietHours | [number, number];
  poller?: { intervalMinutes?: number; cursorField?: string };
  poll?: { supported?: boolean; intervalMinutes?: number; cursorField?: string };
}

interface RawProvider {
  label: string;
  category: string;
  direction: 'outbound' | 'inbound' | 'both' | 'bidirectional';
  multiInstance?: boolean;
  instanceRequired?: boolean;
  description?: string;
  auth?: {
    strategy?: string;
    defaultBaseUrl?: string;
    configFields?: RawField[];
    secretFields?: RawField[];
  };
  configFields?: RawField[];
  secretFields?: RawField[];
  outbound?: { supported?: boolean; adapter?: string; defaultDeliveryMode?: DeliveryMode; operations?: string[]; capabilities?: string[] };
  inbound?: RawInbound;
}

interface RawManifest {
  version: string;
  description?: string;
  defaults: { defaultInstanceKey?: string; maxRetriesBeforeDeadLetter?: number; batchClaimSize?: number; webhookRoutePattern?: string };
  providers: Record<string, RawProvider>;
}

const FILE = raw as unknown as RawManifest;

const CATEGORY_LABELS: Record<string, string> = {
  ai: 'AI',
  accounting: 'Accounting',
  b2b_portal: 'B2B Portals',
  social: 'Social',
  forms: 'Forms',
  email: 'Email',
  geo_enrichment: 'Geo Enrichment',
  search_enrichment: 'Search Enrichment',
  custom: 'Custom',
};

export const MANIFEST_VERSION = FILE.version;
export const MANIFEST_DEFAULTS = FILE.defaults;
export const MANIFEST_CATEGORIES: Record<string, string> = CATEGORY_LABELS;
export const MANIFEST_CATEGORY_KEYS = Object.keys(CATEGORY_LABELS);

function normalizeCondition(condition?: RawCondition): FieldCondition | undefined {
  if (!condition) return undefined;
  if ('field' in condition) return condition as FieldCondition;
  const [field, value] = Object.entries(condition)[0] || [];
  if (!field) return undefined;
  return { field, equals: value };
}

function normalizeField(field: RawField): ManifestField {
  return {
    key: field.key,
    label: field.label,
    type: field.type || 'text',
    required: field.required,
    requiredWhen: normalizeCondition(field.requiredWhen),
    options: field.options,
    placeholder: field.placeholder,
    hint: field.hint,
    defaultValue: field.defaultValue ?? field.default,
  };
}

function normalizeDirection(direction: RawProvider['direction']): ProviderManifest['direction'] {
  if (direction === 'bidirectional') return 'both';
  return direction;
}

function normalizeAlgorithm(value?: string): 'sha256' | 'sha1' {
  return String(value || '').toLowerCase().includes('sha1') ? 'sha1' : 'sha256';
}

function normalizeEncoding(value?: string): 'hex' | 'base64' {
  return String(value || '').toLowerCase() === 'base64' ? 'base64' : 'hex';
}

function signatureSpec(sig: RawSignature): VerificationSpec {
  return {
    kind: 'hmac',
    header: sig.headerName || sig.header,
    headerNameFromConfig: sig.headerNameFromConfig,
    algorithm: normalizeAlgorithm(sig.algorithm),
    encoding: normalizeEncoding(sig.encoding),
    prefix: sig.prefix,
    secretField: sig.secretKey || sig.secretField,
    optionalIfSecretUnset: sig.optionalIfSecretUnset,
  };
}

function normalizeVerification(inbound: RawInbound): VerificationSpec | undefined {
  // Tally/Meta/custom nest the HMAC spec under `verification.signaturePost`;
  // flat providers keep it at `inbound.signaturePost`. Both are supported.
  const nestedSignature = inbound.verification?.signaturePost;
  if (nestedSignature) return signatureSpec(nestedSignature);
  if (inbound.signaturePost) return signatureSpec(inbound.signaturePost);
  const v = inbound.verification;
  if (!v) return undefined;
  const type = String(v.type || v.kind || '').toLowerCase();
  if (type === 'optional_header_token' || type === 'header_token') {
    return {
      kind: 'optional_header_token',
      header: v.headerName || v.header,
      secretField: v.secretKey || v.secretField,
      optionalIfSecretUnset: v.optionalIfSecretUnset,
    };
  }
  if (type === 'field_match') {
    return {
      kind: 'field_match',
      field: v.payloadPath || v.field,
      configField: v.configKey || v.configField,
      optionalIfConfigUnset: v.optionalIfConfigUnset,
    };
  }
  if (type === 'none') return { kind: 'none' };
  return signatureSpec(v);
}

function normalizeChallenge(value?: RawChallenge | boolean): ChallengeSpec | undefined {
  if (!value) return undefined;
  if (value === true) {
    return { modeParam: 'hub.mode', expectedMode: 'subscribe', tokenParam: 'hub.verify_token', challengeParam: 'hub.challenge' };
  }
  return {
    modeParam: value.modeParam || 'hub.mode',
    expectedMode: value.expectedMode || 'subscribe',
    tokenParam: value.tokenParam || 'hub.verify_token',
    challengeParam: value.challengeParam || 'hub.challenge',
  };
}

function normalizeIdempotency(rawIdem?: RawIdempotency): IdempotencySpec | undefined {
  if (!rawIdem) return undefined;
  const paths = rawIdem.paths || (rawIdem.path ? [rawIdem.path] : undefined);
  const fallbacks = rawIdem.fallbackPaths;
  const strategy = rawIdem.strategy || rawIdem.mode || 'path';
  if (strategy === 'config_path') {
    return {
      mode: 'config_path',
      configField: rawIdem.configKey || rawIdem.configField,
      fallbacks,
      paths,
    };
  }
  if (strategy === 'composite') {
    return { mode: 'composite', parts: rawIdem.parts || paths, paths, fallbacks };
  }
  return { mode: 'path', path: rawIdem.path || paths?.[0], paths, fallbacks, prefixes: rawIdem.prefixes };
}

function toHour(value?: string): number {
  const hour = Number(String(value || '').split(':')[0]);
  return Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 0;
}

function normalizeQuietHours(value?: RawQuietHours | [number, number]): [number, number] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  if (value.enabled === false) return undefined;
  return [toHour(value.pauseStart), toHour(value.pauseEnd)];
}

function normalizePoll(inbound: RawInbound): PollSpec | undefined {
  const poller = inbound.poller;
  if (poller) {
    return {
      supported: true,
      intervalMinutes: Number(poller.intervalMinutes) || 5,
      cursorField: poller.cursorField || 'lastPollAt',
    };
  }
  if (inbound.poll?.supported) {
    return {
      supported: true,
      intervalMinutes: Number(inbound.poll.intervalMinutes) || 5,
      cursorField: inbound.poll.cursorField || 'lastPollAt',
    };
  }
  return undefined;
}

function hydrate(provider: string, p: RawProvider): ProviderManifest {
  const configFields = (p.auth?.configFields || p.configFields || []).map(normalizeField);
  const secretFields = (p.auth?.secretFields || p.secretFields || []).map(normalizeField);
  const rawInbound = p.inbound || {};
  const poll = normalizePoll(rawInbound);
  const inbound: InboundSpec = {
    supported: rawInbound.supported !== false && Boolean(
      rawInbound.supported || rawInbound.mapper || rawInbound.verification || rawInbound.signaturePost || rawInbound.challengeGet || poll,
    ),
    transport: rawInbound.transport,
    defaultDeliveryMode: rawInbound.defaultDeliveryMode,
    allowedDeliveryModes: rawInbound.allowedDeliveryModes,
    quietHoursIst: normalizeQuietHours(rawInbound.quietHoursIst),
    liveEvent: rawInbound.liveEvent || 'integrations',
    challengeGet: normalizeChallenge(rawInbound.challengeGet || rawInbound.verification?.challengeGet),
    verification: normalizeVerification(rawInbound),
    idempotencyKey: normalizeIdempotency(rawInbound.idempotencyKey),
    fieldMap: rawInbound.fieldMap,
    labelAliases: rawInbound.labelAliases,
    normalizeQueryToBodyOnGet: Boolean(rawInbound.normalizeQueryToBodyOnGet),
    mapper: rawInbound.mapper,
    canonicalType: rawInbound.canonicalType,
    targetSink: rawInbound.targetSink,
    poll,
  };
  const outbound = {
    supported: false,
    ...(p.outbound || {}),
  };
  const mode = inbound.defaultDeliveryMode || outbound.defaultDeliveryMode || 'batch';
  const instanceRequired = p.instanceRequired ?? p.auth?.strategy !== 'openai_compatible_multi_instance';
  return {
    provider,
    label: p.label,
    category: p.category,
    direction: normalizeDirection(p.direction),
    multiInstance: p.multiInstance !== false,
    instanceRequired,
    description: p.description,
    configFields,
    secretFields,
    outbound,
    inbound,
    fields: configFields.map((f) => ({ key: f.key, label: f.label, hint: f.hint, placeholder: f.placeholder, required: f.required })),
    supportsWebhook: inbound.supported && inbound.transport !== 'poller_cron',
    supportsPolling: Boolean(poll?.supported),
    defaultDeliveryMode: mode,
    webhookPath: `/api/webhooks/${provider}`,
    defaultBaseUrl: p.auth?.defaultBaseUrl,
    auth: p.auth ? { strategy: p.auth.strategy, defaultBaseUrl: p.auth.defaultBaseUrl } : null,
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

export function challengeFor(provider: string): ChallengeSpec | null {
  return getProviderManifest(provider)?.inbound.challengeGet || null;
}

export function idempotencyFor(provider: string): IdempotencySpec | null {
  return getProviderManifest(provider)?.inbound.idempotencyKey || null;
}

export function inboundFor(provider: string): InboundSpec | null {
  return getProviderManifest(provider)?.inbound || null;
}

export function mapperNameFor(provider: string): string | null {
  return getProviderManifest(provider)?.inbound.mapper || null;
}

export function liveEventFor(provider: string): string {
  return getProviderManifest(provider)?.inbound.liveEvent || 'integrations';
}

export function categoryLabel(category: string): string {
  return MANIFEST_CATEGORIES[category] || category;
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

function withDefaults(fields: ManifestField[], config: Record<string, unknown>): Record<string, unknown> {
  const out = { ...config };
  for (const field of fields) {
    if (out[field.key] === undefined && field.defaultValue !== undefined) out[field.key] = field.defaultValue;
  }
  return out;
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
  const cfg = withDefaults(manifest.configFields, config || {});
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
