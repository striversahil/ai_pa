// ─────────────────────────────────────────────────────────────────────────────
// routes/crm-sync.ts — runner → D1 sync for the CRM dispatch floor.
//
// The runner (scripts/crm-runner.js) pages Zoho Books, then POSTs the scanned
// window here. This module is the ONLY writer of CrmSalesOrder rows, so the
// sync rules live in one place:
//
//   new OPEN order            → inserted at lifecycle `unscheduled`
//   existing order            → Zoho fields refreshed, local schedule untouched
//   brand-new COMPLETE order  → skipped (it was never on the floor)
//   absent from the scan      → missCount++ → flagged `deleted_source` at 2
//   verified 404 by id        → flagged immediately (definitive)
//   flagged order reappears   → self-heals to active
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { notifyLive, requireSecret, type Bindings } from '../context';
import { syncOrders, syncState, type SyncedOrder } from '../../modules/crm/store';
import { istToday } from '../../modules/crm/types';
import { readBody } from '../http';

/** Zoho list row → the store's normalized shape. Keeps the runner payload thin. */
function normalizeOrder(o: any): SyncedOrder | null {
  const so = String(o?.so ?? o?.salesorder_number ?? '').trim();
  if (!so) return null;
  return {
    so,
    org: String(o?.org ?? ''),
    zohoId: String(o?.zohoId ?? o?.salesorder_id ?? ''),
    customer: String(o?.customer ?? o?.customer_name ?? ''),
    customerId: String(o?.customerId ?? o?.customer_id ?? ''),
    total: Number(o?.total) || 0,
    currency: String(o?.currency ?? 'INR'),
    status: String(o?.status ?? ''),
    orderStatus: String(o?.orderStatus ?? o?.order_status ?? ''),
    invoicedStatus: String(o?.invoicedStatus ?? o?.invoiced_status ?? ''),
    shippedStatus: String(o?.shippedStatus ?? o?.shipped_status ?? ''),
    paidStatus: String(o?.paidStatus ?? o?.paid_status ?? ''),
    salesperson: String(o?.salesperson ?? o?.salesperson_name ?? ''),
    ref: String(o?.ref ?? o?.reference_number ?? ''),
    // Client addresses + payment terms — present only when the runner sent
    // this order's detail (the Zoho list response carries neither). Empty =
    // leave the row as is.
    billingAddress: String(o?.billingAddress ?? '').slice(0, 600),
    shippingAddress: String(o?.shippingAddress ?? '').slice(0, 600),
    paymentTerms: String(o?.paymentTerms ?? '').slice(0, 120),
    createdDate: String(o?.createdDate ?? o?.createdTime ?? o?.created_time ?? ''),
    createdTime: String(o?.createdTime ?? o?.created_time ?? ''),
    items: Array.isArray(o?.items) ? o.items : undefined,
  };
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
}

export function registerCrmSyncRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // What the worker already tracks — lets the runner compute the scan diff and
  // decide which missing orders are worth re-verifying by id.
  app.get('/api/runner/crm/state', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    try {
      const state = await syncState();
      return c.json({ ok: true, ...state });
    } catch (e: any) {
      return c.json({ ok: false, error: String(e?.message || e) }, 500);
    }
  });

  // The tick sink. Idempotent: re-posting the same window changes nothing but
  // refreshes lastSeenAt (so a retry after a network error is harmless).
  app.post('/api/runner/crm/orders/sync', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const body = await readBody(c);
    const raw = Array.isArray(body?.orders) ? body.orders : [];
    const orders = raw.map(normalizeOrder).filter((o): o is SyncedOrder => !!o);
    if (!orders.length) {
      return c.json({ ok: false, error: 'orders[] required (one entry per scanned sales order)' }, 400);
    }
    const day = typeof body?.date === 'string' && body.date ? body.date : istToday();
    try {
      const result = await syncOrders({
        day,
        orders,
        verify: {
          present: stringList(body?.verify?.present),
          gone: stringList(body?.verify?.gone),
        },
      });
      // New orders, deletions and self-heals all change the floor — tell open
      // tabs to refetch (~2s) instead of waiting for the next poll.
      if (result.created || result.flagged || result.healed) {
        notifyLive(c, {
          type: 'crm',
          action: 'synced',
          created: result.created,
          flagged: result.flagged,
        });
      }
      return c.json({ ok: true, ...result });
    } catch (e: any) {
      return c.json({ ok: false, error: String(e?.message || e) }, 500);
    }
  });
}
