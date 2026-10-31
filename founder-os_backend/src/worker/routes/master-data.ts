// ─────────────────────────────────────────────────────────────────────────────
// routes/master-data.ts — Customer master (Zoho customer book) API.
//
// Worker-only: Express is frozen (founder decision), so there is no mirror.
// The dashboard payload rides the automation data endpoint
// (`/api/automations/master-data/data`) like every other dashboard; this module
// owns the detail read and every write.
//
// Access:
//   read    → `master-data` (dashboard grant), `enquiry-tracker` (the sales
//             board the table is embedded in), or sales-head / MIS / root
//   edit    → a user the sales-head appointed (`master-data-edit` direct scope)
//             or sales-head / MIS / root
//   appoint → sales-head / MIS / root only
//   import  → sales-head / MIS / root only (bulk replace, not a correction)
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import {
  authStore, getMe, readSessionCookie, notifyLive, LiveEvent, type Bindings,
} from '../context';
import { AuthError } from '../../modules/auth/types';
import {
  getCustomerDetail, updateCustomer, setDuplicateReview, importMasterData,
  MasterDataError, type Actor,
} from '../../modules/master-data/service';
import {
  canEditMaster, canViewMaster, isMasterManager, listEditors, setEditor,
} from '../../modules/master-data/editors';
import type { CustomerPatch, DuplicateReview } from '../../modules/master-data/types';

async function meFor(c: any) {
  return getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
}

function actorOf(me: any): Actor {
  return { id: String(me?.user?.id ?? ''), name: String(me?.user?.name ?? me?.user?.email ?? '') };
}

function fail(c: any, e: unknown) {
  if (e instanceof MasterDataError) return c.json({ error: e.message }, e.status as any);
  if (e instanceof AuthError) return c.json({ error: e.message }, ((e as any).status ?? 403) as any);
  throw e;
}

async function requireView(c: any) {
  const me = await meFor(c);
  if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
  if (!canViewMaster(me)) throw new AuthError('FORBIDDEN', "Requires 'master-data' permission", 403);
  return me;
}

async function requireEdit(c: any) {
  const me = await meFor(c);
  if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
  if (!canEditMaster(me)) {
    throw new AuthError('FORBIDDEN', 'Only appointed customer-master editors can change records', 403);
  }
  return me;
}

async function requireManager(c: any) {
  const me = await meFor(c);
  if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
  if (!isMasterManager(me)) throw new AuthError('FORBIDDEN', 'sales-head, MIS or root only', 403);
  return me;
}

export function registerMasterDataRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Detail (drawer) ───────────────────────────────────────────────────────
  app.get('/api/master-data/customers/:id', async (c) => {
    try {
      await requireView(c);
      const customer = await getCustomerDetail(c.req.param('id'));
      return c.json({ customer });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Record edit (appointed editors + managers) ────────────────────────────
  app.patch('/api/master-data/customers/:id', async (c) => {
    try {
      const me = await requireEdit(c);
      const body = await c.req.json().catch(() => ({}));
      const customer = await updateCustomer(
        c.req.param('id'),
        body as CustomerPatch,
        actorOf(me),
        isMasterManager(me),
      );
      notifyLive(c, { type: LiveEvent.MasterData, id: customer.id });
      return c.json({ customer });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Duplicate review (mark a whole group) ─────────────────────────────────
  app.patch('/api/master-data/duplicates/:group', async (c) => {
    try {
      const me = await requireEdit(c);
      const body = await c.req.json().catch(() => ({}));
      const result = await setDuplicateReview(
        c.req.param('group'),
        String(body?.review ?? 'open') as DuplicateReview,
        actorOf(me),
      );
      notifyLive(c, { type: LiveEvent.MasterData, group: result.group, review: result.review });
      return c.json(result);
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Bulk re-import (managers only) ────────────────────────────────────────
  app.post('/api/master-data/import', async (c) => {
    try {
      const me = await requireManager(c);
      let json: unknown;
      try {
        json = await c.req.json();
      } catch {
        return c.json({ error: 'Expected a JSON body (the master extract file)' }, 400);
      }
      const result = await importMasterData(json, actorOf(me));
      notifyLive(c, { type: LiveEvent.MasterData, import: true });
      return c.json(result);
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Editor appointments (sales-head appoints individuals) ─────────────────
  app.get('/api/master-data/editors', async (c) => {
    try {
      await requireManager(c);
      const editors = await listEditors(authStore(c));
      return c.json({ editors });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.put('/api/master-data/editors/:userId', async (c) => {
    try {
      const me = await requireManager(c);
      const body = await c.req.json().catch(() => ({}));
      const canEdit = body?.canEdit === true;
      const entry = await setEditor(authStore(c), c.req.param('userId'), canEdit, actorOf(me));
      notifyLive(c, { type: LiveEvent.MasterData, editor: entry.userId, canEdit });
      return c.json({ editor: entry });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Viewer capabilities (the UI hides what the server would reject) ───────
  app.get('/api/master-data/capabilities', async (c) => {
    try {
      const me = await requireView(c);
      return c.json({
        canEdit: canEditMaster(me),
        canAppoint: isMasterManager(me),
        canImport: isMasterManager(me),
      });
    } catch (e) {
      return fail(c, e);
    }
  });
}
