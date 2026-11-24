// ─────────────────────────────────────────────────────────────────────────────
// routes/crm.ts — dispatch floor + unified Sales → Dispatch API.
//
// Thin orchestrators only: validation + state transitions live in
// src/modules/crm/scheduling.ts, persistence in src/modules/crm/store.ts.
//
// Authz (founder decision):
//   READ    — `crm` / `dispatch` (the desk) + `telecalling` (the sales team, via
//             the unified Sales workspace) + root/sales-head.
//   FLOOR   — schedule/reschedule/dispatch/addresses/amend/confirm: anyone
//             with floor access (`crm` or `dispatch` scope, root always).
//             Dispatching is the floor's job — the desk scopes share it
//             (founder decision 2026-11-19: `crm`-only holders were read-locked
//             out of every write, leaving root as the only operator).
//   CANCEL  — whole-SO or pending-lines, anyone with CRM read (floor + sales
//             agents + sales-head + root); agents are region-locked to their
//             OWN region server-side, like promise dates. Reopen stays root-only.
//   PROMISE — tentative dates + delay reasons: the floor AND sales agents, but
//             an agent may only touch orders in their OWN region (server-enforced
//             from the session, never from a client-supplied region).
//
// Region scoping: every read applies `region` server-side. Root/sales-head
// see all regions (and an explicit chip filter); an agent is hard-locked to the
// region on their Telecaller roster row. No roster row ⇒ no orders.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, isApproved, requireAdminScope, adminScopeError, notifyLive, type Bindings } from '../context';
import { ScopeKeys } from '../../modules/auth/types';
import {
  CrmError,
  amendOrderItems,
  attachProofDocs,
  cancelOrderItems,
  cancelOrderLocal,
  confirmSourceDeletion,
  dispatchOrder,
  dispatchSummary,
  getOrder,
  orderRegion,
  reopenOrderLocal,
  rescheduleOrder,
  scheduleOrder,
  updateAddresses,
} from '../../modules/crm/store';
import { normalizeView } from '../../modules/crm/types';
import { listOrdersPaged } from '../../modules/crm/list-page';
import { parsePageQuery } from '../../shared/paging';
import { normalizeRegionFilter } from '../../modules/crm/region';
import { resolveRosterMatch } from '../../modules/telecalling/self';
import { listActiveTelecallers } from '../../modules/telecalling/self-roster';
import { getViewerMe } from '../viewer';
import { readBody } from '../http';
import { getAppSetting } from '../../shared/app-settings';

interface Viewer {
  id: string;
  scopes: string[];
  roles: string[];
  isAdmin: boolean;
  name: string;
  /** Telecaller roster row of the signed-in user (agents only). */
  staffId: string | null;
  /** Roster region (R1–R4; '' = not mapped). Managers keep ''. */
  region: string;
  /** Full-floor authority + all-region visibility: root/sales-head/crm/dispatch. */
  isManager: boolean;
  /** May set tentative dates/delay reasons (floor + sales agents). */
  canPromise: boolean;
  /** May execute floor transitions (schedule/dispatch/addresses/amend/removal). */
  canWriteFloor: boolean;
  /** Invoice-PDF gate (Setting `crm:invoice_gate`): `off` = dispatch without one. */
  invoiceGate: 'enforce' | 'off';
}

const lower = (v: unknown) => String(v ?? '').toLowerCase();

async function viewer(c: any): Promise<Viewer | null> {
  try {
    const me: any = await getViewerMe(c);
    if (!me || !isApproved(me)) return null;
    const scopes = (Array.isArray(me.scopes) ? me.scopes : []).map(lower);
    const roles = (Array.isArray(me.roles) ? me.roles : []).map(lower);
    const isAdmin = !!me.isAdmin || !!me.isRoot;
    const isManager =
      isAdmin ||
      scopes.includes(ScopeKeys.SalesHead) ||
      roles.includes('sales-head') ||
      scopes.includes(ScopeKeys.Crm) ||
      scopes.includes(ScopeKeys.Dispatch);
    const canWriteFloor = isAdmin || scopes.includes(ScopeKeys.Dispatch) || scopes.includes(ScopeKeys.Crm);
    const canPromise = canWriteFloor || scopes.includes(ScopeKeys.Telecalling) || scopes.includes(ScopeKeys.SalesHead) || roles.includes('sales-head');

    let staffId: string | null = null;
    let region = '';
    if (!isManager) {
      // Sales agent identity = the roster row matched to the session. The
      // region comes from the SERVER row, never from the request.
      const { prisma } = deps();
      const tcs = (await listActiveTelecallers(prisma)) as any[];
      const hit = resolveRosterMatch(tcs, me);
      if (hit) {
        staffId = String((hit as any).id ?? '') || null;
        region = String((hit as any).region ?? '').trim();
      }
    }

    // Runtime switch (Setting `crm:invoice_gate`, default `enforce`): one tiny
    // keyed read per CRM request keeps a flip instant — no cache to invalidate.
    const invoiceGate = (await getAppSetting('crm:invoice_gate')) === 'off' ? 'off' : 'enforce';
    return {
      id: String(me.user?.id ?? ''),
      scopes,
      roles,
      isAdmin,
      name: String(me.user?.name || me.user?.email || ''),
      staffId,
      region,
      isManager,
      canPromise,
      canWriteFloor,
      invoiceGate,
    };
  } catch {
    return null;
  }
}

