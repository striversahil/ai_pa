#!/usr/bin/env node

/**
 * portal-poller-runner.js — pull side of the unified ingestion pipeline.
 *
 * TradeIndia / Justdial / Alibaba do not always push: some accounts expose a
 * pull endpoint. The instance config carries `pullUrl` (+ `pullAuth`), the
 * secrets carry the credential; this runner fetches the feed and replays each
 * item through the SAME inbound door (HMAC-signed with the instance's
 * webhookSecret), so dedupe/mapping/processing stay in one place.
 *
 * Instances without a `pullUrl` are skipped — a push-only portal is normal.
 */

const crypto = require('node:crypto');
const { requireEnv, workerRequest } = require('./runner-lib');

const PROVIDERS = ['tradeindia', 'justdial', 'alibaba'];
const MAX_PAGES = 3;

function sign(secret, raw) {
  return crypto.createHmac('sha256', secret).update(raw).digest('base64');
}

function authHeaders(instance) {
  const secrets = instance.secrets || {};
  const headers = { Accept: 'application/json' };
  if (secrets.apiKey) headers['x-api-key'] = String(secrets.apiKey);
  if (secrets.apiToken) headers.Authorization = `Bearer ${secrets.apiToken}`;
  if (secrets.username && secrets.password) {
    headers.Authorization = 'Basic ' + Buffer.from(`${secrets.username}:${secrets.password}`).toString('base64');
  }
  return headers;
}

function itemsOf(body) {
  if (Array.isArray(body)) return body;
  for (const key of ['items', 'data', 'leads', 'enquiries', 'results']) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

async function deliver(provider, instance, item) {
  const raw = JSON.stringify(item);
  const secret = String(instance.secrets?.webhookSecret || '');
  if (!secret) throw new Error('instance has no webhookSecret');
  const res = await fetch(
    `${process.env.WORKER_URL}/api/webhooks/${provider}/${instance.instanceKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ingest-Signature': sign(secret, raw) },
      body: raw,
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!res.ok) throw new Error(`webhook ${provider}: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  const out = await res.json().catch(() => ({}));
  return Boolean(out?.duplicate);
}

async function pollProvider(provider) {
  let instance;
  try {
    instance = await workerRequest(`/api/runner/integrations/resolve?provider=${provider}&instanceKey=default`, { timeoutMs: 15000 });
  } catch (error) {
    console.log(`portal-poller: ${provider} not configured (${error?.message || error})`);
    return { seen: 0, duplicates: 0 };
  }
  const pullUrl = String(instance.config?.pullUrl || '');
  if (!pullUrl) {
    console.log(`portal-poller: ${provider} is push-only`);
    return { seen: 0, duplicates: 0 };
  }
  if (!/^https:\/\//i.test(pullUrl)) {
    throw new Error(`${provider}: pullUrl must be https`);
  }
  let seen = 0;
  let duplicates = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(pullUrl);
    url.searchParams.set('page', String(page));
    const res = await fetch(url, { headers: authHeaders(instance), signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`${provider} feed: HTTP ${res.status}`);
    const items = itemsOf(await res.json().catch(() => ({})));
    if (!items.length) break;
    for (const item of items) {
      seen += 1;
      if (await deliver(provider, instance, item)) duplicates += 1;
    }
    if (items.length < 20) break;
  }
  console.log(`portal-poller: ${provider} ${seen} pulled, ${duplicates} already staged`);
  return { seen, duplicates };
}

async function main() {
  requireEnv();
  for (const provider of PROVIDERS) {
    try {
      await pollProvider(provider);
    } catch (error) {
      console.error(`portal-poller: ${provider} failed: ${error?.message || error}`);
    }
  }
}

main().catch((error) => {
  console.error(`portal-poller: ${error?.message || error}`);
  process.exit(1);
});
