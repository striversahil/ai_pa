#!/usr/bin/env node

/**
 * ingestion-batch-runner.js — the scheduled half of the unified ingestion
 * pipeline (mig 0183).
 *
 * Batch instances are staged by the webhook door but NOT processed inline:
 * this runner leases them (POST /api/runner/ingestion/claim), then acks
 * (POST /api/runner/ingestion/ack). The Worker owns the mapper + domain
 * write, so there is exactly one normalization implementation — the runner
 * only provides the reliable schedule and the retry loop.
 *
 * Zoho estimate rows are normalized + linked here; the Estimate row itself
 * is written by the zoho-sent-runner (single writer, org/status rules).
 */

const { requireEnv, workerRequest } = require('./runner-lib');

const LIMIT = 100;

async function main() {
  requireEnv();
  const claimed = await workerRequest('/api/runner/ingestion/claim', {
    method: 'POST',
    body: { limit: LIMIT, mode: 'batch' },
    timeoutMs: 30000,
  });
  const rows = Array.isArray(claimed.rows) ? claimed.rows : [];
  if (!rows.length) {
    console.log('ingestion-batch: nothing staged');
    return;
  }
  const bySource = rows.reduce((acc, row) => {
    acc[row.source] = (acc[row.source] || 0) + 1;
    return acc;
  }, {});
  console.log(`ingestion-batch: claimed ${rows.length} (${JSON.stringify(bySource)})`);

  const ack = await workerRequest('/api/runner/ingestion/ack', {
    method: 'POST',
    body: { results: rows.map((row) => ({ id: row.id })) },
    timeoutMs: 120000,
  });
  console.log(`ingestion-batch: processed ${ack.processed || 0}, failed ${ack.failed || 0}`);
}

main().catch((error) => {
  console.error(`ingestion-batch: ${error?.message || error}`);
  process.exit(1);
});
