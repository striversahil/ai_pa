#!/usr/bin/env node

/**
 * zoho-sent-runner.js — Zoho estimate sync + AI analysis on the GH Actions
 * runner (unlimited CPU). Thin orchestrator over scripts/zoho-sync/*:
 *
 *   fetch.js   — Zoho reads (All-status 2-page list + comments + roster + sales orders)
 *   diff.js    — pure change detection (fingerprint, metadata, transitions, work items)
 *   persist.js — worker writes (bulk-upsert, status, comments, classification)
 *   analyze.js — LLM classification + lead-details capture (AI spend, gated)
 *   comments.js — shared pure comment helpers
 *
 * Flow:
 *  1. Sales-orders-today snapshot (every tick — independent of estimates).
 *  2. Fetch all-status estimates (2 pages, newest-modified first) from Zoho.
 *  3. Fetch DB state; fingerprint fast path (zero DB writes when unchanged).
 *  4. Comments for sent/transitioned rows only (drafts never burn Zoho reads).
 *  5. Status transitions → /api/runner/zoho/status (credits conversion closes).
 *  6. Metadata convergence → /api/estimates/bulk-upsert (status excluded —
 *     flips must flow through step 5 or wins go uncredited).
 *  7. Vanished-row fallback: DB-sent rows missing from both pages get one
 *     detail check (deleted in Zoho → last-known status kept).
 *  8. AI classification + lead-details (sent + just-transitioned only).
 *  9. Watermark + fingerprint on a fully-complete pass.
 *
 * Env: WORKER_URL, SHARED_SECRET, GROQ_API_KEYS (comma-separated, rotated).
 * Zoho credentials are inferred from the curl export at
 * zoho_sent/sent_estimates.txt (list scope derived programmatically).
 * SO_ONLY=1: manual lightweight tick — sales-orders-today only, then exit.
 * (The scheduled cron-every-5min.yml job runs the FULL sync; no separate
 * SO_ONLY job is needed since the full sync refreshes sales-orders first.)
 * ZOHO_FORCE=1: reprocess every eligible row.
 */

const fetch = require('./zoho-sync/fetch');
const diff = require('./zoho-sync/diff');
const persist = require('./zoho-sync/persist');
const analyze = require('./zoho-sync/analyze');

const missing = [];
if (!process.env.WORKER_URL) missing.push('WORKER_URL');
if (!process.env.SHARED_SECRET) missing.push('SHARED_SECRET');
// SO_ONLY=1 (manual sales-orders-today tick) needs no LLM keys.
if (process.env.SO_ONLY !== '1' && !process.env.GROQ_API_KEYS) missing.push('GROQ_API_KEYS');
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

async function syncSalesOrders() {
  try {
    const snapshot = await fetch.fetchSalesOrdersToday();
    await persist.postSalesOrdersToday(snapshot);
    console.log(`zoho-sent-runner: sales orders today (${snapshot.date}): ${snapshot.count} (₹${snapshot.totalValue.toLocaleString()})`);
  } catch (err) {
    // Non-fatal: the dashboard tile reads 0 until the next 15-min tick.
    console.warn(`zoho-sent-runner: sales-orders-today sync failed: ${err.message}`);
  }
}

