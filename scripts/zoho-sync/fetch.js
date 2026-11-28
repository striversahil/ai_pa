// fetch.js — all Zoho Books reads (pure I/O, no DB, no AI).
// Credential parsing, HTTP retry policies, dates, and org normalization live
// in the shared core (founder-os_backend/src/shared/sync-core/) — this file
// owns only the Zoho endpoint shapes (list/comment/detail/sales-orders).
// URL + auth come from the saved curl export (founder-os_backend/zoho_sent/sent_estimates.txt);
// list URLs are derived from it (status / sort / page swapped), so no new
// export file is needed when the sync scope changes.
//
// MULTI-ORG: the export carries every organization_id (same login, shared
// headers — see sync-core/zoho-orgs.js). Every fetch loops all orgs; rows are normalized at
// the boundary (non-primary ids namespaced `<org>:<id>`, see zoho-orgs.js) so all
// downstream code keys on DB ids unchanged.

const { workerRequest } = require('../runner-lib');
const { API } = require('../../founder-os_backend/src/shared/sync-core/contract');
const { zohoContext } = require('../../founder-os_backend/src/shared/sync-core/zoho-auth');
const { resolveZohoRuntime } = require('./credentials');

// Runtime session comes from the DB instance via the runner endpoint; the
// saved curl export is the emergency fallback (credentials.js header).
// Resolved once per process, before any URL is built.
//
// 2026-11-27 incident: at least one 15-min tick is expected to get a session
// here. The FIRST attempt resolves the DB instance (Settings → Third-party
// providers). While no Zoho instance exists the runner endpoint answers 409, so
// the export carry the sync — exactly like crm-runner. The old body swallowed
// that into `_runtime = false` and `zctx()` then called ITSELF, so every tick
// died with "Maximum call stack size exceeded" instead of naming the cause.
let _runtime = null;
let _runtimeSource = '';
async function ensureRuntime() {
  if (_runtime === null) {
    let fromDb = null;
    let dbError = null;
    try {
      fromDb = await resolveZohoRuntime();
    } catch (err) {
      dbError = err;
    }
    if (fromDb) {
      _runtime = fromDb;
      _runtimeSource = 'db';
      console.log('zoho-sync/fetch: session source = worker (Zoho instance)');
    } else {
      const why = dbError ? dbError.message : 'no Zoho instance configured';
      console.warn(`zoho-sync/fetch: worker session unavailable (${why}) — using the saved curl export`);
      _runtime = zohoContext();
      _runtimeSource = 'export';
    }
  }
  return _runtime;
}
// Never recurse: a caller that skipped ensureRuntime() still receives a context
// (the export parse is synchronous and cached). A missing export file throws a
// readable error instead of a stack overflow.
function zctx() { return _runtime || zohoContext(); }
function sessionSource() { return _runtimeSource || (_runtime ? 'db' : 'none'); }
function apiBase() { return (_runtime && _runtime.apiBase) || 'https://books.zoho.com/api/v3'; }
const { sleep, zohoFetchJson } = require('../../founder-os_backend/src/shared/sync-core/zoho-net');
const { istDateString } = require('../../founder-os_backend/src/shared/sync-core/zoho-dates');
const orgs = require('../../founder-os_backend/src/shared/sync-core/zoho-orgs');
const { ZOHO_STATUSES } = require('../../founder-os_backend/src/shared/sync-core/contract');

// Estimates-list retry policy (was the local zohoFetch): connection drops +
// 429s absorbed, anything else throws. Same signature as before.
async function zohoFetch(url, { retries = 3 } = {}) {
  return zohoFetchJson(url, zctx().headers, { retries });
}

// Estimates list URL derived from the saved export: every moving status,
// newest-modified first, so any transition lands in the window.
// Per-org: the saved URL's organization_id is swapped for the target org.
function buildEstimatesUrl(page, orgId) {
  const { url } = zctx();
  const base = orgId ? orgs.urlForOrg(url, orgId) : url;
  const u = new URL(base);
  u.searchParams.set('filter_by', 'Status.All');
  u.searchParams.set('sort_column', 'last_modified_time');
  u.searchParams.set('sort_order', 'D');
  u.searchParams.set('per_page', '200');
  u.searchParams.set('page', String(page));
  return u.toString();
}

