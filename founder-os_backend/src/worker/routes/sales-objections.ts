// ─────────────────────────────────────────────────────────────────────────────
// routes/sales-objections.ts — Sales Objections API (Sales → Objections tab).
// Worker-only (Express is frozen — no Express mirror).
//
// Reads + filing: any telecalling-scoped session (shared sales surface —
// every agent sees every objection). Replies + resolve/reopen: sales-head /
// sales-head / root only (requireSalesManager, same gate as the roster writes).
// Free-text estimate number / client name by design (v1, no real estimate
// link); at least one of the two is required.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { isApproved, notifyLive, adminGuard, type Bindings } from '../context';
import { ScopeKeys } from '../../modules/auth/types';
import { addReply, createObjection, getObjection, listObjections, setObjectionStatus } from '../../modules/sales-objections/store';
import { cleanObjectionInput } from '../../modules/sales-objections/types';
import { requireViewer } from '../viewer';
import { readBody } from '../http';

async function viewer(c: any): Promise<any | null> {
  const me: any = await requireViewer(c).catch(() => null);
  if (!me || !isApproved(me)) return null;
  if (me.isAdmin || me.isRoot) return me;
  const scopes: string[] = ((me.scopes ?? []) as string[]).map((s) => String(s).toLowerCase());
  if (scopes.includes(ScopeKeys.SalesHead) || scopes.includes(ScopeKeys.Telecalling) || scopes.includes(ScopeKeys.Sales)) return me;
  return null;
}

/** Manager gate for replies + resolve/reopen (sales-head / root). */
async function requireSalesManager(c: any): Promise<boolean> {
  if ((await adminGuard(c)) === null) return true;
  const me: any = await requireViewer(c).catch(() => null);
  if (!me) return false;
  if (!isApproved(me)) return false;
  const scopes: string[] = me.scopes ?? [];
  const roles: string[] = me.roles ?? [];
  return scopes.includes(ScopeKeys.SalesHead) || roles.includes('sales-head') || !!me.isAdmin;
}

function actorOf(me: any): { id: string; name: string } {
  return {
    id: String(me?.user?.id ?? me?.id ?? ''),
    name: String(me?.user?.name ?? me?.user?.email ?? ''),
  };
}

export function registerSalesObjectionsRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/sales-objections', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const rows = await listObjections(c.env.DB, {
      status: c.req.query('status'),
      category: c.req.query('category'),
      q: c.req.query('q'),
    }).catch((e: any) => ({ error: String(e?.message ?? e) }));
    if ((rows as any)?.error) return c.json({ error: (rows as any).error }, 500);
    return c.json({ objections: rows });
  });

  app.post('/api/sales-objections', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    const body = await readBody(c);
    const parsed = cleanObjectionInput(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const actor = actorOf(me);
    const row = await createObjection(c.env.DB, {
      ...parsed.value,
      createdBy: actor.id,
      createdByName: actor.name,
    });
    notifyLive(c, { type: 'sales-objections' as any, action: 'created', id: (row as any)?.id });
    return c.json({ ok: true, objection: row }, 201);
  });

  app.post('/api/sales-objections/:id/replies', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    if (!(await requireSalesManager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    const body = await readBody(c);
    const text = String(body?.text ?? '').trim().slice(0, 2000);
    if (!text) return c.json({ error: 'reply text required' }, 400);
    const actor = actorOf(me);
    const row = await addReply(c.env.DB, {
      objectionId: c.req.param('id') ?? '',
      text,
      createdBy: actor.id,
      createdByName: actor.name,
    });
    if (!row) return c.json({ error: 'objection not found' }, 404);
    notifyLive(c, { type: 'sales-objections' as any, action: 'replied', id: c.req.param('id') });
    return c.json({ ok: true, objection: row }, 201);
  });

  app.patch('/api/sales-objections/:id', async (c) => {
    const me = await viewer(c);
    if (!me) return c.json({ error: 'authentication required' }, 401);
    if (!(await requireSalesManager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    const body = await readBody(c);
    const status = String(body?.status ?? '').trim();
    if (status !== 'open' && status !== 'resolved') return c.json({ error: 'status must be open|resolved' }, 400);
    const row = await setObjectionStatus(c.env.DB, c.req.param('id') ?? '', status);
    if (!row) return c.json({ error: 'objection not found' }, 404);
    // Keep the single-row read authoritative for the drawer.
    const full = await getObjection(c.env.DB, c.req.param('id') ?? '');
    notifyLive(c, { type: 'sales-objections' as any, action: status, id: c.req.param('id') });
    return c.json({ ok: true, objection: full ?? row });
  });
}