function denial(c: any, message: string, status = 403) {
  return c.json({ error: message }, status as any);
}

/** Read access: the dispatch desk, sales agents, and sales leadership. */
async function requireRead(c: any): Promise<Viewer | Response> {
  try {
    // Root grants everything — fast, explicit path.
    await requireAdminScope(c);
  } catch (e) {
    const v = await viewer(c);
    if (!v) return adminScopeError(c, e);
    if (!v.isManager && !v.scopes.includes(ScopeKeys.Telecalling)) {
      return denial(c, 'CRM read access required (crm, dispatch or telecalling scope).');
    }
    return v;
  }
  // Root passed — still returns the full viewer so region chips + write flags work.
  const v = await viewer(c);
  return v || {
    id: '', scopes: [], roles: [], isAdmin: true, name: 'root',
    staffId: null, region: '', isManager: true, canPromise: true, canWriteFloor: true,
    invoiceGate: 'enforce',
  };
}

/** Floor transitions require floor access (the `crm` or `dispatch` scope, or root). */
async function requireDispatchWrite(c: any): Promise<Viewer | Response> {
  const v = await viewer(c);
  if (!v) return c.json({ error: 'Sign-in required.' }, 401);
  if (v.canWriteFloor) return v;
  return denial(c, 'Dispatch floor access required — ask root for the crm or dispatch scope.');
}

/** Floor-cancel reversal is root-only. */
async function requireRootWrite(c: any): Promise<Viewer | Response> {
  const v = await viewer(c);
  if (!v) return c.json({ error: 'Sign-in required.' }, 401);
  if (v.isAdmin) return v;
  return denial(c, 'Root access required to reopen a cancelled sales order.');
}

/** Promise dates: floor OR sales agent (own region, enforced by the caller). */
async function requirePromiseWrite(c: any): Promise<Viewer | Response> {
  const v = await viewer(c);
  if (!v) return c.json({ error: 'Sign-in required.' }, 401);
  if (v.canPromise) return v;
  return denial(c, 'Sales or dispatch access required to set dispatch dates.');
}

/** The region a read actually applies. `__none__` matches nothing — an agent
 *  with no roster region must never fall back to another region's orders. */
function scopedRegion(c: any, v: Viewer): string {
  if (v.isManager) return normalizeRegionFilter(c.req.query('region'));
  return v.region || '__none__';
}

function viewerMeta(v: Viewer) {
  return {
    staffId: v.staffId,
    name: v.name,
    region: v.region,
    isManager: v.isManager,
    canWrite: v.canWriteFloor,
    canPromise: v.canPromise,
    invoiceGate: v.invoiceGate,
  };
}

function fail(c: any, e: unknown) {
  if (e instanceof CrmError) return c.json({ error: e.message, code: e.code }, e.status as any);
  throw e;
}

