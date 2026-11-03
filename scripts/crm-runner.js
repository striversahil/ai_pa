#!/usr/bin/env node
/**
 * crm-runner.js — CRM dispatch floor sync (Zoho Books → D1 rows).
 *
 * Pages Zoho Books /api/v3/salesorders (Status.All), then POSTs the IN-WINDOW
 * slice to /api/runner/crm/orders/sync. The Worker owns every rule: new open
 * orders become `unscheduled` rows on the dispatch floor, status moves score
 * the department ledger, items are upserted, and orders Zoho stops returning
 * are flagged "deleted at source" for a human to confirm.
 *
 * Zoho is READ-ONLY — nothing here (or in the Worker) writes back to Books.
 *
 * Two jobs per tick:
 *   1. scan   — page the SO list, build the in-window payload (FLOOR_WINDOW_DAYS)
 *   2. items  — fetch line-item details for a small budget of floor orders that
 *               still have none (one Zoho call each, 10–15s apart). Items
 *               accumulate across ticks instead of bursting the rate limit.
 *
 * Efficiency: orders are sorted newest-first, so once a full page contains
 * nothing relevant (no active orders AND nothing inside the scan window) the
 * scan stops instead of paging through years of closed history.
 *
 * Reuses runner-lib.js (workerRequest) and the shared sync core
 * (founder-os_backend/src/shared/sync-core/) for Zoho credentials, HTTP retry
 * policies, dates and org keys.
 *
 * Env: WORKER_URL, SHARED_SECRET (both from GH secrets).
 */
const { workerRequest } = require('./runner-lib');
const CORE = '../founder-os_backend/src/shared/sync-core/';
const { API, ZOHO_STATUSES, CRM } = require(CORE + 'contract');
const { parseCurlFile } = require(CORE + 'zoho-auth');
const { sleep, zohoFetchOnce, zohoFetchListJson } = require(CORE + 'zoho-net');
const { istDateString } = require(CORE + 'zoho-dates');
const { crmOrgScope: orgScope } = require(CORE + 'zoho-orgs');

// Module-level Zoho context (parsed once at load — a missing credentials file
// fails the tick fast here, same as before the core move).
const { headers, orgId, orgIds } = parseCurlFile();

// Runner-scoped fetch wrappers (same signatures as the old locals): single
// attempt for detail calls, CRM list policy (429 + 5xx) for scans.
async function zohoFetch(url) {
  return zohoFetchOnce(url, headers);
}
async function zohoFetchList(url, retries = 3) {
  return zohoFetchListJson(url, headers, { retries });
}

function buildSalesOrdersUrl(page, org) {
  return `https://books.zoho.com/api/v3/salesorders?page=${page}&per_page=200&filter_by=Status.All&sort_column=created_time&sort_order=D&usestate=true&organization_id=${org || orgId}`;
}

function buildSalesOrderDetailUrl(salesorderId, org) {
  return `https://books.zoho.com/api/v3/salesorders/${salesorderId}?organization_id=${org || orgId}`;
}

/**
 * Zoho address value → display text. The API returns an object per address
 * (`billing_address` / `shipping_address`); some responses carry a
 * pre-formatted string instead, so both shapes are handled.
 */
function formatAddress(addr) {
  if (!addr) return '';
  if (typeof addr === 'string') return addr.trim();
  const parts = [addr.address, addr.street2, addr.city, addr.state, addr.zip, addr.country]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  const phone = String(addr.phone || '').trim();
  if (phone) parts.push(`Ph: ${phone}`);
  return parts.join('\n');
}

// Standing charges Zoho emits on every SO but that are never dated or shipped.
// MIRROR: backend modules/crm/store.ts `isChargeLine` (the store refuses them
// anyway — this only keeps them out of the payload).
const CHARGE_LINES = new Set([
  'packaging & forwarding',
  'packaging and forwarding',
  'packaging & forwarding charges',
  'packaging and forwarding charges',
]);
const isChargeLine = (li) =>
  CHARGE_LINES.has(String(li?.name || li?.description || '').trim().toLowerCase().replace(/\s+/g, ' '));

