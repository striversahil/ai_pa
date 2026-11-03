// ─────────────────────────────────────────────────────────────────────────────
// routes/crm.ts — dispatch floor API (schedule → dispatch → source deletion).
//
// Thin orchestrators only: validation + state transitions live in
// src/modules/crm/scheduling.ts, persistence in src/modules/crm/store.ts.
//
// Authz (founder decision):
//   READ   — `crm` or `dispatch` scope (MIS/root always)
//   WRITE  — `dispatch` scope only (MIS/root always) — scheduling, rescheduling
//            and dispatching are the floor's job, not the desk reader's.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { authStore, getMe, isApproved, readSessionCookie, requireMisScope, misScopeError, notifyLive, type Bindings } from '../context';
import {
  CrmError,
  confirmSourceDeletion,
  dispatchOrder,
  dispatchSummary,
  getOrder,
  listOrders,
  rescheduleOrder,
  scheduleOrder,
} from '../../modules/crm/store';
import { normalizeView } from '../../modules/crm/types';

interface Viewer {
  scopes: string[];
  roles: string[];
  isAdmin: boolean;
  name: string;
}

async function viewer(c: any): Promise<Viewer | null> {
  try {
    const me: any = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    if (!me || !isApproved(me)) return null;
    return {
      scopes: Array.isArray(me.scopes) ? me.scopes : [],
      roles: Array.isArray(me.roles) ? me.roles : [],
      isAdmin: !!me.isAdmin || !!me.isRoot,
      // getMe() returns { user, scopes, roles, isAdmin } — the name lives on
      // `user`. Reading `me.name` silently recorded an empty actor on every
      // schedule/dispatch in the audit trail.
      name: String(me.user?.name || me.user?.email || ''),
    };
  } catch {
    return null;
  }
}

/** MIS scope wins outright; otherwise fall back to the session scopes. */
async function requireRead(c: any): Promise<Viewer | Response> {
  try {
    await requireMisScope(c);
    const v = await viewer(c);
    return v || { scopes: [], roles: [], isAdmin: true, name: 'MIS' };
  } catch (e) {
    const v = await viewer(c);
    if (!v) return misScopeError(c, e);
    const allowed = v.isAdmin || v.scopes.includes('crm') || v.scopes.includes('dispatch') || v.scopes.includes('mis');
    if (!allowed) return c.json({ error: 'CRM read access required (crm or dispatch scope).' }, 403);
    return v;
  }
}

/** Scheduling and dispatch require the `dispatch` scope (or MIS/root). */
async function requireDispatchWrite(c: any): Promise<Viewer | Response> {
  const v = await viewer(c);
  if (!v) return c.json({ error: 'Sign-in required.' }, 401);
  if (v.isAdmin || v.scopes.includes('dispatch') || v.scopes.includes('mis')) return v;
  return c.json({ error: 'Dispatch access required — ask root for the dispatch scope.' }, 403);
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
    try {
      const orders = await listOrders({ view, q, limit });
      return c.json({ view, orders, count: orders.length });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Headline counters (tab badges) ──────────────────────────────────────────
  app.get('/api/crm/summary', async (c) => {
    const v = await requireRead(c);
    if (v instanceof Response) return v;
    try {
      return c.json({ counts: await dispatchSummary() });
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
      return c.json({ order });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Schedule / partially schedule ───────────────────────────────────────────
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
  app.post('/api/crm/orders/:id/dispatch', async (c) => {
    const v = await requireDispatchWrite(c);
    if (v instanceof Response) return v;
    const body = await c.req.json().catch(() => ({}));
    const entries = Array.isArray(body?.items) ? body.items : [];
    try {
      const res = await dispatchOrder({
        idOrSo: c.req.param('id'),
        entries: entries.map((e: any) => ({
          itemId: String(e?.itemId ?? e?.id ?? ''),
          qty: e?.qty === undefined || e?.qty === null || e?.qty === '' ? null : Number(e.qty),
        })),
        actor: v.name,
      });
      notifyLive(c, { type: 'crm', action: 'dispatched', so: res.order?.soNumber });
      return c.json({ ok: true, lifecycle: res.lifecycle, credited: res.credited, order: res.order });
    } catch (e) {
      return fail(c, e);
    }
  });

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
}