async function main() {
  if (process.env.SO_ONLY === '1') {
    await syncSalesOrders();
    console.log('zoho-sent-runner: SO_ONLY tick done');
    return;
  }

  // 0. Sales orders (independent of estimates — runs before the fast path).
  await syncSalesOrders();

  // 1. All-status estimates, newest-modified first (any mover is in-window).
  console.log('zoho-sent-runner: fetching all-status estimates from Zoho (2 pages)');
  const estimates = await fetch.fetchEstimatesAll(2);
  console.log(`zoho-sent-runner: fetched ${estimates.length} estimates`);
  const forced = process.env.ZOHO_FORCE === '1';

  // 2. DB state for diffing.
  console.log('zoho-sent-runner: fetching current DB state from worker');
  const state = await persist.getDbState();
  const existingByEstId = new Map();
  for (const row of state.estimates || []) existingByEstId.set(row.estimateId, row);
  const maxCommentIdByEst = state.maxCommentIdByEstimate || {};
  const fetchedIds = new Set(estimates.map((e) => e.estimate_id));

  // 3. Comments (network, before any fingerprint compare). Gated: sent rows +
  //    rows that were sent in DB (close-out coverage for sent→draft/void).
  //    Brand-new drafts persist as metadata only — no Zoho reads, no AI.
  const commentTargets = estimates.filter((est) => {
    if (diff.PROCESSABLE.has(String(est.status ?? '').toLowerCase())) return true;
    const existing = existingByEstId.get(est.estimate_id);
    return !!existing && String(existing.status) === 'sent';
  });
  const fetchedByEst = await fetch.fetchCommentsFor(commentTargets, {
    onError: (est, err) => console.warn(`zoho-sent-runner: comment fetch failed for ${est.estimate_number}: ${err.message}`),
  });

  // 4. No-change fast path — identical payload → zero DB reads/writes.
  let prevByEst = null;
  if (!forced && estimates.length > 0) {
    const current = diff.buildFingerprint(estimates, fetchedByEst);
    const fpRes = await persist.getFingerprint();
    prevByEst = diff.parseFingerprint(fpRes?.fingerprint);
    // needsBackfill is true while ANY estimate still needs lead-details
    // capture — keep re-entering so uncaptured rows stay in the loop.
    if (fpRes?.fingerprint && fpRes.fingerprint === current.fp && !fpRes.needsBackfill) {
      console.log('zoho-sent-runner: no change detected and no details pending — skipping full sync (served from fingerprint). 0 DB row reads.');
      return;
    }
  }

  console.log('zoho-sent-runner: fetching NeoDove sales agent roster');
  const agentRoster = await fetch.fetchAgentRoster();
  console.log(`zoho-sent-runner: roster (${agentRoster.length}): ${agentRoster.join(', ') || '(empty)'}`);

  // 5. Comment newcomer detection (exact set-diff; max-id legacy fallback).
  diff.computeHasNew(fetchedByEst, prevByEst, maxCommentIdByEst);

  // 6. Status transitions first — the worker route credits accepted/confirmed
  //    closes into the telecalling ledger and broadcasts both live events.
  const transitions = diff.detectTransitions(estimates, existingByEstId);
  if (transitions.length) await persist.postStatusUpdates(transitions);

  // 7. Metadata convergence (status rides only on brand-new rows; flips went
  //    through step 6 so no win is ever applied silently).
  await persist.postMetadataUpserts(diff.diffMetadata(estimates, existingByEstId));

  // 8. Vanished-row fallback: DB-sent rows on neither list page (deleted in
  //    Zoho → last-known status kept; otherwise the live status is synced).
  for (const local of state.estimates || []) {
    if (String(local.status) !== 'sent' || fetchedIds.has(local.estimateId)) continue;
    try {
      const res = await fetch.fetchVanishedStatus(local.estimateId);
      if (res.gone) {
        console.log(`zoho-sent-runner: ${local.estimateNumber} vanished from Zoho (deleted?) — keeping last-known status`);
      } else if (res.status && res.status !== 'sent') {
        await persist.postStatusUpdates([{ estimateId: local.estimateId, to: res.status }]);
      }
    } catch (err) { console.warn(`zoho-sent-runner: vanished check failed for ${local.estimateNumber}: ${err.message}`); }
  }

  // 9. AI classification (sent + just-transitioned only — see analyze.js).
  const { workItems, skipped, failed: selectFailed } = diff.selectWorkItems({
    estimates, existingByEstId, fetchedByEst, forced,
  });
  console.log(`zoho-sent-runner: ${workItems.length} estimates need AI processing, ${skipped} skipped, ${selectFailed} comment-fetch failures`);
  const { processed, failed: analysisFailed } = await analyze.runAnalysisPool(workItems, agentRoster);

  // 10. Lead-details capture (sent rows with uncaptured blocks only).
  await analyze.captureLeadDetails({ estimates, existingByEstId, fetchedByEst });

  const failed = selectFailed + analysisFailed;

  // 11. Watermark only on a fully-complete pass.
  if (workItems.length > 0 && failed === 0) {
    await persist.advanceWatermark();
    console.log(`zoho-sent-runner: complete pass finished, watermark advanced (needed ${workItems.length}, failed ${failed})`);
  } else {
    console.log(`zoho-sent-runner: incomplete — needed ${workItems.length}, failed ${failed}. Watermark not advanced.`);
  }

  // A failure-free run means the DB matches Zoho — store the fingerprint so
  // the next tick can skip every DB read when unchanged.
  if (failed === 0) {
    const { fp } = diff.buildFingerprint(estimates, fetchedByEst);
    await persist.postFingerprint(fp);
  }

  console.log(`zoho-sent-runner: done — processed ${processed}, skipped ${skipped}, failed ${failed}`);

  if (failed > 0) {
    console.error(`zoho-sent-runner: ${failed} estimate(s) failed. Failing the run.`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('zoho-sent-runner: fatal error:', err.message);
    process.exit(1);
  });
}

// Back-compat re-exports (no in-repo importers; kept for external scripts).
module.exports = {
  classifyEstimate: analyze.classifyEstimate,
  buildClassification: analyze.buildClassification,
  defaultClassification: analyze.defaultClassification,
  fetchAgentRoster: fetch.fetchAgentRoster,
};
