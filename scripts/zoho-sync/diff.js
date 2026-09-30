// diff.js — pure comparison logic (no I/O, no env, fully unit-testable).
// Decides WHAT changed between the Zoho payload and DB state; persist.js
// applies it, analyze.js spends AI only on what needs it.

const { cleanHtml, isRealSalesComment } = require('./comments');

// Only these statuses ever enter the AI/comment pipeline. Drafts (and void)
// persist as metadata for visibility but never burn AI budget.
const PROCESSABLE = new Set(['sent', 'accepted', 'declined', 'confirmed']);

// ── Fingerprint ────────────────────────────────────────────────────────────
// Id-order-proof: {v:3, byEst:{estimateId:{m, ids}}} with sorted keys, so any
// added comment (whatever its id) or metadata change breaks the string.
// byEst doubles as the per-estimate baseline for exact newcomer detection.
// v3 (2026-09-29): v2 fingerprints were stored by CAPPED ticks that deferred
// work items without persisting them — the deferred comment ids got baked
// into the fp, so every later tick read "no change" and skipped them forever
// (proven live: 49 real 28/09 sales comments invisible to the analyzer).
// Bumping the version invalidates all v2 values → one transitional full pass
// via the max-id fallback, then v3 values (stored only on complete passes).
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
  const fp = JSON.stringify({ v: 3, byEst });
  const map = new Map(Object.entries(byEst).map(([k, v]) => [k, new Set(v.ids)]));
  return { fp, byEst: map };
}

// Stored fingerprint → per-estimate id sets. Null on legacy/corrupt values →
// caller falls back to max-id compare (one transitional full pass). Only v3
// is accepted — v2 values predate the complete-pass-only store rule and may
// contain ids that were never persisted (see buildFingerprint).
function parseFingerprint(raw) {
  try {
    if (typeof raw !== 'string' || !raw.startsWith('{')) return null;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== 3 || !obj.byEst || typeof obj.byEst !== 'object') return null;
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
// targetedIds: the runner's narrowed comment-target set. Rows outside it were
// deliberately NOT fetched (steady closed rows) — they skip, they must NOT
// count as fetch failures (or every tick would fail the run). A targeted row
// with no bucket is a genuine fetch failure.
function selectWorkItems({ estimates, existingByEstId, fetchedByEst, forced, targetedIds = null }) {
  const workItems = [];
  let skipped = 0;
  let failed = 0;
  for (const est of estimates) {
    const estId = est.estimate_id;
    const statusLower = String(est.status ?? '').toLowerCase();
    if (!PROCESSABLE.has(statusLower)) { skipped++; continue; }
    if (forced && statusLower !== 'sent') { skipped++; continue; }
    const existingEstimate = existingByEstId.get(estId);
    const lastModified = est.last_modified_time ? new Date(est.last_modified_time) : null;
    const statusChanged = !existingEstimate || existingEstimate.status !== est.status;
    const neverAnalyzed = !existingEstimate?.classification;
    const modifiedSinceLastSync = !!lastModified && !!existingEstimate &&
      new Date(lastModified).getTime() > new Date(existingEstimate.lastSyncTime).getTime();
    const fetched = fetchedByEst.get(estId);
    if (!fetched) {
      if (targetedIds && !targetedIds.has(estId)) { skipped++; continue; }
      failed++; continue;
    }
    const needsProcessing = forced || statusChanged || neverAnalyzed || modifiedSinceLastSync || fetched.hasNew;
    if (!needsProcessing) { skipped++; continue; }
    workItems.push({
      estId,
      custName: est.customer_name,
      total: parseFloat(est.total),
      dateVal: est.date,
      estStatus: est.status,
      // Oldest-first drain order (runner caps AI items per tick so the pool
      // always fits inside the 5-min window — see AI_PER_TICK_CAP).
      modified: est.last_modified_time || '',
      closeOut: String(est.status ?? '').toLowerCase() !== 'sent',
      fetched,
    });
  }
  return { workItems, skipped, failed };
}

// ── Capped-tick fingerprint merge ──────────────────────────────────────────
// 2026-09-30 starvation incident: the fingerprint was stored ONLY on complete
// (uncapped) passes, so during a perpetual backlog every tick compared against
// a frozen baseline — each processed item re-flagged hasNew=true next tick
// (its ids were never baked in) and, sorted by ancient last_modified_time,
// the same oldest rows burned all 10 AI slots every tick while newer rows
// (e.g. EST-023571) starved for hours. Fix: on a capped-but-clean tick, store
// a MERGED fingerprint — current ids for the estIds actually persisted this
// tick, old baseline kept for everything deferred. Invariant (the 28/09
// lesson): the fp may only ever contain ids already in D1, so deferred rows
// keep their old baseline and stay visible. Pure: no I/O.
function mergeFingerprintForProcessed(storedRaw, estimates, fetchedByEst, succeededIds) {
  let base = null;
  try {
    const obj = typeof storedRaw === 'string' && storedRaw.startsWith('{') ? JSON.parse(storedRaw) : null;
    if (obj && obj.v === 3 && obj.byEst && typeof obj.byEst === 'object') base = obj;
  } catch { base = null; }
  const byEst = { ...(base?.byEst || {}) };
  const byId = new Map((estimates || []).map((e) => [String(e.estimate_id), e]));
  for (const estId of succeededIds || []) {
    const est = byId.get(String(estId));
    const bucket = fetchedByEst?.get?.(String(estId)) || fetchedByEst?.get?.(estId);
    if (!est || !bucket) continue;
    const ids = [];
    for (const c of bucket.comments || []) {
      if (!isRealSalesComment(cleanHtml(c.description || ''), c.commented_by, c.comment_type)) continue;
      ids.push(String(c.comment_id));
    }
    byEst[String(estId)] = {
      m: [est.status, est.total, est.last_modified_time].join('|'),
      ids: [...new Set(ids)].sort(),
    };
  }
  return JSON.stringify({ v: 3, byEst });
}

module.exports = {
  PROCESSABLE,
  buildFingerprint,
  parseFingerprint,
  diffMetadata,
  detectTransitions,
  computeHasNew,
  selectWorkItems,
  mergeFingerprintForProcessed,
};
