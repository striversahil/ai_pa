// integrations-gateway.ts — root console for provider instances + ingested log.
//
// Disjoint from the hub console in routes/integrations.ts (mig 0180): this file
// owns /instances*, /manifest and /ingested*; the hub keeps /connectors*, /sources*,
// /events*. Register this one AFTER the hub so its literal paths win.

import type { Hono } from 'hono';
import { adminGuard } from '../context';
import { readBody } from '../http';
import {
  bindGatewayContext,
  manifestFor,
  PROVIDER_MANIFESTS,
  MANIFEST_VERSION,
  MANIFEST_CATEGORIES,
  validateInstancePayload,
  testInstance,
  IntegrationError,
} from '../../modules/integrations/gateway';
import { clearDefault, deleteInstance, getByKey, getInstance, listInstances, upsertInstance } from '../../modules/integrations/gateway/store';
import { decryptSecrets, encryptSecrets, vaultKey } from '../../modules/integrations/gateway/vault';
import type { InstanceRow, InstanceView } from '../../modules/integrations/gateway/types';
import { parsePageQuery } from '../../shared/paging';
import { safeJsonObject } from '../../shared/json';
import { getRow, ingestStats, listIngested, replayRow } from '../../modules/ingestion/store';
import { processIngestedRow } from '../../modules/ingestion/processor';

function normalizeKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}