// All-status fetch per org, newest-modified first, deduped by DB estimate id.
// Rows are normalized at the boundary (see orgs.js): non-primary org rows get
// namespaced estimate_id + _orgId/_zohoId tags so downstream code is unchanged.
// PAGES=2 covers 400 rows/org; any mover bumps last_modified_time into the window.
// coverIds (DB estimate ids still marked sent locally) extends paging per org
// until every covered id is seen (or maxPages): comments do NOT bump
// last_modified_time, so sent rows with comment-only activity sink past page 2
// and would otherwise never get comment fetches (proven live: 6 real 28/09
// sales comments on page-3 sent rows). Extension costs list calls only when
// needed — comment fetches stay bounded to sent-family rows. A deleted-in-Zoho
// row never resolves, so maxPages caps the hunt (vanished check keeps it sent).
// Per-org fault isolation: a dead org (bad id, no Books, wrong DC → 400/401)
// is SKIPPED with a loud warning — one bad org must never kill the whole sync.
async function fetchEstimatesAll(pages = 2, { coverIds = null, maxPages = 6 } = {}) {
  await ensureRuntime();
  const { orgIds, orgId: primaryOrg } = zctx();
  const seen = new Map();
  const skippedOrgs = [];
  for (const org of orgIds.length ? orgIds : [primaryOrg]) {
    const seenZoho = new Set();
    try {
      let pageNo = 0;
      let shortPage = false;
      for (; pageNo < pages; pageNo++) {
        if (pageNo > 0) await sleep(2000); // pace list calls — never burst Zoho
        const json = await zohoFetch(buildEstimatesUrl(pageNo + 1, org));
        const rows = json.estimates || [];
        for (const e of rows) {
          if (!e?.estimate_id) continue;
          orgs.normalizeEstimateRow(e, org, primaryOrg);
          seenZoho.add(String(e._zohoId));
          if (!seen.has(e.estimate_id)) seen.set(e.estimate_id, e);
        }
        if (rows.length < 200) { shortPage = true; break; }
      }
      if (!shortPage && coverIds && coverIds.size) {
        const want = new Set();
        for (const dbId of coverIds) {
          const { orgId: o, zohoId: z } = orgs.splitDbEstimateId(dbId, primaryOrg);
          if ((o || primaryOrg) === org && !seenZoho.has(String(z))) want.add(String(z));
        }
        while (want.size && pageNo < maxPages) {
          await sleep(2000);
          const json = await zohoFetch(buildEstimatesUrl(pageNo + 1, org));
          pageNo++;
          const rows = json.estimates || [];
          for (const e of rows) {
            if (!e?.estimate_id) continue;
            orgs.normalizeEstimateRow(e, org, primaryOrg);
            seenZoho.add(String(e._zohoId));
            want.delete(String(e._zohoId));
            if (!seen.has(e.estimate_id)) seen.set(e.estimate_id, e);
          }
          if (want.size) console.log(`zoho-sync/fetch: org ${org} page ${pageNo} — still seeking ${want.size} sent rows`);
          if (rows.length < 200) break;
        }
        if (want.size) console.warn(`zoho-sync/fetch: org ${org} — ${want.size} sent rows beyond page ${pageNo} (deleted in Zoho?) — vanished check owns them`);
      }
    } catch (err) {
      skippedOrgs.push(org);
      console.warn(`zoho-sync/fetch: skipping org ${org} for estimates (${err.message}) — continuing with remaining orgs`);
    }
  }
  if (skippedOrgs.length) console.warn(`zoho-sync/fetch: estimates skipped orgs: ${skippedOrgs.join(', ')}`);
  // Every org down = no data at all (expired cookie/session → 401). Fail the
  // tick loudly instead of "succeeding" with zero rows and going stale while
  // CI stays green (2026-10-21 incident: all 3 orgs 401, job exited 0).
  const totalOrgs = orgIds.length || 1;
  if (skippedOrgs.length >= totalOrgs) {
    throw new Error(`Zoho session dead — all ${totalOrgs} org(s) failed (${skippedOrgs.join(', ')}). Refresh founder-os_backend/zoho_sent/sent_estimates.txt from the browser (status: 401).`);
  }
  return [...seen.values()];
}

async function fetchComments(zohoEstimateId, orgId) {
  await ensureRuntime();
  const ctx = zctx();
  const org = orgId || ctx.orgId;
  const cj = await zohoFetch(`${apiBase()}/estimates/${zohoEstimateId}/comments?organization_id=${org}`);
  return orgs.normalizeCommentRows(cj.comments || [], org, ctx.orgId);
}

// Comment batches (Zoho reads, NOT LLM — concurrency stays high here).
// Keyed by DB estimate id; each estimate carries its own _orgId/_zohoId.
async function fetchCommentsFor(estimates, { concurrency = 6, onError } = {}) {
  await ensureRuntime();
  const out = new Map();
  for (let i = 0; i < estimates.length; i += concurrency) {
    await Promise.all(estimates.slice(i, i + concurrency).map(async (est) => {
      try {
        const ctx = zctx();
        const org = est._orgId || ctx.orgId;
        const zohoId = est._zohoId || est.estimate_id;
        out.set(est.estimate_id, { comments: await fetchComments(zohoId, org), hasNew: false });
      } catch (err) {
        if (onError) onError(est, err);
      }
    }));
  }
  return out;
}

