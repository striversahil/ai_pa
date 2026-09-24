// ─────────────────────────────────────────────────────────────────────────────
// routes/product-line.ts — Product Line master CRUD (MIS-gated writes).
// Reads ride the automation data endpoint (/api/automations/product-line/data).
// Mirror: founder-os_backend/src/routes/product-line.ts (Express alt runtime).
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { requireMisScope, misScopeError, notifyLive, LiveEvent, authStore, getMe, readSessionCookie, type Bindings } from '../context';
import { AuthError } from '../../modules/auth/types';

/** Quote writes: whoever holds the `product-line` scope (granted from the
 *  Admin panel), plus MIS/admin. Products/guide/vendors stay MIS-only. */
async function requireQuoteScope(c: any): Promise<void> {
  const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
  if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
  if (me.isAdmin) return;
  const scopes = (me as any).scopes ?? [];
  if (!scopes.includes('product-line') && !scopes.includes('mis')) {
    throw new AuthError('FORBIDDEN', "Requires 'product-line' permission", 403);
  }
}

function writeError(c: any, e: any) {
  const msg = String(e?.message ?? 'write failed');
  if (/already exists/i.test(msg)) return c.json({ error: msg.slice(0, 300) }, 409);
  // Map raw D1 errors to field messages — the UI must never see internals.
  const nn = msg.match(/NOT NULL constraint failed:\s*[\w"]+\.([\w"]+)/i);
  if (nn) return c.json({ error: `${nn[1]} is required` }, 400);
  const uq = msg.match(/UNIQUE constraint failed:\s*[\w"]+\.([\w"]+)/i);
  if (uq) return c.json({ error: `this ${uq[1]} already exists` }, 409);
  if (/no such table|no such column/i.test(msg)) return c.json({ error: 'database not ready — try again in a minute' }, 503);
  return c.json({ error: 'could not save — check the fields and retry' }, 400);
}

export function registerProductLineRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Product photos (stored in KV file storage, served via /api/chat/files) ──
  const PHOTO_PREFIX = 'product-photo/';
  const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
  app.get('/api/product-line/photos', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    try {
      const list = await (c.env.CHAT_FILES as any).list({ prefix: PHOTO_PREFIX, limit: 100 });
      const photos = ((list as any)?.keys ?? []).map((k: any) => ({
        key: String(k.name),
        url: `/api/chat/files/${String(k.name)}`,
      }));
      return c.json({ photos });
    } catch (e: any) {
      return c.json({ error: 'could not list photos' }, 500);
    }
  });
  app.post('/api/product-line/photos', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: 'Expected multipart/form-data with a photo file' }, 400);
    }
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'photo file required' }, 400);
    if (!String(file.type || '').startsWith('image/')) return c.json({ error: 'only image files allowed' }, 400);
    if (file.size > PHOTO_MAX_BYTES) return c.json({ error: 'photo too large (max 5MB)' }, 413);
    const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const key = `${PHOTO_PREFIX}${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
    await c.env.CHAT_FILES.put(key, await file.arrayBuffer(), {
      metadata: { name: file.name, type: file.type || 'application/octet-stream' },
    });
    return c.json({ key, url: `/api/chat/files/${key}`, name: file.name }, 201);
  });
  // ── Product detail (full identity + guide + every vendor rate w/ specs) ──
  app.get('/api/product-line/products/:id', async (c) => {
    try {
      const { getProductDetail } = await import('../../automations/product-line/service');
      return c.json(await getProductDetail(c.req.param('id') ?? ''));
    } catch (e: any) {
      return c.json({ error: String(e?.message ?? 'not found').slice(0, 300) }, 404);
    }
  });
  // ── Products ──
  app.post('/api/product-line/products', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    try {
      const { createProduct } = await import('../../automations/product-line/update');
      const row = await createProduct(await c.req.json().catch(() => ({})));
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e); }
  });
  app.patch('/api/product-line/products/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    try {
      const { updateProduct } = await import('../../automations/product-line/update');
      const row = await updateProduct(c.req.param('id') ?? '', await c.req.json().catch(() => ({})));
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(row);
    } catch (e: any) { return writeError(c, e); }
  });
  app.delete('/api/product-line/products/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    try {
      const { deleteProduct } = await import('../../automations/product-line/update');
      const out = await deleteProduct(c.req.param('id') ?? '');
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(out);
    } catch (e: any) { return writeError(c, e); }
  });
  // ── Guide ──
  app.post('/api/product-line/guide', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    try {
      const { createGuide } = await import('../../automations/product-line/update');
      const row = await createGuide(await c.req.json().catch(() => ({})));
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e); }
  });
  app.patch('/api/product-line/guide/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    try {
      const { updateGuide } = await import('../../automations/product-line/update');
      const row = await updateGuide(c.req.param('id') ?? '', await c.req.json().catch(() => ({})));
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(row);
    } catch (e: any) { return writeError(c, e); }
  });
  app.delete('/api/product-line/guide/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    try {
      const { deleteGuide } = await import('../../automations/product-line/update');
      const out = await deleteGuide(c.req.param('id') ?? '');
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(out);
    } catch (e: any) { return writeError(c, e); }
  });
  // ── Vendors ──
  app.post('/api/product-line/vendors', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    try {
      const { createVendor } = await import('../../automations/product-line/update');
      const row = await createVendor(await c.req.json().catch(() => ({})));
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e); }
  });
  app.patch('/api/product-line/vendors/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    try {
      const { updateVendor } = await import('../../automations/product-line/update');
      const row = await updateVendor(c.req.param('id') ?? '', await c.req.json().catch(() => ({})));
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(row);
    } catch (e: any) { return writeError(c, e); }
  });
  app.delete('/api/product-line/vendors/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    try {
      const { deleteVendor } = await import('../../automations/product-line/update');
      const out = await deleteVendor(c.req.param('id') ?? '');
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(out);
    } catch (e: any) { return writeError(c, e); }
  });
  // ── Rates (holders of the `product-line` scope + MIS/admin) ──
  app.post('/api/product-line/rates', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return misScopeError(c, e); }
    try {
      const { createRate } = await import('../../automations/product-line/update');
      const row = await createRate(await c.req.json().catch(() => ({})));
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e); }
  });
  app.patch('/api/product-line/rates/:id', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return misScopeError(c, e); }
    try {
      const body = await c.req.json().catch(() => ({}));
      if ((body as any)?.active !== undefined && Object.keys(body as any).length === 1) {
        const { setRateActive } = await import('../../automations/product-line/update');
        const out = await setRateActive(c.req.param('id') ?? '', (body as any).active !== false);
        notifyLive(c, { type: LiveEvent.ProductLine });
        return c.json(out);
      }
      const { updateRate } = await import('../../automations/product-line/update');
      const row = await updateRate(c.req.param('id') ?? '', body);
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(row);
    } catch (e: any) { return writeError(c, e); }
  });
}