async function toView(row: InstanceRow, env: Record<string, unknown>): Promise<InstanceView> {
  const secrets = await decryptSecrets(row.encryptedSecrets, vaultKey(env));
  return {
    id: row.id,
    provider: row.provider,
    instanceKey: row.instanceKey,
    label: row.label,
    isDefault: Number(row.isDefault) === 1 || row.isDefault === true,
    enabled: Number(row.enabled) === 1 || row.enabled === true,
    deliveryMode: row.deliveryMode === 'realtime' ? 'realtime' : 'batch',
    baseUrl: row.baseUrl || '',
    config: safeJsonObject(row.configJson),
    hasSecrets: Object.keys(secrets).length > 0,
    secretKeys: Object.keys(secrets).sort(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Merge non-empty values; an explicit '' removes a stored key. */
function merge(base: Record<string, unknown>, patch: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  if (!patch || typeof patch !== 'object') return out;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === '' || value === null || value === undefined) delete out[key];
    else out[key] = value;
  }
  return out;
}

export function registerIntegrationsGatewayRoutes(app: Hono<{ Bindings: any }>): void {
  app.get('/api/integrations/manifest', async (c) => {
    const denied = await adminGuard(c);
    if (denied) return denied;
    return c.json({ version: MANIFEST_VERSION, categories: MANIFEST_CATEGORIES, providers: PROVIDER_MANIFESTS });
  });

  app.get('/api/integrations/instances', async (c) => {
    const denied = await adminGuard(c);
    if (denied) return denied;
    bindGatewayContext({ db: c.env.DB, env: c.env });
    const rows = await listInstances(c.env.DB);
    const instances = await Promise.all(rows.map((row) => toView(row, c.env)));
    const stats = await ingestStats(c.env.DB);
    return c.json({ instances, providers: PROVIDER_MANIFESTS, version: MANIFEST_VERSION, categories: MANIFEST_CATEGORIES, stats });
  });

  app.post('/api/integrations/instances', async (c) => {
    const denied = await adminGuard(c);
    if (denied) return denied;
    bindGatewayContext({ db: c.env.DB, env: c.env });
    const body = await readBody(c);
    const provider = String(body?.provider ?? '').toLowerCase();
    const manifest = manifestFor(provider);
    if (!manifest) return c.json({ error: `unknown provider "${provider}"` }, 400);
    const instanceKey = normalizeKey(body?.instanceKey) || 'default';
    const existing = await getByKey(c.env.DB, provider, instanceKey);
    const key = vaultKey(c.env);
    const previousSecrets = existing ? await decryptSecrets(existing.encryptedSecrets, key) : {};
    const secrets = merge(previousSecrets, body?.secrets) as Record<string, string>;
    const config = merge(existing ? safeJsonObject(existing.configJson) : {}, body?.config);
    const check = validateInstancePayload(provider, config, secrets);
    if (!check.ok) return c.json({ error: check.errors.join('; '), errors: check.errors }, 400);
    const deliveryMode = body?.deliveryMode === 'realtime' ? 'realtime' : body?.deliveryMode === 'batch'
      ? 'batch' : manifest.defaultDeliveryMode;
    const label = String(body?.label ?? '').trim().slice(0, 120) || `${manifest.label} ${instanceKey}`.trim();
    const id = await upsertInstance(c.env.DB, {
      provider,
      instanceKey,
      label,
      isDefault: body?.isDefault === true,
      enabled: body?.enabled !== false,
      deliveryMode,
      baseUrl: String(body?.baseUrl ?? '').trim(),
      encryptedSecrets: await encryptSecrets(secrets, key),
      configJson: JSON.stringify(config),
    }, existing);
    if (body?.isDefault === true) await clearDefault(c.env.DB, provider, id);
    const row = await getInstance(c.env.DB, id);
    return c.json({ instance: row ? await toView(row, c.env) : null }, existing ? 200 : 201);
  });

  app.patch('/api/integrations/instances/:id', async (c) => {
    const denied = await adminGuard(c);
    if (denied) return denied;
    bindGatewayContext({ db: c.env.DB, env: c.env });
    const row = await getInstance(c.env.DB, c.req.param('id') ?? '');
    if (!row) return c.json({ error: 'instance not found' }, 404);
    const body = await readBody(c);
    const manifest = manifestFor(row.provider);
    const key = vaultKey(c.env);
    const previousSecrets = await decryptSecrets(row.encryptedSecrets, key);
    const secrets = merge(previousSecrets, body?.secrets) as Record<string, string>;
    const config = merge(safeJsonObject(row.configJson), body?.config);
    const check = manifest ? validateInstancePayload(row.provider, config, secrets) : { ok: true, errors: [] };
    if (!check.ok) return c.json({ error: check.errors.join('; '), errors: check.errors }, 400);
    const deliveryMode = body?.deliveryMode === 'realtime' || body?.deliveryMode === 'batch'
      ? body.deliveryMode : row.deliveryMode;
    const isDefault = body?.isDefault === undefined ? Number(row.isDefault) === 1 : body.isDefault === true;
    await upsertInstance(c.env.DB, {
      provider: row.provider,
      instanceKey: row.instanceKey,
      label: String(body?.label ?? row.label).trim().slice(0, 120) || row.label,
      isDefault,
      enabled: body?.enabled === undefined ? Number(row.enabled) === 1 : body.enabled !== false,
      deliveryMode,
      baseUrl: body?.baseUrl === undefined ? row.baseUrl : String(body.baseUrl).trim(),
      encryptedSecrets: await encryptSecrets(secrets, key),
      configJson: JSON.stringify(config),
    }, row);
    if (isDefault) await clearDefault(c.env.DB, row.provider, row.id);
    const fresh = await getInstance(c.env.DB, row.id);
    return c.json({ instance: fresh ? await toView(fresh, c.env) : null, provider: manifest?.provider ?? row.provider });
  });

  app.delete('/api/integrations/instances/:id', async (c) => {
    const denied = await adminGuard(c);
    if (denied) return denied;
    const row = await getInstance(c.env.DB, c.req.param('id') ?? '');
    if (!row) return c.json({ error: 'instance not found' }, 404);
    await deleteInstance(c.env.DB, row.id);
    return c.json({ ok: true });
  });

  app.post('/api/integrations/instances/:id/test', async (c) => {
    const denied = await adminGuard(c);
    if (denied) return denied;
    bindGatewayContext({ db: c.env.DB, env: c.env });
    const row = await getInstance(c.env.DB, c.req.param('id') ?? '');
    if (!row) return c.json({ error: 'instance not found' }, 404);
    try {
      const result = await testInstance(row.provider, row.instanceKey);
      return c.json(result);
    } catch (error: any) {
      const status = error instanceof IntegrationError ? error.status : 502;
      return c.json({ ok: false, detail: String(error?.message ?? 'test failed') }, status as any);
    }
  });

  app.get('/api/integrations/ingested/stats', async (c) => {
    const denied = await adminGuard(c);
    if (denied) return denied;
    return c.json(await ingestStats(c.env.DB));
  });

  app.get('/api/integrations/ingested', async (c) => {
    const denied = await adminGuard(c);
    if (denied) return denied;
    const query = parsePageQuery((key) => c.req.query(key));
    const page = await listIngested(c.env.DB, query, {
      source: c.req.query('source') || undefined,
      status: c.req.query('status') || undefined,
      mode: c.req.query('mode') || undefined,
    });
    return c.json(page);
  });

  app.get('/api/integrations/ingested/:id', async (c) => {
    const denied = await adminGuard(c);
    if (denied) return denied;
    const row = await getRow(c.env.DB, c.req.param('id') ?? '');
    if (!row) return c.json({ error: 'row not found' }, 404);
    return c.json({ row });
  });

  app.post('/api/integrations/ingested/:id/replay', async (c) => {
    const denied = await adminGuard(c);
    if (denied) return denied;
    bindGatewayContext({ db: c.env.DB, env: c.env });
    const replayed = await replayRow(c.env.DB, c.req.param('id') ?? '');
    if (!replayed) return c.json({ error: 'row not found' }, 404);
    const outcome = await processIngestedRow({ db: c.env.DB, env: c.env }, c.req.param('id') ?? '');
    return c.json({ ok: outcome.ok, coreRefId: outcome.coreRefId ?? '', error: outcome.error ?? '' });
  });
}