// Vanished-row fallback: a DB-tracked estimate missing from both list pages.
// Takes the DB estimate id (namespaced for non-primary orgs) and resolves the
// (org, zohoId) pair for the detail check.
// Returns { status } or { gone: true } when Zoho 404s (deleted).
async function fetchVanishedStatus(dbEstimateId) {
  await ensureRuntime();
  const ctx = zctx();
  const { orgId: org, zohoId } = orgs.splitDbEstimateId(dbEstimateId, ctx.orgId);
  try {
    const detail = await zohoFetch(`${apiBase()}/estimates/${zohoId}?organization_id=${org}`);
    return { status: detail.estimate?.status || null };
  } catch (err) {
    if (/Zoho 404/.test(err.message)) return { gone: true };
    throw err;
  }
}

// ── Sales-agent roster (for LLM attribution) ───────────────────────────────
// The HR register is the only roster now; no call-portal report is involved.
async function fetchAgentRoster() {
  try {
    const data = await workerRequest(API.agentRoster);
    return [...new Set((data?.names || [])
      .map((name) => (typeof name === 'string' ? name.trim() : ''))
      .filter(Boolean))];
  } catch (err) {
    console.warn(`zoho-sync/fetch: roster fetch failed: ${err.message}`);
    return [];
  }
}

// ── Sales orders snapshot (dashboard "Sales Orders Today" tile) ────────────
const SO_TODAY_EXCLUDED = new Set(ZOHO_STATUSES.SO_EXCLUDED);

function buildSalesOrdersUrl(page, orgId) {
  const { orgId: primary } = zctx();
  const org = orgId || primary;
  return `${apiBase()}/salesorders?page=${page}&per_page=200&filter_by=Status.All&sort_column=created_time&sort_order=D&usestate=true&organization_id=${org}`;
}

// Newest first per org; stops when a page is short or its oldest order predates
// today. Multi-org: loops every org, merges counts; each order tagged with its
// org so the dashboard can split per-org (combined totals stay backward-compat).
// Per-org fault isolation (see fetchEstimatesAll): a dead org is skipped with
// a warning, never fatal. skippedOrgs rides the return for runner logging.
async function fetchSalesOrdersToday() {
  await ensureRuntime();
  const { orgIds, orgId: primaryOrg } = zctx();
  const today = istDateString(new Date());
  const statuses = {};
  const orders = [];
  const byOrg = {};
  const skippedOrgs = [];
  let count = 0;
  let totalValue = 0;
  for (const org of orgIds.length ? orgIds : [primaryOrg]) {
    let orgCount = 0;
    let orgValue = 0;
    try {
      for (let page = 1; page <= 10; page++) {
        if (page > 1) await sleep(2000); // pace list calls — never burst Zoho
        const json = await zohoFetch(buildSalesOrdersUrl(page, org));
        const salesorders = json.salesorders || [];
        for (const so of salesorders) {
          const st = String(so.status || '').toLowerCase();
          statuses[st] = (statuses[st] || 0) + 1;
          if (SO_TODAY_EXCLUDED.has(st)) continue;
          if (istDateString(new Date(so.created_time)) === today) {
            count++;
            orgCount++;
            const total = parseFloat(so.total) || 0;
            totalValue += total;
            orgValue += total;
            if (orders.length < 50) {
              orders.push({
                so: so.salesorder_number || '',
                ref: so.reference_number || '',
                customer: so.customer_name || '',
                total,
                status: st,
                time: so.created_time_formatted || so.created_time || '',
                org,
              });
            }
          }
        }
        if (salesorders.length < 200) break;
        const oldest = salesorders[salesorders.length - 1];
        if (istDateString(new Date(oldest.created_time)) < today) break;
      }
    } catch (err) {
      skippedOrgs.push(org);
      console.warn(`zoho-sync/fetch: skipping org ${org} for sales orders (${err.message}) — continuing with remaining orgs`);
    }
    byOrg[org] = { count: orgCount, totalValue: Math.round(orgValue * 100) / 100 };
  }
  if (skippedOrgs.length) console.warn(`zoho-sync/fetch: sales orders skipped orgs: ${skippedOrgs.join(', ')}`);
  return { date: today, count, totalValue: Math.round(totalValue * 100) / 100, statuses, orders, byOrg, skippedOrgs };
}

module.exports = {
  zohoContext: zctx,
  sessionSource,
  zohoFetch,
  buildEstimatesUrl,
  fetchEstimatesAll,
  fetchComments,
  fetchCommentsFor,
  fetchVanishedStatus,
  fetchAgentRoster,
  istDateString,
  fetchSalesOrdersToday,
};
