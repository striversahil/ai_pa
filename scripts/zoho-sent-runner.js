#!/usr/bin/env node

/**
 * zoho-sent-runner.js — Zoho estimate sync + AI analysis on the GH Actions
 * runner (unlimited CPU). Thin orchestrator over scripts/zoho-sync/*, which in
 * turn delegate pure/shared logic to the sync core
 * (founder-os_backend/src/shared/sync-core/ — ONE copy of Zoho auth, HTTP
 * retry policies, dates, org identities, change detection, and endpoint/key
 * contracts, also used by crm-runner.js):
 *
 *   fetch.js   — Zoho reads (All-status 2-page list + comments + roster + sales orders)
 *   diff.js    — pure change detection (fingerprint, metadata, transitions, work items)
 *   persist.js — worker writes (bulk-upsert, status, comments, classification)
 *   analyze.js — LLM classification + lead-details capture (AI spend, gated)
 *   comments.js — shared pure comment helpers
 *
 * Flow:
 *  1. Sales-orders-today snapshot (every tick — independent of estimates).
 *  2. Fetch DB state, then all-status estimates (2 pages/org, newest-modified
 *     first, extended until every locally-sent row is covered) from Zoho.
 *  3. Fingerprint fast path (zero DB writes when unchanged).
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
 * founder-os_backend/zoho_sent/sent_estimates.txt (list scope derived programmatically).
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
// SO_ONLY=1 (manual sales-orders-today tick) needs no LLM keys. Now Agnes primary — accept AGNES_API_KEY(S) or AI_KEYS (agnes:...) as LLM source.
const hasLLM = (process.env.GROQ_API_KEYS || process.env.AGNES_API_KEY || process.env.AGNES_API_KEYS || process.env.AI_KEYS || process.env.REQUESTLY_API_KEY);
if (process.env.SO_ONLY !== '1' && !hasLLM) missing.push('GROQ_API_KEYS or AGNES_API_KEY/AI_KEYS');
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

  // 1. DB state first — the local sent ids drive list coverage below.
  console.log('zoho-sent-runner: fetching current DB state from worker');
  const state = await persist.getDbState();
  const sentCoverIds = new Set(
    (state.estimates || []).filter((r) => String(r.status) === 'sent').map((r) => r.estimateId),
  );

  // 2. All-status estimates, newest-modified first (any mover is in-window).
  // Multi-org: fetch.js loops every organization_id in sent_estimates.txt
  // (same login) and namespaces non-primary ids (core zoho-orgs.js).
  // coverIds extends paging per org until every locally-sent row is seen:
  // comments don't bump last_modified_time, so comment-only sent rows sink
  // past page 2 and would otherwise never sync (2026-09-28 incident).
  console.log('zoho-sent-runner: fetching all-status estimates from Zoho (2 pages/org + sent coverage)');
  const estimates = await fetch.fetchEstimatesAll(2, { coverIds: sentCoverIds });
  const primaryOrg = fetch.zohoContext().orgId;
  const perOrg = {};
  for (const e of estimates) perOrg[e._orgId || primaryOrg] = (perOrg[e._orgId || primaryOrg] || 0) + 1;
  console.log(`zoho-sent-runner: fetched ${estimates.length} estimates (${Object.entries(perOrg).map(([o, n]) => `${o}:${n}`).join(', ')})`);
  const forced = process.env.ZOHO_FORCE === '1';
  const existingByEstId = new Map();
  for (const row of state.estimates || []) existingByEstId.set(row.estimateId, row);
  const maxCommentIdByEst = state.maxCommentIdByEstimate || {};
  const fetchedIds = new Set(estimates.map((e) => e.estimate_id));

  // 3. Comments (network, before any fingerprint compare). NARROWED target
  //    set (2026-09-29): steady closed rows (accepted/declined/draft, status
  //    unchanged since DB) carry no new signal — their comments were analyzed
  //    at transition time. Fetching 1300+ threads every tick to rebuild the
  //    fingerprint throttles Zoho into 429s (seen live: transitional pass
  //    burned 14 min + 429s on comment reads). Targets = sent now, DB-sent
  //    (close-out coverage incl. sent→draft/void), or status-changed
  //    (transitions need their final comments). Post-close chatter on steady
  //    closed rows is out of scope for the SENT analyzer.
  //    NOTE (2026-09-26): a 20-min last_modified window gate lived here and
  //    was REVERTED the same day — Zoho does NOT bump last_modified_time on
  //    new comments (proven live: 11:30 comments with 10:58 modified time),
  //    so any metadata-only gate is blind to intraday threads. Newcomer
  //    detection requires the actual comment ids (see buildFingerprint).
  //    Volume is controlled instead by concurrency-6 batching, the per-tick
  //    AI cap, and the skip-gates (slow passes complete uninterrupted).
  const commentTargets = estimates.filter((est) => {
    if (String(est.status ?? '').toLowerCase() === 'sent') return true;
    const existing = existingByEstId.get(est.estimate_id);
    if (!existing) return false;
    if (String(existing.status) === 'sent') return true;
    return String(existing.status ?? '') !== String(est.status ?? '');
  });
  const targetedIds = new Set(commentTargets.map((e) => e.estimate_id));
  console.log(`zoho-sent-runner: fetching comments for ${commentTargets.length} sent-family rows`);
  let commentFetchErrors = 0;
  const fetchedByEst = await fetch.fetchCommentsFor(commentTargets, {
    onError: (est, err) => { commentFetchErrors++; console.warn(`zoho-sent-runner: comment fetch failed for ${est.estimate_number}: ${err.message}`); },
  });

  // 4. No-change fast path — identical payload → zero DB reads/writes.
  // Requires ZERO comment-fetch failures: a partial fetch builds a partial
  // fingerprint that could equal a stored partial one and skip with stale data.
  let prevByEst = null;
  let prevRawFp = null;
  if (!forced && estimates.length > 0 && commentFetchErrors === 0) {
    const current = diff.buildFingerprint(estimates, fetchedByEst);
    const fpRes = await persist.getFingerprint();
    prevRawFp = fpRes?.fingerprint ?? null;
    prevByEst = diff.parseFingerprint(prevRawFp);
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
  //    through step 6 so no win is ever applied silently). primaryOrg lets the
  //    worker reject a reordered org file (would corrupt DB identities).
  await persist.postMetadataUpserts(diff.diffMetadata(estimates, existingByEstId), primaryOrg);

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
  // Per-tick cap: the pool runs single-file (~15s/item with dual LLM
  // calls + pacing), so an uncapped backlog can never finish inside the
  // 5-min tick — the next tick cancels it mid-pool forever and the watermark
  // never advances. Oldest-first drain converges tick by tick instead; each
  // completed item persists immediately, so even a cancelled tick keeps its
  // partial progress. Cap sized so pool + sync + capture fit in ~4 min.
  const AI_PER_TICK_CAP = 10;
  const { workItems, skipped, failed: selectFailed } = diff.selectWorkItems({
    estimates, existingByEstId, fetchedByEst, forced, targetedIds,
  });
  workItems.sort((a, b) => new Date(a.modified || 0).getTime() - new Date(b.modified || 0).getTime());
  const capped = workItems.length > AI_PER_TICK_CAP;
  const dueItems = capped ? workItems.slice(0, AI_PER_TICK_CAP) : workItems;
  console.log(`zoho-sent-runner: ${workItems.length} estimates need AI processing, ${skipped} skipped, ${selectFailed} comment-fetch failures${capped ? ` — taking oldest ${dueItems.length} this tick, ${workItems.length - dueItems.length} ride next ticks` : ''}`);
  const { processed, failed: analysisFailed, succeeded } = await analyze.runAnalysisPool(dueItems, agentRoster);

  // 10. Lead-details capture (sent rows with uncaptured blocks only).
  await analyze.captureLeadDetails({ estimates, existingByEstId, fetchedByEst });

  const failed = selectFailed + analysisFailed;

  // 11. Watermark only on a fully-complete pass — capped ticks defer work,
  // so they must NOT advance it (the backlog drains over following ticks).
  if (!capped && workItems.length > 0 && failed === 0) {
    await persist.advanceWatermark();
    console.log(`zoho-sent-runner: complete pass finished, watermark advanced (needed ${workItems.length}, failed ${failed})`);
  } else {
    console.log(`zoho-sent-runner: incomplete — needed ${workItems.length} (${dueItems.length} attempted this tick), failed ${failed}. Watermark not advanced.`);
  }

  // Store the fingerprint ONLY on a fully-complete pass: capped ticks defer
  // work items WITHOUT persisting them, so their comment ids must NOT be
  // baked into the fp — otherwise every later tick reads "no change" and the
  // deferred comments stay invisible forever (2026-09-28 incident: 49 real
  // sales comments skipped permanently by a capped run's fingerprint).
  if (!capped && failed === 0 && commentFetchErrors === 0) {
    const { fp } = diff.buildFingerprint(estimates, fetchedByEst);
    await persist.postFingerprint(fp);
  } else if (capped) {
    console.log('zoho-sent-runner: capped tick — fingerprint NOT stored so deferred items stay visible next tick.');
    // 2026-09-30 starvation fix: merge ONLY the rows persisted this tick into
    // the stored fingerprint. Processed rows stop re-flagging hasNew (their
    // ids are in D1 now); deferred rows keep the old baseline and stay
    // visible. Requires a failure-free tick — a failed item's comments may be
    // only half-persisted, so its ids must NOT be baked in.
    if (failed === 0 && commentFetchErrors === 0 && succeeded.length > 0) {
      const merged = diff.mergeFingerprintForProcessed(prevRawFp, estimates, fetchedByEst, succeeded);
      await persist.postFingerprint(merged);
      console.log(`zoho-sent-runner: merged ${succeeded.length} processed rows into the fingerprint — they leave the work set next tick.`);
    }
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
