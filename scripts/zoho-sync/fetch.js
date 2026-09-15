// fetch.js — all Zoho Books reads (pure I/O, no DB, no AI).
// URL + auth come from the saved curl export (zoho_sent/sent_estimates.txt);
// list URLs are derived from it (status / sort / page swapped), so no new
// export file is needed when the sync scope changes.

const fs = require('fs');
const path = require('path');
const { workerRequest } = require('../runner-lib');

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

  let orgId = '';
  const orgMatch = url.match(/organization_id=([0-9]+)/);
  if (orgMatch) orgId = orgMatch[1];

  if (headers['Accept-Encoding']) headers['Accept-Encoding'] = 'gzip, deflate';
  return { url, headers, orgId };
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
function buildEstimatesUrl(page) {
  const { url } = zohoContext();
  const u = new URL(url);
  u.searchParams.set('filter_by', 'Status.All');
  u.searchParams.set('sort_column', 'last_modified_time');
  u.searchParams.set('sort_order', 'D');
  u.searchParams.set('per_page', '200');
  u.searchParams.set('page', String(page));
  return u.toString();
}

// All-status fetch, newest-modified first, deduped by estimate_id.
// PAGES=2 covers 400 rows; any mover bumps last_modified_time into the window.
async function fetchEstimatesAll(pages = 2) {
  const seen = new Map();
  for (let page = 1; page <= pages; page++) {
    const json = await zohoFetch(buildEstimatesUrl(page));
    const rows = json.estimates || [];
    for (const e of rows) if (e?.estimate_id && !seen.has(e.estimate_id)) seen.set(e.estimate_id, e);
    if (rows.length < 200) break;
  }
  return [...seen.values()];
}

async function fetchComments(estimateId) {
  const { orgId } = zohoContext();
  const cj = await zohoFetch(`https://books.zoho.com/api/v3/estimates/${estimateId}/comments?organization_id=${orgId}`);
  return cj.comments || [];
}

// Comment batches (Zoho reads, NOT LLM — concurrency stays high here).
async function fetchCommentsFor(estimates, { concurrency = 6, onError } = {}) {
  const out = new Map();
  for (let i = 0; i < estimates.length; i += concurrency) {
    await Promise.all(estimates.slice(i, i + concurrency).map(async (est) => {
      try {
        out.set(est.estimate_id, { comments: await fetchComments(est.estimate_id), hasNew: false });
      } catch (err) {
        if (onError) onError(est, err);
      }
    }));
  }
  return out;
}

// Vanished-row fallback: a DB-tracked estimate missing from both list pages.
// Returns { status } or { gone: true } when Zoho 404s (deleted).
async function fetchVanishedStatus(estimateId) {
  const { orgId } = zohoContext();
  try {
    const detail = await zohoFetch(`https://books.zoho.com/api/v3/estimates/${estimateId}?organization_id=${orgId}`);
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

function buildSalesOrdersUrl(page) {
  const { orgId } = zohoContext();
  return `https://books.zoho.com/api/v3/salesorders?page=${page}&per_page=200&filter_by=Status.All&sort_column=created_time&sort_order=D&usestate=true&organization_id=${orgId}`;
}

// Newest first; stops when a page is short or its oldest order predates today.
async function fetchSalesOrdersToday() {
  const today = istDateString(new Date());
  const statuses = {};
  const orders = [];
  let count = 0;
  let totalValue = 0;
  for (let page = 1; page <= 10; page++) {
    const json = await zohoFetch(buildSalesOrdersUrl(page));
    const salesorders = json.salesorders || [];
    for (const so of salesorders) {
      const st = String(so.status || '').toLowerCase();
      statuses[st] = (statuses[st] || 0) + 1;
      if (SO_TODAY_EXCLUDED.has(st)) continue;
      if (istDateString(new Date(so.created_time)) === today) {
        count++;
        totalValue += parseFloat(so.total) || 0;
        if (orders.length < 50) {
          orders.push({
            so: so.salesorder_number || '',
            ref: so.reference_number || '',
            customer: so.customer_name || '',
            total: parseFloat(so.total) || 0,
            status: st,
            time: so.created_time_formatted || so.created_time || '',
          });
        }
      }
    }
    if (salesorders.length < 200) break;
    const oldest = salesorders[salesorders.length - 1];
    if (istDateString(new Date(oldest.created_time)) < today) break;
  }
  return { date: today, count, totalValue: Math.round(totalValue * 100) / 100, statuses, orders };
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