export function registerCrmRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── List (one tab at a time) ────────────────────────────────────────────────
  app.get('/api/crm/orders', async (c) => {
    const v = await requireRead(c);
    if (v instanceof Response) return v;
    const view = normalizeView(c.req.query('view'));
    const region = scopedRegion(c, v);
    try {
      const paged = await listOrdersPaged({ view, region }, parsePageQuery((k) => c.req.query(k)));
      return c.json({ ...paged, view, region, viewer: viewerMeta(v) });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Headline counters (tab badges + region chips) ───────────────────────────
  app.get('/api/crm/summary', async (c) => {
    const v = await requireRead(c);
    if (v instanceof Response) return v;
    const region = scopedRegion(c, v);
    try {
      const counts = await dispatchSummary(undefined, region);
      // The region facet feeds the manager chips. An agent is locked to one
      // region (or none at all), so exposing every region's pipeline here would
      // leak the rest of the company's order book — keep only their own slice.
      if (!v.isManager) {
        const own = v.region || '';
        counts.regions = own && counts.regions?.[own] ? { [own]: counts.regions[own] } : {};
      }
      return c.json({ counts, region, viewer: viewerMeta(v) });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── One order + its audit trail ─────────────────────────────────────────────
  app.get('/api/crm/orders/:id', async (c) => {
    const v = await requireRead(c);
    if (v instanceof Response) return v;
    try {
      const order = await getOrder(c.req.param('id'));
      if (!order) return c.json({ error: 'Sales order not found.' }, 404);
      // Agents may only open their OWN region's orders (never another region's).
      if (!v.isManager && String(order.region ?? '') !== v.region) {
        return c.json({ error: 'Sales order not found.' }, 404);
      }
      return c.json({ order, viewer: viewerMeta(v) });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Schedule / partially schedule (floor) ───────────────────────────────────
  app.post('/api/crm/orders/:id/schedule', async (c) => {
    const v = await requireDispatchWrite(c);
    if (v instanceof Response) return v;
    const body = await readBody(c);
    const entries = Array.isArray(body?.items) ? body.items : [];
    try {
      const res = await scheduleOrder({
        idOrSo: c.req.param('id'),
        entries: entries.map((e: any) => ({
          itemId: String(e?.itemId ?? e?.id ?? ''),
          date: e?.date === undefined || e?.date === null || e?.date === '' ? null : String(e.date),
          reason: e?.reason === undefined || e?.reason === null ? null : String(e.reason),
        })),
        soReason: body?.soReason ? String(body.soReason) : null,
        actor: v.name,
      });
      notifyLive(c, { type: 'crm', action: 'scheduled', so: res.order?.soNumber });
      return c.json({ ok: true, lifecycle: res.lifecycle, order: res.order });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Promise dates (sales agent or floor; own region only) ───────────────────
  // Same lifecycle as a schedule: dates move an item to `scheduled`, an undated
  // selection records the delay reason. The ONLY extra rule is the region gate.
  app.patch('/api/crm/orders/:id/promise', async (c) => {
    const v = await requirePromiseWrite(c);
    if (v instanceof Response) return v;
    const idOrSo = c.req.param('id');
    try {
      if (!v.isManager) {
        if (!v.region) {
          return denial(c, 'No sales region is mapped to your login — ask the sales-head to map you on the roster.');
        }
        const region = await orderRegion(idOrSo);
        if (region === null) return c.json({ error: 'Sales order not found.' }, 404);
        if (region !== v.region) {
          return denial(c, 'This sales order belongs to another region.');
        }
      }
      const body = await readBody(c);
      const entries = Array.isArray(body?.items) ? body.items : [];
      const res = await scheduleOrder({
        idOrSo,
        entries: entries.map((e: any) => ({
          itemId: String(e?.itemId ?? e?.id ?? ''),
          date: e?.date === undefined || e?.date === null || e?.date === '' ? null : String(e.date),
          reason: e?.reason === undefined || e?.reason === null ? null : String(e.reason),
        })),
        soReason: body?.soReason ? String(body.soReason) : null,
        actor: v.name,
      });
      notifyLive(c, { type: 'crm', action: 'promised', so: res.order?.soNumber, region: v.region });
      return c.json({ ok: true, lifecycle: res.lifecycle, order: res.order });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Reschedule (mandatory reason) ───────────────────────────────────────────
  app.post('/api/crm/orders/:id/reschedule', async (c) => {
    const v = await requireDispatchWrite(c);
    if (v instanceof Response) return v;
    const body = await readBody(c);
    const entries = Array.isArray(body?.items) ? body.items : [];
    try {
      const res = await rescheduleOrder({
        idOrSo: c.req.param('id'),
        entries: entries.map((e: any) => ({
          itemId: String(e?.itemId ?? e?.id ?? ''),
          date: e?.date === undefined || e?.date === null || e?.date === '' ? null : String(e.date),
        })),
        reason: body?.reason ? String(body.reason) : null,
        actor: v.name,
      });
      notifyLive(c, { type: 'crm', action: 'rescheduled', so: res.order?.soNumber });
      return c.json({ ok: true, lifecycle: res.lifecycle, order: res.order });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Dispatch (full or partial) ──────────────────────────────────────────────
  // PROOF GATE (2026-11-04, liftable 2026-11-26): every dispatch consumes a
  // fresh invoice PDF (packing photos optional) — unless Setting
  // `crm:invoice_gate` is `off`, when the batch records a `no-invoice:` marker
  // instead. The store verifies ownership/kind/mime/freshness of every document
  // that IS supplied; a missing or reused invoice fails the whole dispatch and
  // consumes nothing.
  app.post('/api/crm/orders/:id/dispatch', async (c) => {
    const v = await requireDispatchWrite(c);
    if (v instanceof Response) return v;
    const body = await readBody(c);
    const entries = Array.isArray(body?.items) ? body.items : [];
    const proof = body?.proof && typeof body.proof === 'object' ? body.proof : null;
    // Gate off (carried on the viewer) = the invoice PDF is optional here.
    const requireInvoice = v.invoiceGate !== 'off';
    try {
      const res = await dispatchOrder({
        idOrSo: c.req.param('id'),
        requireInvoice,
        entries: entries.map((e: any) => ({
          itemId: String(e?.itemId ?? e?.id ?? ''),
          qty: e?.qty === undefined || e?.qty === null || e?.qty === '' ? null : Number(e.qty),
        })),
        proof: proof
          ? {
              invoiceId: String(proof?.invoiceId ?? ''),
              beforeId: String(proof?.beforeId ?? ''),
              afterId: String(proof?.afterId ?? ''),
              transportId: String(proof?.transportId ?? ''),
              courierId: String(proof?.courierId ?? ''),
              packingListId: String(proof?.packingListId ?? ''),
            }
          : null,
        actor: v.name,
      });
      notifyLive(c, { type: 'crm', action: 'dispatched', so: res.order?.soNumber });
      return c.json({ ok: true, lifecycle: res.lifecycle, credited: res.credited, order: res.order });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Attach documents to an existing proof (floor, after the dispatch) ──────
  // The floor may dispatch invoice-only and add the rest later from the same
  // panel: before/after packing photos plus the transport receipt, courier
  // receipt and packing list. First-write-wins per slot; consumed-file rules
  // match the dispatch gate. `/photos` is the original photos-only path kept
  // for older clients — both hit the same handler. Returns the refreshed order.
  const attachProofHandler = async (c: any) => {
    const v = await requireDispatchWrite(c);
    if (v instanceof Response) return v;
    const body = await readBody(c);
    try {
      const res = await attachProofDocs({
        idOrSo: c.req.param('id'),
        proofId: c.req.param('proofId'),
        beforeId: body?.beforeId ?? null,
        afterId: body?.afterId ?? null,
        transportId: body?.transportId ?? null,
        courierId: body?.courierId ?? null,
        packingListId: body?.packingListId ?? null,
        actor: v.name,
      });
      notifyLive(c, { type: 'crm', action: 'proof-docs', so: res.order?.soNumber });
      return c.json({ ok: true, order: res.order });
    } catch (e) {
      return fail(c, e);
    }
  };
  app.post('/api/crm/orders/:id/proofs/:proofId/documents', attachProofHandler);
  app.post('/api/crm/orders/:id/proofs/:proofId/photos', attachProofHandler);

  // ── Amend items (client-confirmed floor overlay — floor/crm/dispatch/root only) ───────
  // Qty changes, line removals and added lines. The reason is the
  // client-confirmation note and every line is audit-logged. Nothing is
  // written back to Zoho Books (read-only).
  app.put('/api/crm/orders/:id/items', async (c) => {
    const v = await requireDispatchWrite(c);
    if (v instanceof Response) return v;
    const body = await readBody(c);
    try {
      const res = await amendOrderItems({
        idOrSo: c.req.param('id'),
        qtyChanges: Array.isArray(body?.qtyChanges)
          ? body.qtyChanges.map((e: any) => ({ itemId: String(e?.itemId ?? e?.id ?? ''), qty: Number(e?.qty) }))
          : [],
        removals: Array.isArray(body?.removals)
          ? body.removals.map((e: any) => ({ itemId: String(e?.itemId ?? e?.id ?? '') }))
          : [],
        additions: Array.isArray(body?.additions)
          ? body.additions.map((e: any) => ({
              name: String(e?.name ?? ''),
              qty: Number(e?.qty),
              unit: e?.unit === undefined || e?.unit === null ? null : String(e.unit),
              rate: e?.rate === undefined || e?.rate === null || e?.rate === '' ? null : Number(e.rate),
            }))
          : [],
        reason: body?.reason ? String(body.reason) : null,
        actor: v.name,
      });
      notifyLive(c, { type: 'crm', action: 'amended', so: res.order?.soNumber });
      return c.json({ ok: true, lifecycle: res.lifecycle, order: res.order });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Cancel the whole SO (client-confirmed — anyone with CRM read; agents
  // own-region only, enforced from the session like promise dates). Reopen
  // stays root-only.
  app.post('/api/crm/orders/:id/cancel-local', async (c) => {
    const v = await requireRead(c);
    if (v instanceof Response) return v;
    const idOrSo = c.req.param('id');
    if (!v.isManager) {
      if (!v.region) {
        return denial(c, 'No sales region is mapped to your login — ask the sales-head to map you on the roster.');
      }
      const region = await orderRegion(idOrSo);
      if (region === null) return c.json({ error: 'Sales order not found.' }, 404);
      if (region !== v.region) {
        return denial(c, 'This sales order belongs to another region.');
      }
    }
    const body = await readBody(c);
    try {
      const res = await cancelOrderLocal({
        idOrSo,
        reason: body?.reason ? String(body.reason) : null,
        actor: v.name,
      });
      notifyLive(c, { type: 'crm', action: 'cancelled_local', so: res.order?.soNumber });
      return c.json({ ok: true, lifecycle: res.lifecycle, order: res.order });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Cancel pending quantities (partial SO cancel — anyone with CRM read;
  // agents own-region only, enforced from the session like promise dates).
  // unavailable stock only: each entry cancels qty (omitted = full remaining);
  // a full remainder removes the line, a partial qty shrinks it. Nothing left
  // to cancel is rejected, and cancelling every live line in full stays a
  // whole-SO cancel so partial vs full stays unambiguous.
  app.post('/api/crm/orders/:id/cancel-items', async (c) => {
    const v = await requireRead(c);
    if (v instanceof Response) return v;
    const idOrSo = c.req.param('id');
    if (!v.isManager) {
      if (!v.region) {
        return denial(c, 'No sales region is mapped to your login — ask the sales-head to map you on the roster.');
      }
      const region = await orderRegion(idOrSo);
      if (region === null) return c.json({ error: 'Sales order not found.' }, 404);
      if (region !== v.region) {
        return denial(c, 'This sales order belongs to another region.');
      }
    }
    const body = await readBody(c);
    const legacyIds = Array.isArray(body?.itemIds)
      ? body.itemIds.map((e: any) => String((e as any)?.itemId ?? e ?? ''))
      : [];
    const entries = Array.isArray(body?.entries)
      ? body.entries.map((e: any) => ({
          itemId: String((e as any)?.itemId ?? ''),
          qty: (e as any)?.qty === undefined || (e as any)?.qty === null || (e as any)?.qty === '' ? null : Number((e as any)?.qty),
        }))
      : legacyIds.map((itemId: string) => ({ itemId }));
    try {
      const res = await cancelOrderItems({
        idOrSo,
        itemIds: legacyIds,
        entries,
        reason: body?.reason ? String(body.reason) : null,
        actor: v.name,
      });
      notifyLive(c, { type: 'crm', action: 'items_cancelled', so: res.order?.soNumber });
      return c.json({ ok: true, lifecycle: res.lifecycle, order: res.order });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Reopen a floor-cancelled SO (root only) ────────────────────────────────
  app.post('/api/crm/orders/:id/reopen', async (c) => {
    const v = await requireRootWrite(c);
    if (v instanceof Response) return v;
    try {
      const res = await reopenOrderLocal({ idOrSo: c.req.param('id'), actor: v.name });
      notifyLive(c, { type: 'crm', action: 'reopened_local', so: res.order?.soNumber });
      return c.json({ ok: true, lifecycle: res.lifecycle, order: res.order });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Confirm a source deletion (destructive — floor/crm/dispatch/root only) ─────────────
  app.post('/api/crm/orders/:id/confirm-source-deletion', async (c) => {
    const v = await requireDispatchWrite(c);
    if (v instanceof Response) return v;
    try {
      const res = await confirmSourceDeletion({ idOrSo: c.req.param('id'), actor: v.name });
      notifyLive(c, { type: 'crm', action: 'removed', so: res.soNumber });
      return c.json({ ok: true, ...res });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Correct the client addresses (floor edit — floor/crm/dispatch/root only) ───────────
  // The edit sets the edited marker, so the Zoho sync leaves that address
  // alone afterwards. Nothing is written back to Zoho Books (read-only).
  app.put('/api/crm/orders/:id/addresses', async (c) => {
    const v = await requireDispatchWrite(c);
    if (v instanceof Response) return v;
    const body = await readBody(c);
    try {
      const res = await updateAddresses({
        idOrSo: c.req.param('id'),
        billingAddress: body?.billingAddress === undefined ? undefined : String(body.billingAddress ?? ''),
        shippingAddress: body?.shippingAddress === undefined ? undefined : String(body.shippingAddress ?? ''),
        actor: v.name,
      });
      notifyLive(c, { type: 'crm', action: 'addresses_updated', so: res.order?.soNumber });
      return c.json({ ok: true, order: res.order });
    } catch (e) {
      return fail(c, e);
    }
  });
}
