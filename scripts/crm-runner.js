#!/usr/bin/env node
/**
 * crm-runner.js — CRM: Active Sales Orders pipeline.
 *
 * Pages Zoho Books /api/v3/salesorders (Status.All), computes each OPEN order's
 * next pending process step, and POSTs the grouped snapshot to
 * /api/runner/crm/snapshot (KV-cached on the Worker). The CRM dashboard data()
 * reads that snapshot.
 *
 * Lifecycle / "process after that needs to be done":
 *   status=draft (not yet confirmed)         → "confirm"
 *   confirmed, quantity_invoiced < line count → "invoice"
 *   invoiced, not shipped                    → "ship"
 *   shipped, not fully paid                  → "payment"
 *   fully paid / closed / cancelled / void   → "complete" (excluded from active)
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

async function zohoFetch(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Zoho ${res.status} for ${url}`);
  return res.json();
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('crm-runner: fetching sales orders from Zoho Books');
  const today = istDateString(new Date());

  const byProcess = {};
  let totalActive = 0;
  let totalValue = 0;
  let pages = 0;

  // Page through all SOs (Status.All). Newest first; stop when a page's oldest
  // order is older than ~90 days (open orders are recent) or page is short.
  for (let page = 1; page <= 20; page++) {
    pages++;
    const json = await zohoFetch(buildSalesOrdersUrl(page));
    const salesorders = json.salesorders || [];
    if (salesorders.length === 0) break;

    for (const so of salesorders) {
      const step = pendingStep(so);
      if (step === 'complete') continue; // closed/cancelled — not active

      totalActive++;
      totalValue += parseFloat(so.total) || 0;

      if (!byProcess[step]) byProcess[step] = { count: 0, value: 0, orders: [] };
      byProcess[step].count++;
      byProcess[step].value += parseFloat(so.total) || 0;
      if (byProcess[step].orders.length < 100) {
        byProcess[step].orders.push({
          so: so.salesorder_number || '',
          ref: so.reference_number || '',
          customer: so.customer_name || '',
          total: parseFloat(so.total) || 0,
          totalFormatted: so.total_formatted || '',
          status: String(so.status || '').toLowerCase(),
          orderStatus: String(so.order_status || '').toLowerCase(),
          invoicedStatus: String(so.invoiced_status || '').toLowerCase(),
          shippedStatus: String(so.shipped_status || '').toLowerCase(),
          paidStatus: String(so.paid_status || '').toLowerCase(),
          salesperson: so.salesperson_name || '',
          date: so.date_formatted || so.date || '',
          createdTime: so.created_time_formatted || so.created_time || '',
        });
      }
    }

    if (salesorders.length < 200) break;
  }

  // Round values.
  totalValue = Math.round(totalValue * 100) / 100;
  for (const step of Object.keys(byProcess)) {
    byProcess[step].value = Math.round(byProcess[step].value * 100) / 100;
  }

  const snapshot = {
    date: today,
    totalActive,
    totalValue,
    byProcess,
  };

  await workerRequest('/api/runner/crm/snapshot', { method: 'POST', body: snapshot });

  const summary = Object.entries(byProcess)
    .map(([k, v]) => `${k}:${v.count}(₹${Math.round(v.value).toLocaleString()})`)
    .join('  ');
  console.log(`crm-runner: ${pages} page(s), ${totalActive} active SOs (₹${totalValue.toLocaleString()}) — ${summary}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('crm-runner: fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { pendingStep };
