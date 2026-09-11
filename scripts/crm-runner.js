#!/usr/bin/env node
/**
 * crm-runner.js — CRM: Active Sales Orders pipeline (department edition).
 *
 * Pages Zoho Books /api/v3/salesorders (Status.All), computes each OPEN order's
 * next pending process step, and POSTs a department-grouped snapshot to
 * /api/runner/crm/snapshot (KV-cached on the Worker). The Worker diffs the new
 * snapshot against the previous one and credits/debits DepartmentScoreEvent
 * points (confirm → invoice → ship → payment → paid, plus new orders and
 * cancellations) — the same event-ledger game the telecalling leaderboard plays.
 *
 * Lifecycle / "process after that needs to be done":
 *   status=draft (not yet confirmed)         → "confirm"   (CRM desk)
 *   confirmed, not fully invoiced            → "invoice"   (Accounts desk)
 *   invoiced, not shipped                    → "ship"      (Dispatch desk)
 *   shipped, not fully paid                  → "payment"   (Accounts desk)
 *   fully paid / closed / cancelled / void   → "complete"  (excluded from active)
 *
 * Efficiency: orders are sorted newest-first, so once a full page contains
 * nothing relevant (no active orders AND nothing created within the scan
 * window) the scan stops instead of paging through years of closed history.
 *
 * Reuses runner-lib.js (workerRequest) and the same curl-credential parsing as
 * zoho-sent-runner.js.
 *
 * Env: WORKER_URL, SHARED_SECRET (both from GH secrets).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { workerRequest } = require('./runner-lib');

// ── Parse Zoho curl credentials (same logic as zoho-sent-runner.js) ─────────
function parseCurlFile() {
  const candidates = [
    path.join(__dirname, '..', 'zoho_sent', 'sent_estimates.txt'),
    path.join(process.cwd(), 'zoho_sent', 'sent_estimates.txt'),
    '/app/zoho_sent/sent_estimates.txt',
  ];
  const curlFile = candidates.find((p) => fs.existsSync(p));
  if (!curlFile) throw new Error(`Zoho credentials file not found (tried: ${candidates.join(', ')})`);

  const content = fs.readFileSync(curlFile, 'utf-8');
  const urlMatch = content.match(/curl\s+'([^']+)'/);
  if (!urlMatch) throw new Error('Could not extract URL from sent_estimates.txt');
  const url = urlMatch[1];

  const headers = {};
  for (const m of content.matchAll(/-H\s+'([^:]+):\s*(.*?)'(?=\s|\\|$)/g)) {
    headers[m[1].trim()] = m[2].trim().replace(/\\$/, '').trim();
  }
  if (headers['Accept-Encoding']) headers['Accept-Encoding'] = 'gzip, deflate';

  const orgMatch = url.match(/organization_id=([0-9]+)/);
  const orgId = orgMatch ? orgMatch[1] : '';
  return { url, headers, orgId };
}

const { headers, orgId } = parseCurlFile();

// ── Helpers ──────────────────────────────────────────────────────────────────
function istDateString(d) {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function buildSalesOrdersUrl(page) {
  return `https://books.zoho.com/api/v3/salesorders?page=${page}&per_page=200&filter_by=Status.All&sort_column=created_time&sort_order=D&usestate=true&organization_id=${orgId}`;
}

function buildSalesOrderDetailUrl(salesorderId) {
  return `https://books.zoho.com/api/v3/salesorders/${salesorderId}?organization_id=${orgId}`;
}

// Bounded-parallel map (fail-soft per item — a single bad SO never kills the tick).
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e) { out[idx] = { __error: e?.message || String(e) }; }
    }
  });
  await Promise.all(workers);
  return out;
}

// Full line items for one SO via the detail endpoint (the list endpoint never
// includes line_items). One 429 backoff + retry; a second consecutive 429
// OPENS the circuit — remaining rows skip items this tick (fail fast, no
// 495×45s sleep storm) and retry on the next tick.
let detailCircuitOpen = false;
async function fetchOrderItems(salesorderId) {
  if (detailCircuitOpen) throw new Error('detail circuit open (rate-limited earlier this tick)');
  const once = async () => {
    const json = await zohoFetch(buildSalesOrderDetailUrl(salesorderId));
    const items = json?.salesorder?.line_items;
    return Array.isArray(items) ? items.slice(0, 200) : [];
  };
  try {
    return await once();
  } catch (e) {
    if (e?.retryAfterMs) {
      console.log(`crm-runner: rate-limited, backing off ${Math.round(Math.min(e.retryAfterMs, 90000) / 1000)}s…`);
      await sleep(Math.min(e.retryAfterMs, 90000));
      try {
        return await once();
      } catch (e2) {
        detailCircuitOpen = true;
        console.log('crm-runner: still rate-limited — circuit open, remaining rows skip items this tick');
        throw e2;
      }
    }
    throw e;
  }
}

function itemsSig(items) {
  const count = items.length;
  const sum = items.reduce((s, li) => s + (parseFloat(li.item_total) || 0), 0);
  return `${count}:${Math.round(sum * 100) / 100}`;
}

const EXCLUDED_STATUSES = new Set(['cancelled', 'void']);
const STAGES = ['confirm', 'invoice', 'ship', 'payment'];
// Orders older than this (created) are irrelevant history — scan stops.
const SCAN_WINDOW_DAYS = 120;
// Per-stage order detail cap (full rows); counts always reflect all orders.
const DETAIL_CAP = 400;
const CLOSED_CAP = 400;
const MATERIALS_CAP = 300;

/**
 * Determine the next pending process step for a sales order.
 * Returns one of: confirm | invoice | ship | payment | complete.
 */
