// ─────────────────────────────────────────────────────────────────────────────
// routes/stock.ts — Stock automation API (auto-SKU inventory). Worker-only.
// Reads ride the automation data endpoint; writes are `stock`-scoped (root bypasses).
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { adminScopeError, notifyLive, LiveEvent, type Bindings } from '../context';
import { AuthError } from '../../modules/auth/types';
import { getViewerMe } from '../viewer';
import { readBody } from '../http';

async function requireStockScope(c: any): Promise<void> {
  const me = await getViewerMe(c);
  if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
  if (me.isAdmin) return;
  const scopes = (me as any).scopes ?? [];
  if (!scopes.includes('stock')) {
    throw new AuthError('FORBIDDEN', "Requires 'stock' permission", 403);
  }
}

function writeError(c: any, e: any) {
  const msg = String(e?.message ?? 'write failed');
  if (/already exists/i.test(msg)) return c.json({ error: msg.slice(0, 300) }, 409);
  if (/not found/i.test(msg)) return c.json({ error: msg.slice(0, 300) }, 404);
  if (/required|must be|YYYY-MM-DD|different locations/i.test(msg)) return c.json({ error: msg.slice(0, 300) }, 400);
  return c.json({ error: msg.slice(0, 300) }, 400);
}

export function registerStockRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.post('/api/stock/items', async (c) => {
    try { await requireStockScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { createStockItem } = await import('../../automations/stock/update');
      const row = await createStockItem(await readBody(c));
      notifyLive(c, { type: LiveEvent.Stock });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e); }
  });
  app.patch('/api/stock/items/:id', async (c) => {
    try { await requireStockScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { updateStockItem } = await import('../../automations/stock/update');
      const row = await updateStockItem(c.req.param('id') ?? '', await readBody(c));
      notifyLive(c, { type: LiveEvent.Stock });
      return c.json(row);
    } catch (e: any) { return writeError(c, e); }
  });
  app.post('/api/stock/movements', async (c) => {
    try { await requireStockScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const me = await getViewerMe(c);
      const { postStockMovement } = await import('../../automations/stock/update');
      const actor = (me as any)?.user?.name ?? (me as any)?.user?.email ?? '';
      const row = await postStockMovement(await readBody(c), actor);
      notifyLive(c, { type: LiveEvent.Stock });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e); }
  });
  app.post('/api/stock/movements/:id/approve', async (c) => {
    try { await requireStockScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { approveMovement } = await import('../../automations/stock/update');
      const row = await approveMovement(c.req.param('id') ?? '');
      notifyLive(c, { type: LiveEvent.Stock });
      return c.json(row);
    } catch (e: any) { return writeError(c, e); }
  });
  app.post('/api/stock/locations', async (c) => {
    try { await requireStockScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { createLocation } = await import('../../automations/stock/update');
      const row = await createLocation(String((await readBody(c))?.name ?? ''));
      notifyLive(c, { type: LiveEvent.Stock });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e); }
  });
  app.post('/api/stock/reserve', async (c) => {
    try { await requireStockScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const me = await getViewerMe(c);
      const { reserveStock } = await import('../../automations/stock/update');
      const actor = (me as any)?.user?.name ?? (me as any)?.user?.email ?? '';
      const row = await reserveStock(await readBody(c), actor);
      notifyLive(c, { type: LiveEvent.Stock });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e); }
  });
  app.post('/api/stock/reserve/:id/:mode', async (c) => {
    try { await requireStockScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { releaseReservation } = await import('../../automations/stock/update');
      const mode = c.req.param('mode') === 'consumed' ? 'consumed' : 'released';
      const row = await releaseReservation(c.req.param('id') ?? '', mode as any);
      notifyLive(c, { type: LiveEvent.Stock });
      return c.json(row);
    } catch (e: any) { return writeError(c, e); }
  });
  app.post('/api/stock/backfill', async (c) => {
    try { await requireStockScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const me = await getViewerMe(c);
      const { backfillStockFromPayload } = await import('../../automations/stock/update');
      const actor = (me as any)?.user?.name ?? (me as any)?.user?.email ?? '';
      const row = await backfillStockFromPayload(await c.req.json().catch(() => ({ items: [] })), actor);
      notifyLive(c, { type: LiveEvent.Stock });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e); }
  });
}
