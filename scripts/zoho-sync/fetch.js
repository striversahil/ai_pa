// fetch.js — all Zoho Books reads (pure I/O, no DB, no AI).
// URL + auth come from the saved curl export (zoho_sent/sent_estimates.txt);
// list URLs are derived from it (status / sort / page swapped), so no new
// export file is needed when the sync scope changes.
//
// MULTI-ORG: the export carries every organization_id (same login, shared
// headers — see orgs.js). Every fetch loops all orgs; rows are normalized at
// the boundary (non-primary ids namespaced `<org>:<id>`, see orgs.js) so all
// downstream code keys on DB ids unchanged.

const fs = require('fs');
const path = require('path');
const { workerRequest } = require('../runner-lib');
const orgs = require('./orgs');

function parseCurlFile() {
  const candidates = [
    path.join(__dirname, '..', '..', 'zoho_sent', 'sent_estimates.txt'),
    path.join(process.cwd(), 'zoho_sent', 'sent_estimates.txt'),
    '/app/zoho_sent/sent_estimates.txt',
  ];
  const curlFile = candidates.find((p) => fs.existsSync(p));
  if (!curlFile) throw new Error(`Zoho credentials file not found (tried: ${candidates.join(', ')})`);

  const content = fs.readFileSync(curlFile, 'utf-8');
  const urlMatch = content.match(/curl\s+'([^']+)'/) || content.match(/curl\s+"([^"]+)"/) || content.match(/curl\s+([^\s\\]+)/);
  if (!urlMatch) throw new Error('Could not extract URL from sent_estimates.txt');
  const url = urlMatch[1];

  const headers = {};
  const headerMatches = content.matchAll(/-H\s+'([^:]+):\s*(.*?)'(?=\s|\\|$)/g);
  for (const m of headerMatches) headers[m[1].trim()] = m[2].trim().replace(/\\$/, '').trim();
  if (Object.keys(headers).length === 0) {
    const double = content.matchAll(/-H\s+"([^:]+):\s*(.*?)"(?=\s|\\|$)/g);
    for (const m of double) headers[m[1].trim()] = m[2].trim().replace(/\\$/, '').trim();
  }

  let orgIds = orgs.parseOrgIds(content);
  // Fallback: single org from the list URL (legacy exports).
  if (!orgIds.length) {
    const orgMatch = url.match(/organization_id=([0-9]+)/);
    if (orgMatch) orgIds = [orgMatch[1]];
  }
  const orgId = orgIds[0] || '';

  if (headers['Accept-Encoding']) headers['Accept-Encoding'] = 'gzip, deflate';
  if (orgIds.length > 1) console.log(`zoho-sync/fetch: multi-org mode — ${orgIds.join(', ')} (primary ${orgId})`);
  return { url, headers, orgId, orgIds };
}

let cached = null;
function zohoContext() {
  if (!cached) cached = parseCurlFile();
  return cached;
}

async function zohoFetch(url) {
  const { headers } = zohoContext();
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Zoho ${res.status} for ${url}`);
  return res.json();
}

// Estimates list URL derived from the saved export: every moving status,
// newest-modified first, so any transition lands in the window.
// Per-org: the saved URL's organization_id is swapped for the target org.
function buildEstimatesUrl(page, orgId) {
  const { url } = zohoContext();
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
async function fetchEstimatesAll(pages = 2) {
  const { orgIds, orgId: primaryOrg } = zohoContext();
  const seen = new Map();
  for (const org of orgIds.length ? orgIds : [primaryOrg]) {
    for (let page = 1; page <= pages; page++) {
      const json = await zohoFetch(buildEstimatesUrl(page, org));
      const rows = json.estimates || [];
      for (const e of rows) {
        if (!e?.estimate_id) continue;
        orgs.normalizeEstimateRow(e, org, primaryOrg);
        if (!seen.has(e.estimate_id)) seen.set(e.estimate_id, e);
      }
      if (rows.length < 200) break;
    }
  }
  return [...seen.values()];
}

async function fetchComments(zohoEstimateId, orgId) {
  const ctx = zohoContext();
  const org = orgId || ctx.orgId;
  const cj = await zohoFetch(`https://books.zoho.com/api/v3/estimates/${zohoEstimateId}/comments?organization_id=${org}`);
  return orgs.normalizeCommentRows(cj.comments || [], org, ctx.orgId);
}

