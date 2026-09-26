// diff.js — pure comparison logic (no I/O, no env, fully unit-testable).
// Decides WHAT changed between the Zoho payload and DB state; persist.js
// applies it, analyze.js spends AI only on what needs it.

const { cleanHtml, isRealSalesComment } = require('./comments');

// Only these statuses ever enter the AI/comment pipeline. Drafts (and void)
// persist as metadata for visibility but never burn AI budget.
const PROCESSABLE = new Set(['sent', 'accepted', 'declined', 'confirmed']);

// ── Fingerprint ────────────────────────────────────────────────────────────
// Id-order-proof: {v:2, byEst:{estimateId:{m, ids}}} with sorted keys, so any
// added comment (whatever its id) or metadata change breaks the string.
// byEst doubles as the per-estimate baseline for exact newcomer detection.
function buildFingerprint(estimates, fetchedByEst) {
  const byEst = {};
  for (const est of [...estimates].sort((a, b) => String(a.estimate_id).localeCompare(String(b.estimate_id)))) {
    const ids = [];
    const bucket = fetchedByEst.get(est.estimate_id);
    for (const c of bucket?.comments || []) {
      if (!isRealSalesComment(cleanHtml(c.description || ''), c.commented_by, c.comment_type)) continue;
      ids.push(String(c.comment_id));
    }
    // m = metadata (status/total/lastmod): a metadata-only change must also
    // break the fingerprint even when no comment arrived.
    byEst[est.estimate_id] = {
      m: [est.status, est.total, est.last_modified_time].join('|'),
      ids: [...new Set(ids)].sort(),
    };
  }
  const fp = JSON.stringify({ v: 2, byEst });
  const map = new Map(Object.entries(byEst).map(([k, v]) => [k, new Set(v.ids)]));
  return { fp, byEst: map };
}

// Stored fingerprint → per-estimate id sets. Null on legacy/corrupt values →
// caller falls back to max-id compare (one transitional full pass).
function parseFingerprint(raw) {
  try {
    if (typeof raw !== 'string' || !raw.startsWith('{')) return null;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== 2 || !obj.byEst || typeof obj.byEst !== 'object') return null;
    return new Map(Object.entries(obj.byEst).map(([k, v]) => [k, new Set((v?.ids || []).map(String))]));
  } catch {
    return null;
  }
}

// ── Metadata diff ──────────────────────────────────────────────────────────
// NOTE: status is EXCLUDED here on purpose — every status move flows through
// detectTransitions → /api/runner/zoho/status, which also writes the
// conversion-close ledger credit. bulk-upsert must never apply a status flip
// silently or wins go uncredited.
function diffMetadata(estimates, existingByEstId) {
  const upserts = [];
  for (const est of estimates) {
    const existing = existingByEstId.get(est.estimate_id);
    const metadata = {
      estimateId: est.estimate_id,
      estimateNumber: est.estimate_number,
      customerName: est.customer_name,
      total: parseFloat(est.total),
      date: est.date,
      status: est.status,
      // Org tag from the fetch boundary ('' for legacy/unknown — the worker
      // backfills it and never overwrites a set value with '').
      organizationId: est._orgId || existing?.organizationId || '',
    };
    if (!existing) { upserts.push(metadata); continue; }
    const unchanged =
      existing.estimateNumber === metadata.estimateNumber &&
      existing.customerName === metadata.customerName &&
      existing.total === metadata.total &&
      existing.date === metadata.date &&
      (existing.organizationId || '') === (metadata.organizationId || '');
    if (!unchanged) upserts.push(metadata);
  }
  return upserts;
}

// ── Status transitions ─────────────────────────────────────────────────────
// Every move in ANY direction (sent→accepted, sent→declined, draft→sent,
// accepted→sent reopen…) — this REPLACES the old per-estimate closed-status
// detail loop: the All-status listing shows the new status directly.
function detectTransitions(estimates, existingByEstId) {
  const out = [];
  for (const est of estimates) {
    const existing = existingByEstId.get(est.estimate_id);
    if (!existing) continue; // brand-new rows arrive via metadata upsert
    if (String(existing.status ?? '') !== String(est.status ?? '')) {
      out.push({ estimateId: est.estimate_id, from: existing.status, to: est.status });
    }
  }
  return out;
}

// ── Comment newcomer detection ─────────────────────────────────────────────
// Exact set-diff against the previous complete run (id-order-proof); max-id
// DB compare only as legacy fallback. Mutates buckets with hasNew.
function computeHasNew(fetchedByEst, prevByEst, maxCommentIdByEst) {
  for (const [estId, bucket] of fetchedByEst) {
    const zohoIds = [];
    for (const c of bucket.comments) {
      if (!isRealSalesComment(cleanHtml(c.description || ''), c.commented_by, c.comment_type)) continue;
      zohoIds.push(String(c.comment_id));
    }
    const prev = prevByEst?.get(estId);
    if (prev) {
      bucket.hasNew = zohoIds.some((id) => !prev.has(id));
    } else {
      let maxZohoId = '';
      for (const id of zohoIds) if (id > maxZohoId) maxZohoId = id;
      bucket.hasNew = maxZohoId > (maxCommentIdByEst[estId] || '');
    }
  }
}

// ── Work-item selection ────────────────────────────────────────────────────
// AI-worthy rows only: processable statuses with a real change signal.
// closeOut flags the just-transitioned rows so analyze.js applies the
// close-out classification (movingSlow 'No') instead of the active one.
// ZOHO_FORCE is a human-triggered migration — even then, only `sent` should
// be reclassified (the analyzer is zoho-SENT-analyzer, not all-status).
function selectWorkItems({ estimates, existingByEstId, fetchedByEst, forced, skippedIds }) {
  const workItems = [];
  let skipped = 0;
  let failed = 0;
  for (const est of estimates) {
    const estId = est.estimate_id;
    const statusLower = String(est.status ?? '').toLowerCase();
    if (!PROCESSABLE.has(statusLower)) { skipped++; continue; }
    if (forced && statusLower !== 'sent') { skipped++; continue; }
    // 20-min comment gate (runner): deliberately unfetched this tick — a
    // skip, NOT a failure. Without this every quiet sent row fails the run.
    if (skippedIds && skippedIds.has(estId)) { skipped++; continue; }
    const existingEstimate = existingByEstId.get(estId);
    const lastModified = est.last_modified_time ? new Date(est.last_modified_time) : null;
    const statusChanged = !existingEstimate || existingEstimate.status !== est.status;
    const neverAnalyzed = !existingEstimate?.classification;
    const modifiedSinceLastSync = !!lastModified && !!existingEstimate &&
      new Date(lastModified).getTime() > new Date(existingEstimate.lastSyncTime).getTime();
    const fetched = fetchedByEst.get(estId);
    if (!fetched) { failed++; continue; }
    const needsProcessing = forced || statusChanged || neverAnalyzed || modifiedSinceLastSync || fetched.hasNew;
    if (!needsProcessing) { skipped++; continue; }
    workItems.push({
      estId,
      custName: est.customer_name,
      total: parseFloat(est.total),
      dateVal: est.date,
      estStatus: est.status,
      closeOut: String(est.status ?? '').toLowerCase() !== 'sent',
      fetched,
    });
  }
  return { workItems, skipped, failed };
}

module.exports = {
  PROCESSABLE,
  buildFingerprint,
  parseFingerprint,
  diffMetadata,
  detectTransitions,
  computeHasNew,
  selectWorkItems,
};
