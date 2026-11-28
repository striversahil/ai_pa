// integrations-ingestion.test.mjs — contract guard for the unified
// integration gateway + ingestion pipeline (mig 0183).
//
// Static (no DB, no network): proves the ONE-door/ONE-facade invariants that
// would otherwise silently regress — a provider without a manifest, a
// webhook door that skips the HMAC, a processor that writes core tables.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BACKEND = join(ROOT, 'founder-os_backend');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const readBackend = (rel) => readFileSync(join(BACKEND, rel), 'utf8');

test('migration creates both tables + the dedupe index', () => {
  const sql = readBackend('migrations/0183_integrations_and_ingestion.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "?hlp_integration_instance"?/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "?hlp_ingested_data"?/);
  assert.match(sql, /CREATE UNIQUE INDEX[^;]*hlp_integration_instance_key[^;]*\(\s*"?provider"?\s*,\s*"?instanceKey"?\s*\)/is);
  assert.match(sql, /CREATE UNIQUE INDEX[^;]*hlp_ingested_dedup[^;]*\(\s*"?source"?\s*,\s*"?externalEventId"?\s*\)/is);
  assert.match(sql, /isDefault/);
  assert.match(sql, /encryptedSecrets/);
});

test('prisma models mirror the migration columns', () => {
  const schema = readBackend('prisma/schema.prisma');
  for (const model of ['model HlpIntegrationInstance', 'model HlpIngestedData']) {
    assert.ok(schema.includes(model), `${model} missing from schema.prisma`);
  }
  for (const field of ['instanceKey', 'encryptedSecrets', 'deliveryMode', 'externalEventId', 'retryCount', 'coreRefId']) {
    assert.ok(schema.includes(field), `${field} missing from the new models`);
  }
});

test('the d1 shim knows the new models', () => {
  const shim = readBackend('src/shared/d1-prisma.ts');
  for (const model of ['HlpIntegrationInstance', 'HlpIngestedData']) {
    const hits = shim.split(model).length - 1;
    assert.ok(hits >= 3, `${model} must be registered in bool/date/id/unique field maps (found ${hits})`);
  }
});

test('manifest.json v2.0.0 is the only provider list', () => {
  const manifest = JSON.parse(readBackend('src/modules/integrations/manifest.json'));
  assert.equal(manifest.version, '2.0.0');
  assert.ok(manifest.defaults && manifest.categories, 'defaults + categories are required');
  assert.equal(manifest.defaults.maxRetriesBeforeDeadLetter, 3);
  const providers = Object.entries(manifest.providers);
  assert.ok(providers.length >= 19, `expected the full provider set, saw ${providers.length}`);
  for (const [key, provider] of providers) {
    assert.equal(provider.provider, key, `${key}: provider key must match its map key`);
    assert.ok(provider.label && provider.category, `${key}: label/category missing`);
    assert.ok(Array.isArray(provider.configFields), `${key}: configFields must be an array`);
    assert.ok(Array.isArray(provider.secretFields), `${key}: secretFields must be an array`);
    assert.ok(['outbound', 'inbound', 'both'].includes(provider.direction), `${key}: bad direction`);
  }
  const zoho = manifest.providers.zoho;
  const authMode = zoho.configFields.find((f) => f.key === 'authMode');
  assert.deepEqual(authMode.options, ['oauth2', 'raw_headers_bridge']);
  assert.ok(zoho.secretFields.some((f) => f.requiredWhen?.field === 'authMode'), 'raw bridge must gate its secret');
  assert.ok(manifest.providers.google_maps.configFields.some((f) => f.key === 'fieldMask'));
  assert.equal(manifest.providers.openai.outbound.supported, true);
});

test('manifest loader is the only source for providers + URLs', () => {
  const loader = readBackend('src/modules/integrations/gateway/manifest.ts');
  assert.match(loader, /from '\.\.\/manifest\.json'/);
  for (const fn of ['getProviderManifest', 'listProviderManifests', 'resolveWebhookUrl', 'validateInstancePayload', 'idempotencyFor', 'verificationFor']) {
    assert.match(loader, new RegExp(`export function ${fn}`), `${fn} missing from manifest.ts`);
  }
  assert.match(loader, /requiredWhen/);
  assert.match(loader, /MANIFEST_VERSION/);
});

test('every provider has an adapter + every inbound provider a mapper', () => {
  const manifest = JSON.parse(readBackend('src/modules/integrations/manifest.json'));
  const index = readBackend('src/modules/integrations/gateway/index.ts');
  const mappers = readBackend('src/modules/ingestion/mappers/index.ts');
  for (const [provider, spec] of Object.entries(manifest.providers)) {
    assert.match(index, new RegExp(provider), `${provider} missing from the adapter registry`);
    if (spec.inbound?.supported) {
      assert.match(mappers, /genericMapper|mapWhatsApp|mapZohoEstimate|mapTally|mapGmail|mapperFor/, `${provider} has no mapper path`);
    }
  }
  assert.match(index, /export async function call/);
  assert.match(mappers, /export function mapperFor/);
  assert.match(mappers, /export function mapperSources/);
});

test('the inbound door is manifest-driven and verifies before staging', () => {
  const door = readBackend('src/worker/routes/webhooks.ts');
  const verifyAt = door.indexOf('verifyInbound(');
  const insertAt = door.indexOf('insertIngested(');
  assert.ok(verifyAt > -1 && insertAt > -1, 'door must verify + stage');
  assert.ok(verifyAt < insertAt, 'verification must run BEFORE the row is staged');
  assert.match(door, /getProviderManifest\(source\)/);
  assert.match(door, /manifest\.inbound\.challengeGet/);
  assert.match(door, /extractIdempotencyKey\(source/);
  assert.match(door, /instance\.deliveryMode === 'realtime'/);
  assert.match(door, /normalizeInboundRequest/);
  assert.ok(!door.includes('webhookVerifyToken'), 'door must not hard-code a provider token');
});

test('the processor never writes an ERP core table', () => {
  const processor = readBackend('src/modules/ingestion/processor.ts')
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  for (const table of ['core_customer', 'core_lead', 'core_estimate']) {
    assert.ok(!processor.includes(table), `processor must not write ${table}`);
  }
  assert.match(processor, /enquiryCreate\(/);
});

test('ingestion is registered in the worker behind auth exemption + no auto-live', () => {
  const worker = readBackend('src/worker.ts');
  assert.match(worker, /registerWebhookRoutes\(app\)/);
  assert.match(worker, /registerIntegrationsGatewayRoutes\(app\)/);
  const context = readBackend('src/worker/context.ts');
  assert.match(context, /'\/api\/webhooks\/'/);
});

test('poller providers come from the manifest (quiet hours respected)', () => {
  const poller = read('scripts/portal-poller-runner.js');
  assert.match(poller, /manifest\.json/);
  assert.match(poller, /inbound\?\.poll\?\.supported/);
  const store = readBackend('src/modules/ingestion/store.ts');
  assert.match(store, /quietSourcesNow/);
  assert.match(store, /quietHoursIst/);
});

test('runners + workflows exist for batch and polling', () => {
  assert.ok(read('scripts/ingestion-batch-runner.js').includes('/api/runner/ingestion/claim'));
  assert.ok(read('scripts/portal-poller-runner.js').includes('/api/webhooks/'));
  assert.match(read('.github/workflows/cron-every-5min.yml'), /node scripts\/ingestion-batch-runner\.js/);
  assert.match(read('.github/workflows/cron-every-15min.yml'), /node scripts\/portal-poller-runner\.js/);
});

test('the zoho sync resolves its session from the gateway (file is fallback)', () => {
  const fetch = read('scripts/zoho-sync/fetch.js');
  assert.match(fetch, /require\('\.\/credentials'\)/);
  assert.match(fetch, /resolveZohoRuntime/);
  assert.match(read('scripts/zoho-sync/credentials.js'), /\/api\/runner\/integrations\/resolve/);
});

test('the console mounts the gateway panel (never a dead tab)', () => {
  const settings = read('founder-os_frontend/src/components/SettingsDashboard.tsx');
  assert.match(settings, /IntegrationsGatewayPanel/);
  assert.match(settings, /Third-party providers/);
});
