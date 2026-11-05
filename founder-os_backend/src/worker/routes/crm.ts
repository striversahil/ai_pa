// ─────────────────────────────────────────────────────────────────────────────
// routes/crm.ts — dispatch floor + unified Sales → Dispatch API.
//
// Thin orchestrators only: validation + state transitions live in
// src/modules/crm/scheduling.ts, persistence in src/modules/crm/store.ts.
//
// Authz (founder decision):
//   READ    — `crm` / `dispatch` (the desk) + `telecalling` (the sales team, via
//             the unified Sales workspace) + MIS/root/sales-head.
//   FLOOR   — schedule/reschedule/dispatch/addresses/confirm: `dispatch` scope
//             only (MIS/root always). Dispatching is the floor's job.
//   PROMISE — tentative dates + delay reasons: the floor AND sales agents, but
//             an agent may only touch orders in their OWN region (server-enforced
//             from the session, never from a client-supplied region).
//
// Region scoping: every read applies `region` server-side. Root/MIS/sales-head
// see all regions (and an explicit chip filter); an agent is hard-locked to the
// region on their Telecaller roster row. No roster row ⇒ no orders.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { authStore, deps, getMe, isApproved, readSessionCookie, requireMisScope, misScopeError, notifyLive, type Bindings } from '../context';
import {
  CrmError,
  attachProofDocs,
  confirmSourceDeletion,
  dispatchOrder,
  dispatchSummary,
  getOrder,
  listOrders,
  orderRegion,
  rescheduleOrder,
  scheduleOrder,
  updateAddresses,
} from '../../modules/crm/store';
import { normalizeView } from '../../modules/crm/types';
import { normalizeRegionFilter } from '../../modules/crm/region';
import { resolveRosterMatch } from '../../modules/telecalling/self';

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
  /** Full-floor authority + all-region visibility: root/MIS/sales-head/crm/dispatch. */
  isManager: boolean;
  /** May set tentative dates/delay reasons (floor + sales agents). */
  canPromise: boolean;
  /** May execute floor transitions (schedule/dispatch/addresses/removal). */
  canWriteFloor: boolean;
}

const lower = (v: unknown) => String(v ?? '').toLowerCase();

async function viewer(c: any): Promise<Viewer | null> {
  try {
    const me: any = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    if (!me || !isApproved(me)) return null;
    const scopes = (Array.isArray(me.scopes) ? me.scopes : []).map(lower);
    const roles = (Array.isArray(me.roles) ? me.roles : []).map(lower);
    const isAdmin = !!me.isAdmin || !!me.isRoot;
    const isManager =
      isAdmin ||
      scopes.includes('mis') ||
      scopes.includes('sales-head') ||
      roles.includes('sales-head') ||
      scopes.includes('crm') ||
      scopes.includes('dispatch');
    const canWriteFloor = isAdmin || scopes.includes('dispatch') || scopes.includes('mis');
    const canPromise = canWriteFloor || scopes.includes('telecalling') || scopes.includes('sales-head') || roles.includes('sales-head');

    let staffId: string | null = null;
    let region = '';
    if (!isManager) {
      // Sales agent identity = the roster row matched to the session. The
      // region comes from the SERVER row, never from the request.
      const { prisma } = deps();
      const tcs = (await prisma.telecaller.findMany({ where: { deleted: false } })) as any[];
      const hit = resolveRosterMatch(tcs, me);
      if (hit) {
        staffId = String((hit as any).id ?? '') || null;
        region = String((hit as any).region ?? '').trim();
      }
    }

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
    // `mis` scope grants everything — fast, explicit path.
    await requireMisScope(c);
  } catch (e) {
    const v = await viewer(c);
    if (!v) return misScopeError(c, e);
    if (!v.isManager && !v.scopes.includes('telecalling')) {
      return denial(c, 'CRM read access required (crm, dispatch or telecalling scope).');
    }
    return v;
  }
  // MIS passed — still return the full viewer so region chips + write flags work.
  const v = await viewer(c);
  return v || {
    id: '', scopes: ['mis'], roles: [], isAdmin: true, name: 'MIS',
    staffId: null, region: '', isManager: true, canPromise: true, canWriteFloor: true,
  };
}

/** Floor transitions require the `dispatch` scope (or MIS/root). */
async function requireDispatchWrite(c: any): Promise<Viewer | Response> {
  const v = await viewer(c);
  if (!v) return c.json({ error: 'Sign-in required.' }, 401);
  if (v.canWriteFloor) return v;
  return denial(c, 'Dispatch access required — ask root for the dispatch scope.');
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
    const q = String(c.req.query('q') || '');
    const limit = Number(c.req.query('limit') || 500);
    const region = scopedRegion(c, v);
    try {
      const orders = await listOrders({ view, q, limit, region });
      return c.json({ view, orders, count: orders.length, region, viewer: viewerMeta(v) });
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
    const body = await c.req.json().catch(() => ({}));
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
      const body = await c.req.json().catch(() => ({}));
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
    const body = await c.req.json().catch(() => ({}));
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
  // PROOF GATE (2026-11-04): every dispatch consumes a fresh invoice PDF
  // (packing photos optional). The store verifies ownership/kind/mime/freshness;
  // a missing or reused invoice fails the whole dispatch and consumes nothing.
  app.post('/api/crm/orders/:id/dispatch', async (c) => {
    const v = await requireDispatchWrite(c);
    if (v instanceof Response) return v;
    const body = await c.req.json().catch(() => ({}));
    const entries = Array.isArray(body?.items) ? body.items : [];
    const proof = body?.proof && typeof body.proof === 'object' ? body.proof : null;
    try {
      const res = await dispatchOrder({
        idOrSo: c.req.param('id'),
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
    const body = await c.req.json().catch(() => ({}));
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

  // ── Confirm a source deletion (destructive — dispatch/MIS only) ─────────────
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

  // ── Correct the client addresses (floor edit — dispatch/MIS only) ───────────
  // The edit sets the edited marker, so the Zoho sync leaves that address
  // alone afterwards. Nothing is written back to Zoho Books (read-only).
  app.put('/api/crm/orders/:id/addresses', async (c) => {
    const v = await requireDispatchWrite(c);
    if (v instanceof Response) return v;
    const body = await c.req.json().catch(() => ({}));
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