// Full line items + client addresses for one SO via the detail endpoint (the
// list endpoint never includes line_items or addresses). One 429 backoff +
// retry; a second consecutive 429 OPENS the circuit — remaining rows skip this
// tick (fail fast, no 495×45s sleep storm) and retry on the next tick.
let detailCircuitOpen = false;
async function fetchOrderDetail(salesorderId, org) {
  if (detailCircuitOpen) throw new Error('detail circuit open (rate-limited earlier this tick)');
  const once = async () => {
    const json = await zohoFetch(buildSalesOrderDetailUrl(salesorderId, org));
    const so = json?.salesorder || {};
    const raw = Array.isArray(so.line_items) ? so.line_items.slice(0, 200) : [];
    return {
      items: raw,
      billingAddress: formatAddress(so.billing_address) || String(so.billing_address_formatted || '').trim(),
      shippingAddress: formatAddress(so.shipping_address) || String(so.shipping_address_formatted || '').trim(),
    };
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

const EXCLUDED_STATUSES = new Set(ZOHO_STATUSES.SO_EXCLUDED);
const STAGES = CRM.STAGES;
// Orders older than this (created) are irrelevant history — scan stops.
const SCAN_WINDOW_DAYS = 120;
// The dispatch floor only tracks RECENT orders (mirror of FLOOR_WINDOW_DAYS in
// backend/src/modules/crm/store.ts). Zoho reports 5000+ open sales orders going
// back years — shipping that whole backlog every tick would make the floor
// unusable and blow the runner's Worker-request budget, so only in-window
// orders are sent (and the deletion detector ignores everything older).
const FLOOR_WINDOW_DAYS = 30;

/** YYYY-MM-DD minus N days (pure UTC date math). */
function dayBefore(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
// Per-stage order detail cap (full rows); counts always reflect all orders.
const DETAIL_CAP = 400;
const CLOSED_CAP = 400;

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
/**
 * Post the dispatch-floor sync (migration 0097) and log a compact summary.
 * Never throws: the KV snapshot path is the one that must stay unbroken until
 * the cutover, and the next tick retries anything missed here.
 */
async function postFloorSync(args) {
  try {
    const body = await buildDispatchFloorPayload(args);
    if (!body) return;
    console.log(`crm-runner: floor sync — posting ${body.orders.length} in-window order(s)`);
    // Inserting a fresh window is the one heavy call of the day; give it room
    // instead of the default 90s (which aborted mid-insert and left the floor
    // half-populated).
    const res = await workerRequest(API.crmOrdersSync, { method: 'POST', body, timeoutMs: 240000 });
    if (res?.created || res?.updated || res?.flagged || res?.missIncremented) {
      console.log(
        `crm-runner: floor sync — ${res.created || 0} new, ${res.updated || 0} updated, ` +
          `${res.flagged || 0} flagged deleted, ${res.missIncremented || 0} missing, ${res.itemsUpserted || 0} items`,
      );
    }
  } catch (e) {
    console.log(`crm-runner: floor sync failed (next tick retries): ${e && e.message}`);
  }
}

/**
 * Build the dispatch-floor sync payload (migration 0097).
 *
 * Sends every IN-WINDOW order the scan touched this tick (FLOOR_WINDOW_DAYS),
 * enriched with line items where the detail pass already fetched them. The
 * Worker decides what to insert, update, or flag — but IT cannot know which of
 * its active rows are absent from Zoho, so the runner also re-verifies those
 * by id (a handful, one call each) and reports `verify.gone`, making a deletion
 * definitive instead of a guess. Orders the worker lists as active but that are
 * already in this scan are simply reported `present`.
 */
async function buildDispatchFloorPayload({ date, index, stages, closed, activeBySo, itemsByKey, addressesByKey, localOrders }) {
  if (!Array.isArray(index) || index.length === 0) return null;

  // soKey → Zoho detail row (has customer/ref/items for the display-capped set).
  const displayByKey = new Map();
  for (const s of STAGES) {
    for (const row of stages[s]?.orders || []) {
      displayByKey.set(`${row.org}:${row.so}`, row);
    }
  }
  const closedByKey = new Map();
  for (const row of closed || []) closedByKey.set(`${row.org}:${row.so}`, row);

  const cutoff = dayBefore(date, FLOOR_WINDOW_DAYS);
  const orders = [];
  // `seen` = everything this scan COVERED (drives the re-verify pass);
  // `orders` = only the in-window slice that the floor actually tracks.
  const seen = new Set();
  for (const entry of index) {
    if (!entry?.so) continue;
    const key = `${entry.org || ''}:${entry.so}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const createdDay = String(entry.createdDay || '').slice(0, 10);
    // Older than the window — Zoho keeps it, the floor does not.
    if (createdDay && createdDay < cutoff) continue;
    const hit = activeBySo.get(entry.org + ':' + entry.so);
    const detail = displayByKey.get(key) || null;
    const closedRow = closedByKey.get(key) || null;
    // Items captured THIS tick (detail budget) or carried on the display row.
    const fetched = itemsByKey?.get(key);
    const addr = addressesByKey?.get(key) || null;
    const items =
      Array.isArray(fetched) && fetched.length > 0
        ? fetched
        : Array.isArray(detail?.items) && detail.items.length > 0
          ? detail.items.filter((li) => !isChargeLine(li))
          : undefined;
    orders.push({
      so: entry.so,
      org: entry.org || '',
      zohoId: hit?.id || '',
      customer: detail?.customer || closedRow?.customer || '',
      total: Number(entry.total ?? detail?.total ?? closedRow?.total ?? 0),
      status: entry.status || closedRow?.status || detail?.status || '',
      orderStatus: detail?.orderStatus || closedRow?.orderStatus || '',
      invoicedStatus: detail?.invoicedStatus || '',
      shippedStatus: detail?.shippedStatus || '',
      paidStatus: entry.paidStatus || closedRow?.paidStatus || detail?.paidStatus || '',
      salesperson: entry.salesperson || closedRow?.salesperson || detail?.salesperson || '',
      ref: detail?.ref || '',
      billingAddress: addr?.billingAddress || '',
      shippingAddress: addr?.shippingAddress || '',
      // Only ISO values may reach this field — closed rows carry a display
      // date, and an empty value means "keep whatever the row already has"
      // (never overwrite a real date with a formatted string).
      createdDate: createdDay || String(detail?.createdTime || '').slice(0, 10),
      createdTime: String(detail?.createdTime || '').slice(0, 10),
      items,
    });
  }
  if (orders.length === 0) return null;

  // Which of the Worker's active rows are missing from this scan? Verify those
  // by id — a 404 is a definitive deletion, a hit means our scan window simply
  // didn't reach it (never flag a live order on a paging hiccup).
  const verify = { present: [], gone: [] };
  try {
    const locals = Array.isArray(localOrders) ? localOrders : [];
    const missing = locals
      .map((o) => ({ ...o, key: `${o.org || ''}:${o.so}` }))
      .filter((o) => o.so && !seen.has(o.key));
    for (const m of missing.slice(0, 15)) {
      if (!m.zohoId) continue;
      try {
        await zohoFetch(buildSalesOrderDetailUrl(m.zohoId, m.org));
        verify.present.push(m.key);
      } catch (e) {
        if (/Zoho (400|404) /.test(String(e.message || ''))) verify.gone.push(m.key);
        // Rate limits / connection drops: say nothing — the miss counter and
        // the next tick decide. Never flag on an ambiguous answer.
      }
      await sleep(2000);
    }
    if (verify.gone.length) {
      console.log(`crm-runner: ${verify.gone.length} order(s) confirmed deleted at source`);
    }
  } catch (e) {
    console.log(`crm-runner: verify passed skipped (${e.message})`);
  }

  return { date, orders, verify };
}

function orderRow(so, today, org) {
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
    org: org || orgId,
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

// ── Aggregators ──────────────────────────────────────────────────────────────
/** Zoho created_time → IST calendar day (YYYY-MM-DD), '' when unparseable. */
function createdDayIso(so) {
  const raw = so && so.created_time;
  if (!raw) return '';
  const t = new Date(raw);
  if (isNaN(t.getTime())) return '';
  return istDateString(t);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('crm-runner: fetching sales orders from Zoho Books');
  const today = istDateString(new Date());
  const fetchedAt = new Date().toISOString();

  const stages = {};
  for (const s of STAGES) stages[s] = { count: 0, value: 0, orders: [] };
  const closed = []; // paid/closed/cancelled orders — diff source for paid/cancel points
  // Full lightweight index (UNCAPPED) — the Worker's diff source of truth so
  // per-stage display caps (DETAIL_CAP) never hide points movements.
  const index = [];
  // Active SOs by number: soNum → { id, row, entry } (detail lookup map).
  const activeBySo = new Map();
  let totalActive = 0;
  let totalValue = 0;
  let pages = 0;
  let scanned = 0;

  // Page through SOs per org (Status.All, newest first). Stop per org when a
  // page has nothing relevant: no active orders AND nothing created inside the
  // scan window. (See function header for the abort-on-failure policy.)
  // Per-org fault isolation: a dead org (bad id, no Books, wrong DC → 400)
  // is SKIPPED with a warning — one bad org must never kill the whole sync.
  const skippedOrgs = [];
  try {
  for (const org of orgIds.length ? orgIds : [orgId]) {
  try {
  for (let page = 1; page <= 30; page++) {
    pages++;
    if (page > 1) await sleep(2000); // pace list calls — never burst Zoho
    const json = await zohoFetchList(buildSalesOrdersUrl(page, org));
    const salesorders = json.salesorders || [];
    if (salesorders.length === 0) break;

    let relevant = 0;
    for (const so of salesorders) {
      scanned++;
      const rawStep = pendingStep(so);
      const soNum = so.salesorder_number || '';
      const step = rawStep;
      const row = orderRow(so, today, org);
      const od = orderDate(so);
      const recent = od ? ((Date.now() - od.getTime()) / 86400000) <= SCAN_WINDOW_DAYS : true;

      // Lightweight index entry for EVERY order (uncapped diff source).
      const entry = {
        so: soNum,
        org,
        stage: step,
        paidStatus: String(so.paid_status || '').toLowerCase(),
        status: String(so.status || '').toLowerCase(),
        createdToday: !!row.createdToday,
        createdDay: createdDayIso(so),
        salesperson: row.salesperson || '',
        total: row.total,
      };
      index.push(entry);

      if (step !== 'complete') {
        relevant++;
        totalActive++;
        totalValue += row.total;
        stages[step].count++;
        stages[step].value += row.total;
        if (stages[step].orders.length < DETAIL_CAP) stages[step].orders.push(row);
        // Line items come from the detail endpoint (the list response never
        // includes them) — fetched in phase 2, but ONLY for display-capped
        // rows (what the dashboard can actually render/click). Ancient backlog
        // beyond the cap stays item-less; points are unaffected (index-based).
        if (so.salesorder_id && !activeBySo.has(org + ':' + soNum)) {
          activeBySo.set(org + ':' + soNum, { id: so.salesorder_id, row, entry });
        }
      } else if (recent) {
        // Recently closed (paid / cancelled / void) — feeds the Worker's diff so
        // payment-received and cancel penalties are credited exactly once.
        relevant++;
        if (closed.length < CLOSED_CAP) {
          closed.push({
            so: so.salesorder_number || '',
            org,
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
  } catch (e) {
    skippedOrgs.push(org);
    console.log(`crm-runner: skipping org ${org} (${e.message}) — continuing with remaining orgs`);
    continue;
  }
  }
  if (skippedOrgs.length) console.log(`crm-runner: skipped orgs this tick: ${skippedOrgs.join(', ')}`);
  } catch (e) {
    // The floor keeps serving its D1 rows; a failed scan simply means the miss
    // counters do not advance this tick (and nothing is ever flagged from a
    // partial scan). Fail the job so the workflow surfaces the Zoho error.
    console.log(`crm-runner: Zoho list fetch failed (${e.message}) — floor rows left untouched`);
    process.exit(1);
  }

  // Round values (createdToday already a clean boolean from orderRow).
  totalValue = Math.round(totalValue * 100) / 100;
  for (const s of STAGES) {
    stages[s].value = Math.round(stages[s].value * 100) / 100;
  }

  // Line-item slimming: raw Zoho items carry ~80 keys each; keep display scalars
  // only (objects/arrays in these fields break React rendering downstream).
  const SLIM_KEYS = ['line_item_id', 'item_id', 'name', 'description', 'sku', 'item_code', 'quantity', 'unit', 'rate', 'item_total'];
  const slimItem = (li) => {
    const o = {};
    for (const k of SLIM_KEYS) {
      const v = li[k];
      if (v === undefined || v === '' || v === null) continue;
      if (typeof v === 'object') continue;
      o[k] = v;
    }
    return o;
  };
  // Per-tick detail budget. Each detail call is ONE Zoho request (it returns
  // both the line items and the client addresses) and Zoho Books allows
  // ~100 requests/min per org; the cron jobs run in a serial group, so this
  // runner is the only Zoho pinger while it runs. 80 rows × ~2s ≈ 3 min,
  // comfortably inside the 20-minute job timeout and the rate limit, and it
  // clears a 30-day cold start (~120 orders) in two ticks.
  const ITEM_BUDGET = 80;

  // What the floor already tracks: drives the item backfill queue AND the
  // by-id re-verification that makes a deletion definitive.
  let localOrders = [];
  try {
    const state = await workerRequest(API.crmState);
    localOrders = Array.isArray(state?.orders) ? state.orders : [];
  } catch (e) {
    console.log(`crm-runner: floor state unavailable (${e.message}) — items may be refetched`);
  }
  // A row is "detail-complete" when it has line items AND the client addresses
  // (both arrive from the same Zoho detail call).
  const detailKnown = new Set(
    localOrders
      .filter((o) => Number(o.itemCount) > 0 && o.hasAddress)
      .map((o) => `${o.org || ''}:${o.so}`),
  );

  // Line items + addresses, round 2: only IN-WINDOW orders the floor has not
  // captured in full yet, newest first (the index is already newest-first).
  // Detail accumulates across ticks until every floor order is complete.
  const cutoff = dayBefore(today, FLOOR_WINDOW_DAYS);
  const inWindow = (e) => !!e?.so && (!e.createdDay || e.createdDay >= cutoff);
  const queue = index
    .filter((e) => inWindow(e) && e.stage !== 'complete' && !detailKnown.has(`${e.org || ''}:${e.so}`))
    .map((e) => ({ entry: e, hit: activeBySo.get(`${e.org || ''}:${e.so}`) }))
    .filter((q) => q.hit && q.hit.id);
  const due = queue.slice(0, ITEM_BUDGET);
  const itemsByKey = new Map();
  const addressesByKey = new Map();
  const t0 = Date.now();
  let detailErrors = 0;
  for (const { entry, hit } of due) {
    try {
      const detail = await fetchOrderDetail(hit.id, entry.org);
      const key = `${entry.org || ''}:${entry.so}`;
      itemsByKey.set(key, detail.items.filter((li) => !isChargeLine(li)).map(slimItem));
      if (detail.billingAddress || detail.shippingAddress) {
        addressesByKey.set(key, {
          billingAddress: detail.billingAddress,
          shippingAddress: detail.shippingAddress,
        });
      }
    } catch (e) {
      detailErrors++;
      if (e?.message && !String(e.message).includes('circuit open')) {
        console.log(`crm-runner: detail fetch failed for ${entry.so}: ${e.message}`);
      }
    }
    await sleep(1200 + Math.random() * 1300); // ~1.2–2.5s gap — paced, never burst Zoho
  }
  const detailMs = Date.now() - t0;
  if (detailCircuitOpen) console.log('crm-runner: detail circuit open — remaining rows skip items this tick');
  if (detailErrors > 0) console.log(`crm-runner: ${detailErrors} detail fetch(es) failed (retried next tick)`);
  const deferred = Math.max(0, queue.length - due.length);
  if (deferred > 0) console.log(`crm-runner: ${deferred} order(s) still without items (budget ${ITEM_BUDGET}/tick ≈ ${Math.ceil(deferred / ITEM_BUDGET)} more tick(s))`);

  // The ONE sink: D1 rows. The runner only fetches; the Worker decides what to
  // insert, update, score or flag.
  await postFloorSync({ date: today, index, stages, closed, activeBySo, itemsByKey, addressesByKey, localOrders });

  const summary = STAGES.filter((s) => stages[s].count > 0)
    .map((s) => `${s}:${stages[s].count}(₹${Math.round(stages[s].value).toLocaleString()})`)
    .join('  ');
  console.log(
    `crm-runner: ${pages} page(s), ${scanned} scanned, ${totalActive} active SOs (₹${totalValue.toLocaleString()}), ` +
      `${due.length} detail fetch(es) + ${deferred} queued in ${Math.round(detailMs / 100) / 10}s — ${summary}`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('crm-runner: fatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { pendingStep };