function pendingStep(so) {
  const status = String(so.status || '').toLowerCase();
  if (EXCLUDED_STATUSES.has(status)) return 'complete';

  const orderStatus = String(so.order_status || '').toLowerCase();
  const invoicedStatus = String(so.invoiced_status || '').toLowerCase();
  const shippedStatus = String(so.shipped_status || '').toLowerCase();
  const paidStatus = String(so.paid_status || '').toLowerCase();

  // Fully paid / closed → complete (no further action).
  if (paidStatus === 'paid' || orderStatus === 'closed') return 'complete';

  // Shipped but not yet paid → payment.
  if (shippedStatus === 'shipped' || shippedStatus === 'partial') return 'payment';

  // Invoiced (fully or partially) but not shipped → ship.
  if (invoicedStatus === 'invoiced' || invoicedStatus === 'partial') return 'ship';

  // Confirmed/approved but not invoiced → invoice.
  if (orderStatus === 'confirmed' || orderStatus === 'approved' || invoicedStatus) return 'invoice';

  // Default (draft / anything else open) → confirm.
  return 'confirm';
}

/** Parse an order's IST date (date_formatted preferred) → Date | null. */
function orderDate(so) {
  const raw = so.date_formatted || so.date || '';
  if (!raw) return null;
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+05:30`);
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/** Compact order row for the dashboard tables (full per-stage detail). */
function orderRow(so, today) {
  const createdTime = so.created_time_formatted || so.created_time || '';
  let age = null;
  if (createdTime) {
    const t = new Date(createdTime);
    if (!isNaN(t.getTime())) age = Math.max(0, Math.floor((Date.now() - t.getTime()) / 86400000));
  }
  // True ONLY when Zoho's created_time falls on today (IST) — same rule as
  // zoho-sent-runner's syncSalesOrdersToday. The Worker credits +25 new-order
  // points solely on this flag, so it must never default to true (that would
  // re-credit every first-seen order after a KV expiry).
  let createdToday = false;
  if (so.created_time) {
    const ct = new Date(so.created_time);
    if (!isNaN(ct.getTime())) createdToday = istDateString(ct) === today;
  }
  // Populated from the detail endpoint in phase 2 (the list response never
  // includes line_items); initialized from the list payload when present.
  const items = Array.isArray(so.line_items) ? so.line_items.slice(0, 200) : [];
  return {
    so: so.salesorder_number || '',
    ref: so.reference_number || '',
    customer: so.customer_name || '',
    total: Math.round((parseFloat(so.total) || 0) * 100) / 100,
    totalFormatted: so.total_formatted || '',
    status: String(so.status || '').toLowerCase(),
    orderStatus: String(so.order_status || '').toLowerCase(),
    invoicedStatus: String(so.invoiced_status || '').toLowerCase(),
    shippedStatus: String(so.shipped_status || '').toLowerCase(),
    paidStatus: String(so.paid_status || '').toLowerCase(),
    salesperson: so.salesperson_name || '',
    date: so.date_formatted || so.date || '',
    createdTime,
    ageDays: age,
    lineCount: Array.isArray(so.line_items) ? so.line_items.length : 0,
    items,
    createdToday,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function zohoFetch(url) {
  // 30s cap per call — a tarpitted connection must fail fast, never hang the tick.
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '45', 10);
    const err = new Error(`Zoho 429 rate-limited for ${url}`);
    err.retryAfterMs = (isNaN(retryAfter) ? 45 : retryAfter) * 1000;
    throw err;
  }
  if (!res.ok) throw new Error(`Zoho ${res.status} for ${url}`);
  return res.json();
}

// ── Aggregators ──────────────────────────────────────────────────────────────
/** Aggregated material requirements across active orders (procurement view). */
function addMaterial(map, items) {
  for (const li of items) {
    const key = li.sku || li.name || '';
    if (!key) continue;
    const entry = map.get(key) || { item: li.name || key, sku: li.sku || '', qty: 0, orders: 0, value: 0 };
    entry.qty += li.qty;
    entry.value += (parseFloat(li.item_total) || 0);
    entry.orders += 1;
    map.set(key, entry);
  }
}

/** Roll order → salesperson pipeline rollup. */
function addSalesperson(map, so, step, total) {
  const name = so.salesperson_name || 'Unassigned';
  const entry = map.get(name) || { name, openOrders: 0, pipelineValue: 0, byStage: { confirm: 0, invoice: 0, ship: 0, payment: 0 } };
  entry.openOrders += 1;
  entry.pipelineValue += total;
  if (entry.byStage[step] !== undefined) entry.byStage[step] += 1;
  map.set(name, entry);
}

// ── Manual overrides (CrmOrderAction layer) ──────────────────────────────────
// Operators advance/cancel orders from the dashboard; the latest action per SO
// (within the lookback window) overrides Zoho's raw status before pendingStep().
const OVERRIDE_LOOKBACK_DAYS = 7;
const VALID_OVERRIDE_STAGES = new Set(['confirm', 'invoice', 'ship', 'payment', 'complete']);

async function fetchOverrides() {
  const since = istDateString(new Date(Date.now() - OVERRIDE_LOOKBACK_DAYS * 86400000));
  try {
    const res = await workerRequest(`/api/runner/crm/actions?since=${since}`);
    const map = new Map();
    for (const a of res.actions || []) {
      if (!a?.soNumber || !VALID_OVERRIDE_STAGES.has(String(a.toStage))) continue;
      map.set(String(a.soNumber), String(a.toStage)); // latest row wins (worker returns oldest-first)
    }
    if (map.size > 0) console.log(`crm-runner: loaded ${map.size} manual override(s) since ${since}`);
    return map;
  } catch (e) {
    console.log(`crm-runner: override fetch failed (continuing without overrides): ${e.message}`);
    return new Map();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('crm-runner: fetching sales orders from Zoho Books');
  const today = istDateString(new Date());
  const fetchedAt = new Date().toISOString();
  const overrides = await fetchOverrides();

  const stages = {};
  for (const s of STAGES) stages[s] = { count: 0, value: 0, orders: [] };
  const closed = []; // paid/closed/cancelled orders — diff source for paid/cancel points
  const salespersonMap = new Map();
  // Full lightweight index (UNCAPPED) — the Worker's diff source of truth so
  // per-stage display caps (DETAIL_CAP) never hide points movements.
  const index = [];
  // Active SOs by number: soNum → { id, row, entry } (detail lookup map).
  const activeBySo = new Map();
  let totalActive = 0;
  let totalValue = 0;
  let pages = 0;
  let scanned = 0;
  let withItems = 0;
  let overridden = 0;

  // Page through SOs (Status.All, newest first). Stop when a page has nothing
  // relevant: no active orders AND nothing created inside the scan window.
  for (let page = 1; page <= 30; page++) {
    pages++;
    const json = await zohoFetch(buildSalesOrdersUrl(page));
    const salesorders = json.salesorders || [];
    if (salesorders.length === 0) break;

    let relevant = 0;
    for (const so of salesorders) {
      scanned++;
      const rawStep = pendingStep(so);
      const soNum = so.salesorder_number || '';
      let step = rawStep;
      if (soNum && overrides.has(soNum) && rawStep !== 'complete') {
        step = overrides.get(soNum);
        overridden++;
      }
      const row = orderRow(so, today);
      const od = orderDate(so);
      const recent = od ? ((Date.now() - od.getTime()) / 86400000) <= SCAN_WINDOW_DAYS : true;

      // Lightweight index entry for EVERY order (uncapped diff source).
      const entry = {
        so: soNum,
        stage: step,
        paidStatus: String(so.paid_status || '').toLowerCase(),
        status: String(so.status || '').toLowerCase(),
        createdToday: !!row.createdToday,
        salesperson: row.salesperson || '',
        total: row.total,
        itemsSig: '',
      };
      index.push(entry);

      if (step !== 'complete') {
        relevant++;
        totalActive++;
        totalValue += row.total;
        stages[step].count++;
        stages[step].value += row.total;
        if (stages[step].orders.length < DETAIL_CAP) stages[step].orders.push(row);
        addSalesperson(salespersonMap, so, step, row.total);
        // Line items come from the detail endpoint (the list response never
        // includes them) — fetched in phase 2, but ONLY for display-capped
        // rows (what the dashboard can actually render/click). Ancient backlog
        // beyond the cap stays item-less; points are unaffected (index-based).
        if (so.salesorder_id && !activeBySo.has(soNum)) {
          activeBySo.set(soNum, { id: so.salesorder_id, row, entry });
        }
      } else if (recent) {
        // Recently closed (paid / cancelled / void) — feeds the Worker's diff so
        // payment-received and cancel penalties are credited exactly once.
        relevant++;
        if (closed.length < CLOSED_CAP) {
          closed.push({
            so: so.salesorder_number || '',
            customer: so.customer_name || '',
            total: row.total,
            status: String(so.status || '').toLowerCase(),
            orderStatus: String(so.order_status || '').toLowerCase(),
            paidStatus: String(so.paid_status || '').toLowerCase(),
            salesperson: so.salesperson_name || '',
            date: so.date_formatted || so.date || '',
          });
        }
      }
    }

    if (salesorders.length < 200 || relevant === 0) break;
  }

  // Round values (createdToday already a clean boolean from orderRow).
  totalValue = Math.round(totalValue * 100) / 100;
  for (const s of STAGES) {
    stages[s].value = Math.round(stages[s].value * 100) / 100;
  }

  // Phase 1 — order-level fingerprint from the list scan alone. Unchanged →
  // heartbeat and exit WITHOUT any per-SO detail calls (idle ticks stay cheap).
  // CRM_FORCE=1 bypasses the gate.
  const orderFp = crypto.createHash('sha1')
    .update(index.map((e) => [e.so, e.stage, e.paidStatus, e.status, e.total].join('|')).sort().join('\n'))
    .digest('hex');

  // Previous per-SO [stage, itemsSig] (display rows only) — drives delta-fetch.
  let prevSigs = {};
  if (!process.env.CRM_FORCE) {
    try {
      const fp = await workerRequest('/api/runner/crm/fingerprint');
      // Stored fingerprints include the items signature suffix after the first
      // detail run — compare against the order-level prefix for the shortcut.
      const storedOrderFp = String(fp?.fingerprint || '').split('+')[0];
      if (storedOrderFp === orderFp && fp?.date === today) {
        // No change — refresh the snapshot TTL + fetchedAt so the dashboard
        // stays fresh without a full POST, ledger diff, or live broadcast.
        await workerRequest('/api/runner/crm/heartbeat', { method: 'POST', body: { date: today, fingerprint: fp.fingerprint, fetchedAt, totalActive, totalValue } });
        console.log(`crm-runner: no change (fp ${orderFp.slice(0, 8)}), heartbeat sent — ${totalActive} active SOs`);
        return;
      }
      if (fp?.sigs && typeof fp.sigs === 'object') prevSigs = fp.sigs;
    } catch (e) {
      console.log(`crm-runner: fingerprint check failed (continuing with POST): ${e.message}`);
    }
  }

  // Phase 2 — pipeline moved (or forced): fetch FULL line items, but ONLY for
  // display-capped rows (every clickable row gets items; backlog beyond the
  // cap stays item-less). Items are slimmed to display fields — raw Zoho items
  // carry ~80 keys each and would bloat the KV snapshot by megabytes.
  const SLIM_KEYS = ['name', 'description', 'sku', 'item_code', 'quantity', 'unit', 'rate', 'item_total'];
  const slimItem = (li) => {
    const o = {};
    for (const k of SLIM_KEYS) if (li[k] !== undefined && li[k] !== '' && li[k] !== null) o[k] = li[k];
    return o;
  };
  const materialMap = new Map();
  // Delta-fetch: a display row hits Zoho ONLY when it is new, moved stage, or
  // was never captured (empty sig). Unchanged rows reuse the previous sig —
  // the Worker backfills their items from the stored snapshot. A single new
  // SO therefore costs exactly 1 detail call, not ~500.
  const queue = [];
  let skipped = 0;
  for (const s of STAGES) {
    for (const row of stages[s].orders) {
      const hit = activeBySo.get(row.so);
      if (!hit) continue;
      const prev = prevSigs[row.so];
      const prevStage = Array.isArray(prev) ? prev[0] : null;
      const prevSig = Array.isArray(prev) ? prev[1] : '';
      if (prevStage === s && prevSig) {
        hit.entry.itemsSig = prevSig; // worker backfills items
        skipped++;
      } else {
        queue.push(hit);
      }
    }
  }
  const t0 = Date.now();
  // Concurrency 3 + pacing: Zoho blocks bursts (HTTP 429). Idle ticks never
  // reach here (phase-1 heartbeat), so change-ticks may take ~1 min.
  const results = await mapPool(queue, 3, async ({ id, row, entry }) => {
    await sleep(250);
    const items = (await fetchOrderItems(id)).map(slimItem);
    row.items = items;
    row.lineCount = items.length;
    entry.itemsSig = itemsSig(items);
    return items.length;
  });
  const detailMs = Date.now() - t0;
  const detailErrors = results.filter((r) => r && r.__error).length;
  for (const { row } of queue) {
    const items = Array.isArray(row.items) ? row.items : [];
    if (items.length > 0) {
      withItems++;
      addMaterial(materialMap, items.slice(0, 50).map((li) => ({
        name: li.name || li.description || '',
        sku: li.sku || li.item_code || '',
        qty: parseFloat(li.quantity) || 0,
        item_total: parseFloat(li.item_total) || 0,
      })));
    }
  }
  if (detailErrors > 0) console.log(`crm-runner: ${detailErrors} detail fetch(es) failed (rows left without items)`);

  const materials = [...materialMap.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, MATERIALS_CAP)
    .map((m) => ({ ...m, qty: Math.round(m.qty * 100) / 100, value: Math.round(m.value * 100) / 100 }));

  const salespeople = [...salespersonMap.values()]
    .sort((a, b) => b.pipelineValue - a.pipelineValue)
    .map((s) => ({ ...s, pipelineValue: Math.round(s.pipelineValue * 100) / 100 }));

  // Full fingerprint: order-level state + per-order item signatures, so an
  // item edit also triggers a snapshot POST (but never a heartbeat skip).
  const fingerprint = `${orderFp}+${crypto.createHash('sha1')
    .update(index.map((e) => `${e.so}=${e.itemsSig}`).sort().join('\n'))
    .digest('hex').slice(0, 12)}`;

  const snapshot = {
    date: today,
    fetchedAt,
    fingerprint,
    totalActive,
    totalValue,
    stages,
    closed,
    materials,
    salespeople,
    index,
    meta: { pages, scanned, withLineItems: withItems, overridden },
  };

  await workerRequest('/api/runner/crm/snapshot', { method: 'POST', body: snapshot });

  const summary = STAGES.filter((s) => stages[s].count > 0)
    .map((s) => `${s}:${stages[s].count}(₹${Math.round(stages[s].value).toLocaleString()})`)
    .join('  ');
  console.log(`crm-runner: ${pages} page(s), ${scanned} scanned, ${totalActive} active SOs (₹${totalValue.toLocaleString()}), ${queue.length} detail fetch(es) + ${skipped} backfilled in ${Math.round(detailMs / 100) / 10}s, ${withItems} with items — ${summary}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('crm-runner: fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { pendingStep };
