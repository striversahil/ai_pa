// index.ts — THE outbound door: `call('zoho', { instanceKey: 'dpg' })`.
//
// One registry of adapters, one resolver (default or named instance), one
// decryption point. Adding a provider = manifest.json entry + adapter file +
// one registerAdapter() line; no caller changes.

import { cached, cacheRevs } from '../../../shared/cache';
import { gatewayContext } from './context';
import { getProviderManifest, manifestFor } from './manifest';
import { getByKey, getDefault } from './store';
import { decryptSecrets, vaultKey } from './vault';
import { openAiAdapter } from './adapters/openai';
import { zohoAdapter } from './adapters/zoho';
import { whatsappAdapter } from './adapters/whatsapp';
import { customHttpAdapter, portalAdapters } from './adapters/custom-http';
import { gmailAdapter } from './adapters/gmail';
import { googleMapsAdapter } from './adapters/google-maps';
import { googleSearchAdapter } from './adapters/google-search';
import {
  IntegrationError,
  type CallOptions,
  type DeliveryMode,
  type IntegrationAdapter,
  type InstanceRow,
  type ResolvedInstance,
} from './types';

export type { ProviderKey, ProviderManifest, ResolvedInstance, IntegrationAdapter } from './types';
export {
  PROVIDER_MANIFESTS,
  MANIFEST_VERSION,
  MANIFEST_CATEGORIES,
  getProviderManifest,
  listProviderManifests,
  resolveWebhookUrl,
  validateInstancePayload,
  manifestFor,
  providerKeys,
  pollProviders,
} from './manifest';
export { IntegrationError } from './types';
export { bindGatewayContext } from './context';

const adapters = new Map<string, IntegrationAdapter<any>>();

export function registerAdapter(adapter: IntegrationAdapter<any>): void {
  adapters.set(adapter.provider, adapter);
}

for (const adapter of [
  openAiAdapter, zohoAdapter, whatsappAdapter, customHttpAdapter,
  gmailAdapter, googleMapsAdapter, googleSearchAdapter,
  ...portalAdapters,
]) {
  registerAdapter(adapter);
}

export function adapterProviders(): string[] {
  return [...adapters.keys()].sort();
}

function asMode(value: unknown, fallback: DeliveryMode): DeliveryMode {
  return value === 'realtime' || value === 'batch' ? value : fallback;
}

function parseConfig(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function hydrate(row: InstanceRow, provider: string, fallbackMode: DeliveryMode): Promise<ResolvedInstance> {
  const { env } = gatewayContext();
  return {
    id: row.id,
    provider,
    instanceKey: row.instanceKey,
    label: row.label,
    deliveryMode: asMode(row.deliveryMode, fallbackMode),
    baseUrl: row.baseUrl || '',
    config: parseConfig(row.configJson),
    secrets: await decryptSecrets(row.encryptedSecrets, vaultKey(env)),
  };
}

/** Resolve the named instance, or the provider's default one. */
export async function resolveInstance(
  provider: string,
  opts: CallOptions = {},
): Promise<ResolvedInstance> {
  const base = String(provider ?? '').split(':')[0].toLowerCase();
  const manifest = getProviderManifest(base);
  if (!manifest) throw new IntegrationError(base, `unknown provider "${base}"`, 400);
  const { db } = gatewayContext();
  const rev = await cacheRevs(['integrations']).catch(() => 'rev=0');
  const key = `int:inst:${base}:${opts.instanceKey || 'default'}:${rev}`;
  const row = manifest.instanceRequired || opts.instanceKey
    ? await cached<InstanceRow | null>(key, 300_000, async () =>
        opts.instanceKey ? getByKey(db, base, opts.instanceKey) : getDefault(db, base),
      )
    : null;
  if (!row) {
    if (!manifest.instanceRequired) {
      // e.g. OpenAI-compatible: no row yet = the global Settings pool answers.
      return {
        id: 'ai-gateway', provider: base, instanceKey: 'gateway', label: manifest.label,
        deliveryMode: 'realtime', baseUrl: '', config: {}, secrets: {},
      };
    }
    const what = opts.instanceKey ? `instance "${opts.instanceKey}"` : 'a default instance';
    throw new IntegrationError(base, `${manifest.label} has no ${what} configured`, 409);
  }
  if (!row.enabled) {
    throw new IntegrationError(base, `${manifest.label} instance "${row.instanceKey}" is disabled`, 409);
  }
  return hydrate(row, base, manifest.defaultDeliveryMode);
}

/** The ONE way any module talks to an outside service. */
export async function call<T = unknown>(provider: string, opts: CallOptions = {}): Promise<T> {
  const raw = String(provider ?? '').trim().toLowerCase();
  const [base, slug] = raw.split(':');
  const adapter = adapters.get(base);
  if (!adapter) {
    const manifest = manifestFor(base);
    if (!manifest) throw new IntegrationError(base, `unknown provider "${base}"`, 400);
    throw new IntegrationError(base, `no adapter registered for "${base}"`, 501);
  }
  const instance = await resolveInstance(base, { instanceKey: opts.instanceKey || slug || undefined });
  return adapter.connect(instance) as Promise<T>;
}

/** Health probe used by the console's Test button. */
export async function testInstance(provider: string, instanceKey: string): Promise<{ ok: boolean; detail: string }> {
  const client: any = await call(provider, { instanceKey });
  if (typeof client?.ping === 'function') {
    const res = await client.ping();
    return { ok: res?.ok !== false, detail: JSON.stringify(res) };
  }
  if (typeof client?.health === 'function') {
    const health = client.health();
    return { ok: Array.isArray(health) ? health.length > 0 : !!health, detail: `keys: ${client.keyCount ?? 0}` };
  }
  return { ok: true, detail: 'connected' };
}
