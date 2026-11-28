// integrations-ingestion.test.mjs — contract guard for the unified
// integration gateway + ingestion pipeline (mig 0183).
//
// Static (no DB, no network): proves the ONE-door/ONE-facade invariants that
// would otherwise silently regress — a provider without a manifest, a
// webhook door that skips verification, a processor that writes core tables,
// or a second poller creeping back in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
  assert.equal(manifest.defaults.maxRetriesBeforeDeadLetter, 3);
  const providers = Object.entries(manifest.providers);
  assert.equal(providers.length, 18, `expected 18 providers after NeoDove removal, saw ${providers.length}`);
  assert.ok(!manifest.providers.neodove, 'NeoDove must not be an integration provider');
  for (const [key, provider] of providers) {
    assert.ok(provider.label && provider.category, `${key}: label/category missing`);
    assert.ok(['inbound', 'outbound', 'bidirectional'].includes(provider.direction), `${key}: bad direction`);
    assert.ok(Array.isArray(provider.auth?.configFields), `${key}: auth.configFields missing`);
    assert.ok(Array.isArray(provider.auth?.secretFields), `${key}: auth.secretFields missing`);
    if (provider.inbound?.supported) {
      assert.ok(provider.inbound.mapper, `${key}: inbound mapper missing`);
      assert.ok(provider.inbound.idempotencyKey, `${key}: idempotency missing`);
    }
  }
  const zoho = manifest.providers.zoho;
  assert.deepEqual(zoho.auth.configFields.find((f) => f.key === 'authMode').options, ['oauth2', 'raw_headers_bridge']);
  assert.ok(zoho.auth.secretFields.some((f) => f.requiredWhen?.authMode === 'oauth2'), 'raw bridge must gate its secret');
  assert.ok(manifest.providers.google_maps.auth.configFields.some((f) => f.key === 'regionCode'));
  assert.equal(manifest.providers.openai.outbound.supported, true);
});

test('Gmail is the ONLY poller and it runs every 5 minutes', () => {
  const manifest = JSON.parse(readBackend('src/modules/integrations/manifest.json'));
  const pollers = Object.entries(manifest.providers).filter(([, p]) => p.inbound?.poller || p.inbound?.poll?.supported);
  assert.deepEqual(pollers.map(([key]) => key), ['gmail']);
  assert.equal(pollers[0][1].inbound.poller.intervalMinutes, 5);
  assert.equal(pollers[0][1].inbound.transport, 'poller_cron');
  for (const [key, provider] of Object.entries(manifest.providers)) {
    if (key !== 'gmail' && provider.inbound?.supported) assert.notEqual(provider.inbound.transport, 'poller_cron', `${key} must be webhook-only`);
  }
  const poll = readBackend('src/modules/ingestion/gmail-poll.ts');
  assert.match(poll, /listInstances/);
  assert.match(poll, /insertIngested/);
  assert.match(poll, /lastPollAt/);
  assert.match(readBackend('src/worker/cron.ts'), /pollGmail/);
  assert.ok(!existsSync(join(ROOT, 'scripts/portal-poller-runner.js')), 'portal poller runner must be gone');
  assert.ok(!read('.github/workflows/cron-every-15min.yml').includes('portal-poller'));
});

test('manifest loader is the only source for providers + URLs', () => {
  const loader = readBackend('src/modules/integrations/gateway/manifest.ts');
  assert.match(loader, /from '\.\.\/manifest\.json'/);
  for (const fn of ['getProviderManifest', 'listProviderManifests', 'resolveWebhookUrl', 'validateInstancePayload', 'idempotencyFor', 'verificationFor', 'pollProviders']) {
    assert.match(loader, new RegExp(`export function ${fn}`), `${fn} missing from manifest.ts`);
  }
  assert.match(loader, /requiredWhen/);
  assert.match(loader, /MANIFEST_VERSION/);
});

test('every provider has an adapter + every inbound provider a mapper', () => {
  const manifest = JSON.parse(readBackend('src/modules/integrations/manifest.json'));
  const index = readBackend('src/modules/integrations/gateway/index.ts');
  const adapterSource = [
    index,
    ...readdirSync(join(BACKEND, 'src/modules/integrations/gateway/adapters'))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readBackend(`src/modules/integrations/gateway/adapters/${file}`)),
  ].join('\n');
  const mappers = readBackend('src/modules/ingestion/mappers/index.ts');
  for (const provider of Object.keys(manifest.providers)) {
    assert.match(adapterSource, new RegExp(provider), `${provider} missing from the adapter registry`);
  }
  assert.match(index, /export async function call/);
  assert.match(mappers, /export function mapperFor/);
  assert.match(mappers, /export function mapperSources/);
  for (const name of ['b2b-portals', 'social-meta', 'social-linkedin', 'social-telegram', 'forms', 'email', 'zoho-estimate', 'custom']) {
    assert.ok(mappers.includes(name), `mapper ${name} missing`);
  }
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
  assert.match(door, /config\.verifyToken/);
});

test('the processor never writes an ERP core table', () => {
  const processor = readBackend('src/modules/ingestion/processor.ts')
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  for (const table of ['core_customer', 'core_lead', 'core_estimate']) {
    assert.ok(!processor.includes(table), `processor must not write ${table}`);
  }
  assert.match(processor, /enquiryCreate\(/);
  assert.match(processor, /qualified: false/);
  assert.match(processor, /prisma\.email\.create/);
});

test('ingestion is registered in the worker behind auth exemption + no auto-live', () => {
  const worker = readBackend('src/worker.ts');
  assert.match(worker, /registerWebhookRoutes\(app\)/);
  assert.match(worker, /registerIntegrationsGatewayRoutes\(app\)/);
  assert.match(readBackend('src/worker/context.ts'), /'\/api\/webhooks\/'/);
});

test('runners + workflows exist for batch processing only', () => {
  assert.ok(read('scripts/ingestion-batch-runner.js').includes('/api/runner/ingestion/claim'));
  assert.match(read('.github/workflows/cron-every-5min.yml'), /node scripts\/ingestion-batch-runner\.js/);
  assert.ok(!read('.github/workflows/cron-every-15min.yml').includes('portal-poller'));
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
