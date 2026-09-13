#!/usr/bin/env node

/**
 * enquiry-memory-backfill-runner.js — one-off + periodic price-memory backfill.
 *
 * Pages finalized enquiry line items from the worker
 * (GET /api/runner/enquiry-memory/finalized), embeds the technical spec text
 * (name | qty | spec — never client PII) via the HF MiniLM 384-dim router, and
 * upserts to the Pinecone `enquiry-items` index, `uncategorized` namespace
 * (backfill rows predate KYP categorization; the intake job files new items
 * under their category namespace).
 *
 * Modes:
 *   node scripts/enquiry-memory-backfill-runner.js --dry-run [--limit N]
 *     Report only: counts of priced items, embedding coverage, slot coverage.
 *     Needs WORKER_URL + SHARED_SECRET only.
 *   node scripts/enquiry-memory-backfill-runner.js [--limit N]
 *     Full backfill. Needs HF_API_KEY + PINECONE_HOST + PINECONE_API_KEY too.
 *
 * Env: WORKER_URL, SHARED_SECRET, HF_API_KEY, PINECONE_HOST, PINECONE_API_KEY.
 */

const { workerRequest } = require('./runner-lib');

const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const ENQUIRY_CAP = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10)) : Infinity;

const HF_ROUTER_URL =
  'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction';

const missing = [];
if (!process.env.WORKER_URL) missing.push('WORKER_URL');
if (!process.env.SHARED_SECRET) missing.push('SHARED_SECRET');
if (!DRY_RUN) {
  if (!process.env.HF_API_KEY) missing.push('HF_API_KEY');
  if (!process.env.PINECONE_HOST) missing.push('PINECONE_HOST');
  if (!process.env.PINECONE_API_KEY) missing.push('PINECONE_API_KEY');
}
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

function specText(it) {
  return [it.name, it.qty, it.spec].map((s) => String(s || '').trim()).filter(Boolean).join(' | ').slice(0, 1000);
}

function memId(row) {
  return `enq:${row.enquiryId}:item:${row.itemIndex}`;
}

async function embedBatch(texts) {
  const res = await fetch(HF_ROUTER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.HF_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: texts }),
  });
  if (!res.ok) throw new Error(`HF router HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (Array.isArray(data) && Array.isArray(data[0])) return data;
  if (Array.isArray(data) && typeof data[0] === 'number') return [data];
  throw new Error('unexpected HF response shape');
}

async function pineconeUpsert(namespace, vectors) {
  const host = process.env.PINECONE_HOST.replace(/\/+$/, '');
  const res = await fetch(`${host}/vectors/upsert`, {
    method: 'POST',
    headers: { 'Api-Key': process.env.PINECONE_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ namespace, vectors }),
  });
  if (!res.ok) throw new Error(`pinecone upsert HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  let offset = 0;
  let enquiriesScanned = 0;
  let pricedItems = 0;
  let embedded = 0;
  let upserted = 0;
  let emptySpec = 0;
  const withRates = { withVendorRates: 0, finalOnly: 0 };

  for (;;) {
    const page = await workerRequest(`/api/runner/enquiry-memory/finalized?offset=${offset}&limit=100`);
    const rows = Array.isArray(page.rows) ? page.rows : [];
    if (rows.length === 0) break;
    enquiriesScanned += 1; // counts pages; rows carry the item counts below
    void enquiriesScanned;

    const valid = [];
    for (const r of rows) {
      const text = specText(r);
      if (!text) { emptySpec++; continue; }
      pricedItems++;
      if (Array.isArray(r.rates) && r.rates.length > 0) withRates.withVendorRates++;
      else withRates.finalOnly++;
      valid.push({ row: r, text });
    }

    if (!DRY_RUN && valid.length > 0) {
      for (let i = 0; i < valid.length; i += 50) {
        const batch = valid.slice(i, i + 50);
        const vectors = await embedBatch(batch.map((b) => b.text));
        embedded += vectors.length;
        const ups = batch.map((b, j) => ({
          id: memId(b.row),
          values: vectors[j],
          metadata: {
            name: String(b.row.name || '').slice(0, 300),
            qty: String(b.row.qty || '').slice(0, 120),
            spec: String(b.row.spec || '').slice(0, 2000),
            finalRate: Number(b.row.finalRate),
            ...(b.row.markup !== undefined ? { markup: Number(b.row.markup) } : {}),
            ...(b.row.selectedVendor ? { selectedVendor: String(b.row.selectedVendor).slice(0, 200) } : {}),
            sourceEnquiryId: String(b.row.enquiryId),
            finalizedAt: String(b.row.finalizedAt || ''),
          },
        }));
        for (let k = 0; k < ups.length; k += 100) {
          await pineconeUpsert('uncategorized', ups.slice(k, k + 100));
          upserted += Math.min(100, ups.length - k);
        }
      }
    }

    offset = page.nextOffset;
    if (offset >= ENQUIRY_CAP) break;
    if (page.rows.length === 0 || (page.total !== undefined && offset >= page.total)) break;
  }

  console.log(JSON.stringify({
    mode: DRY_RUN ? 'dry-run' : 'backfill',
    pagesScannedOffset: offset,
    pricedItems,
    emptySpecSkipped: emptySpec,
    withVendorRates: withRates.withVendorRates,
    finalOnly: withRates.finalOnly,
    embedded,
    upserted,
    note: DRY_RUN
      ? 'dry-run: no embeddings or Pinecone writes; re-run without --dry-run with HF_API_KEY + PINECONE_* to index.'
      : 'backfill complete into enquiry-items/uncategorized.',
  }, null, 2));
}

main().catch((e) => { console.error(`enquiry-memory-backfill-runner failed: ${e.message}`); process.exit(1); });
