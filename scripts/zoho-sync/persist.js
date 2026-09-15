// persist.js — all worker writes (D1 via /api/runner/*, Bearer SHARED_SECRET).
// No Zoho reads, no AI. Every function is a thin POST wrapper so the
// orchestrator reads as a pipeline: diff → persist → analyze.

const { workerRequest } = require('../runner-lib');
const { cleanHtml } = require('./comments');

// Estimates + max comment id per estimate + classifications (one call).
async function getDbState() {
  return workerRequest('/api/runner/zoho/state');
}

async function getFingerprint() {
  return workerRequest('/api/runner/zoho/fingerprint').catch(() => ({ fingerprint: null }));
}

async function postFingerprint(fingerprint) {
  return workerRequest('/api/runner/zoho/fingerprint', {
    method: 'POST',
    body: { fingerprint },
  }).catch((err) => console.warn(`zoho-sync/persist: fingerprint store failed: ${err.message}`));
}

// Non-status metadata convergence. Status moves NEVER go through here —
// they use postStatusUpdates so conversion closes get ledger-credited.
async function postMetadataUpserts(upserts) {
  if (!upserts.length) { console.log('zoho-sync/persist: metadata unchanged'); return; }
  await workerRequest('/api/estimates/bulk-upsert', {
    method: 'POST',
    body: { estimates: upserts },
  });
  console.log(`zoho-sync/persist: metadata upserted ${upserts.length}`);
}

// Status transitions (any direction). The worker route writes the status,
// credits accepted/confirmed closes into the telecalling ledger (idempotent),
// and broadcasts estimates + telecalling live events.
async function postStatusUpdates(transitions) {
  if (!transitions.length) return 0;
  await workerRequest('/api/runner/zoho/status', {
    method: 'POST',
    body: { updates: transitions.map((t) => ({ estimateId: t.estimateId, status: t.to })) },
  });
  console.log(`zoho-sync/persist: ${transitions.length} status transitions synced`);
  return transitions.length;
}

// Raw Zoho comments → D1 (batched; small requests).
async function postComments(estimateId, comments) {
  const toUpsert = comments.map((c) => ({
    commentId: c.comment_id,
    estimateId,
    description: cleanHtml(c.description || ''),
    commentedBy: c.commented_by,
    date: c.date,
    dateDescription: c.date_description,
    dateFormatted: c.date_formatted || null,
  }));
  for (let i = 0; i < toUpsert.length; i += 50) {
    await workerRequest('/api/runner/zoho/comments', {
      method: 'POST',
      body: { comments: toUpsert.slice(i, i + 50) },
    });
  }
}

async function postClassification(estimateId, classification) {
  await workerRequest('/api/runner/zoho/classification', {
    method: 'POST',
    body: { estimateId, classification },
  });
}

async function postLeadDetails(rows) {
  if (!rows.length) return null;
  return workerRequest('/api/runner/estimates/lead-details', {
    method: 'POST',
    body: { rows },
  });
}

// Watermark: advances last-complete-sync only on a fully-complete pass.
async function advanceWatermark() {
  await workerRequest('/api/estimates/bulk-upsert', {
    method: 'POST',
    body: { estimates: [], lastSyncAt: new Date().toISOString() },
  });
}

async function postSalesOrdersToday(snapshot) {
  await workerRequest('/api/runner/zoho/salesorders-today', {
    method: 'POST',
    body: snapshot,
  });
}

module.exports = {
  getDbState,
  getFingerprint,
  postFingerprint,
  postMetadataUpserts,
  postStatusUpdates,
  postComments,
  postClassification,
  postLeadDetails,
  advanceWatermark,
  postSalesOrdersToday,
};
