// ─────────────────────────────────────────────────────────────────────────────
// routes/crm-cash.ts — dispatch cash ledger, on the CRM dispatch floor.
//
// Moved here from /api/accounts/cash (2026-11-26): the floor spends the cash,
// so the floor books it. The ledger core is unchanged
// (modules/automations/accounts/cash.ts) — only the address and the gate moved.
//
// Patrons: root/admin, `crm` (the desk), `dispatch` (the floor) and `accounts`
// (bookkeeping still reconciles the ledger). Add, correct and void are all floor
// operations now: an entry typed on a busy morning must be fixable by the person
// who typed it, and no other screen offers the ledger any more.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { notifyLive, LiveEvent, type Bindings } from '../context';
import { ScopeKeys } from '../../modules/auth/types';
import {
  listCashEntries, createCashEntry, updateCashEntry, deleteCashEntry,
} from '../../automations/accounts/cash';
import { getViewerMe } from '../viewer';
import { readBody, writeError } from '../http';

const CASH_SCOPES: string[] = [ScopeKeys.Accounts, ScopeKeys.Crm, ScopeKeys.Dispatch];

/** Read AND write: the floor owns the ledger, accounts reconciles it. */
async function requireCash(c: any): Promise<any | Response> {
  const me = (await getViewerMe(c).catch(() => null)) as any;
  if (!me) return c.json({ error: 'Authentication required' }, 401);
  const scopes = (Array.isArray(me.scopes) ? me.scopes : []).map((s: any) => String(s).toLowerCase());
  if (me.isAdmin) return me;
  if (CASH_SCOPES.some((s) => scopes.includes(s))) return me;
  return c.json({ error: 'Dispatch cash needs the dispatch floor (crm or dispatch scope) or accounts.' }, 403);
}

export function registerCrmCashRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Ledger (newest first, running balance recomputed server-side) ──
  app.get('/api/crm/cash', async (c) => {
    const me = await requireCash(c);
    if (me instanceof Response) return me;
    try {
      const { entries, summary } = await listCashEntries(1000);
      return c.json({ entries, summary });
    } catch (e: any) { return writeError(c, e, 'load failed'); }
  });

  app.post('/api/crm/cash', async (c) => {
    const me = await requireCash(c);
    if (me instanceof Response) return me;
    const body = await readBody(c);
    try {
      const row = await createCashEntry(body || {}, me?.user?.name ?? me?.user?.email ?? null);
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e, 'create failed'); }
  });

  app.patch('/api/crm/cash/:id', async (c) => {
    const me = await requireCash(c);
    if (me instanceof Response) return me;
    const body = await readBody(c);
    try {
      const row = await updateCashEntry(c.req.param('id'), body || {});
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row);
    } catch (e: any) { return writeError(c, e, 'update failed'); }
  });

  app.delete('/api/crm/cash/:id', async (c) => {
    const me = await requireCash(c);
    if (me instanceof Response) return me;
    try {
      await deleteCashEntry(c.req.param('id'));
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json({ ok: true });
    } catch (e: any) { return writeError(c, e, 'delete failed'); }
  });
}