// Comment batches (Zoho reads, NOT LLM — concurrency stays high here).
// Keyed by DB estimate id; each estimate carries its own _orgId/_zohoId.
async function fetchCommentsFor(estimates, { concurrency = 6, onError } = {}) {
  const out = new Map();
  for (let i = 0; i < estimates.length; i += concurrency) {
    await Promise.all(estimates.slice(i, i + concurrency).map(async (est) => {
      try {
        const ctx = zohoContext();
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
  const ctx = zohoContext();
  const { orgId: org, zohoId } = orgs.splitDbEstimateId(dbEstimateId, ctx.orgId);
  try {
    const detail = await zohoFetch(`https://books.zoho.com/api/v3/estimates/${zohoId}?organization_id=${org}`);
    return { status: detail.estimate?.status || null };
  } catch (err) {
    if (/Zoho 404/.test(err.message)) return { gone: true };
    throw err;
  }
}

// ── NeoDove sales-agent roster (for LLM attribution) ───────────────────────
// Order: today's live report → latest snapshot → NEODOVE_AGENT_NAMES env.
// Env names are ADDITIVE: call data misses Zoho-only agents (e.g. Muskan).
async function fetchAgentRoster() {
  const envNames = (process.env.NEODOVE_AGENT_NAMES || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const fromReport = (rows) => [...new Set((rows || [])
    .map((r) => (r && typeof r.userName === 'string' ? r.userName.trim() : ''))
    .filter(Boolean))];
  const dynamicNames = [];
  try {
    const data = await workerRequest('/api/automations/neodove-telecaller-report/data');
    dynamicNames.push(...fromReport(data?.agents ?? data?.data));
  } catch (err) { console.warn(`zoho-sync/fetch: neodove roster fetch failed: ${err.message}`); }
  if (!dynamicNames.length) {
    try {
      const data = await workerRequest(`/api/neodove/report`);
      dynamicNames.push(...fromReport(data?.rows));
    } catch (err) { console.warn(`zoho-sync/fetch: neodove roster fetch (latest) failed: ${err.message}`); }
  }
  return [...new Set([...dynamicNames, ...envNames])];
}

// ── Sales orders snapshot (dashboard "Sales Orders Today" tile) ────────────
const SO_TODAY_EXCLUDED = new Set(['cancelled', 'void']);

function istDateString(d) {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function buildSalesOrdersUrl(page, orgId) {
  const { orgId: primary } = zohoContext();
  const org = orgId || primary;
  return `https://books.zoho.com/api/v3/salesorders?page=${page}&per_page=200&filter_by=Status.All&sort_column=created_time&sort_order=D&usestate=true&organization_id=${org}`;
}

// Newest first per org; stops when a page is short or its oldest order predates
// today. Multi-org: loops every org, merges counts; each order tagged with its
// org so the dashboard can split per-org (combined totals stay backward-compat).
async function fetchSalesOrdersToday() {
  const { orgIds, orgId: primaryOrg } = zohoContext();
  const today = istDateString(new Date());
  const statuses = {};
  const orders = [];
  const byOrg = {};
  let count = 0;
  let totalValue = 0;
  for (const org of orgIds.length ? orgIds : [primaryOrg]) {
    let orgCount = 0;
    let orgValue = 0;
    for (let page = 1; page <= 10; page++) {
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
    byOrg[org] = { count: orgCount, totalValue: Math.round(orgValue * 100) / 100 };
  }
  return { date: today, count, totalValue: Math.round(totalValue * 100) / 100, statuses, orders, byOrg };
}

module.exports = {
  zohoContext,
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
