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
  const items = Array.isArray(so.line_items) ? so.line_items.slice(0, 20) : [];
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
    _today: today, // IST date string for new-order crediting on the Worker
  };
}

async function zohoFetch(url) {
  const res = await fetch(url, { headers });
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

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('crm-runner: fetching sales orders from Zoho Books');
  const today = istDateString(new Date());

  const stages = {};
  for (const s of STAGES) stages[s] = { count: 0, value: 0, orders: [] };
  const closed = []; // paid/closed/cancelled orders — diff source for paid/cancel points
  const materialMap = new Map();
  const salespersonMap = new Map();
  let totalActive = 0;
  let totalValue = 0;
  let pages = 0;
  let scanned = 0;
  let withItems = 0;

  // Page through SOs (Status.All, newest first). Stop when a page has nothing
  // relevant: no active orders AND nothing created inside the scan window.
  for (let page = 1; page <= 30; page++) {
    pages++;
    const json = await zohoFetch(buildSalesOrdersUrl(page));
    const salesorders = json.salesorders || [];
    if (salesorders.length === 0) break;

    let relevant = 0;
    for (const so of salesorders) {
      const step = pendingStep(so);
      const row = orderRow(so, today);
      const od = orderDate(so);
      const recent = od ? ((Date.now() - od.getTime()) / 86400000) <= SCAN_WINDOW_DAYS : true;

      if (step !== 'complete') {
        relevant++;
        totalActive++;
        totalValue += row.total;
        stages[step].count++;
        stages[step].value += row.total;
        if (stages[step].orders.length < DETAIL_CAP) stages[step].orders.push(row);
        addSalesperson(salespersonMap, so, step, row.total);
        if (Array.isArray(so.line_items) && so.line_items.length > 0) {
          withItems++;
          addMaterial(materialMap, so.line_items.slice(0, 50).map((li) => ({
            name: li.name || '',
            sku: li.sku || '',
            qty: parseFloat(li.quantity) || 0,
            item_total: parseFloat(li.item_total) || 0,
          })));
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

  // Round values; strip the internal _today marker into a clean boolean.
  totalValue = Math.round(totalValue * 100) / 100;
  for (const s of STAGES) {
    stages[s].value = Math.round(stages[s].value * 100) / 100;
    stages[s].orders = stages[s].orders.map((o) => {
      const { _today, ...rest } = o;
      return { ...rest, createdToday: _today === today };
    });
  }

  const materials = [...materialMap.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, MATERIALS_CAP)
    .map((m) => ({ ...m, qty: Math.round(m.qty * 100) / 100, value: Math.round(m.value * 100) / 100 }));

  const salespeople = [...salespersonMap.values()]
    .sort((a, b) => b.pipelineValue - a.pipelineValue)
    .map((s) => ({ ...s, pipelineValue: Math.round(s.pipelineValue * 100) / 100 }));

  const snapshot = {
    date: today,
    totalActive,
    totalValue,
    stages,
    closed,
    materials,
    salespeople,
    meta: { pages, scanned, withLineItems: withItems },
  };

  await workerRequest('/api/runner/crm/snapshot', { method: 'POST', body: snapshot });

  const summary = STAGES.filter((s) => stages[s].count > 0)
    .map((s) => `${s}:${stages[s].count}(₹${Math.round(stages[s].value).toLocaleString()})`)
    .join('  ');
  console.log(`crm-runner: ${pages} page(s), ${scanned} scanned, ${totalActive} active SOs (₹${totalValue.toLocaleString()}) — ${summary}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('crm-runner: fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { pendingStep };
