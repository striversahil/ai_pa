// ─────────────────────────────────────────────────────────────────────────────
// routes/product-line.ts — Product Line catalogue + vendor-quote CRUD.
// Writes need the `product-line` scope (or root) — founder decision 2026-11-23:
// whoever maintains vendor rates also owns the catalogue they typecheck against.
// Reads ride the automation data endpoint (/api/automations/product-line/data).
// Mirror: founder-os_backend/src/routes/product-line.ts (Express alt runtime).
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { notifyLive, LiveEvent, type Bindings } from '../context';
import { readBody } from '../http';
import { requireQuoteScope, writeError, adminScopeError } from './product-line-guards';
import { registerProductLineBatchRoutes } from './product-line-batches';

export function registerProductLineRoutes(app: Hono<{ Bindings: Bindings }>): void {
  registerProductLineBatchRoutes(app);

  // ── Product photos (stored in KV file storage, served via /api/chat/files) ──
  const PHOTO_PREFIX = 'product-photo/';
  const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
  app.get('/api/product-line/photos', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
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
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
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
  // ── Rates sheet: one page + COUNT total, every filter applied by D1 ──
  // ?page=&limit=(<=500)&q=&productId=&vendorId=&category=&status=on|off
  // &priceMin&priceMax&netMin&netMax&leadMin&leadMax&from&to&missing=1&sort=
  // &batchId=rb_…&spec=brand:PIX&spec=width_mm:>=1000&spec=material:in:ss,gi
  app.get('/api/product-line/rates', async (c) => {
    try {
      const { listRatesPaged, RATES_PAGE_MAX } = await import('../../automations/product-line/service');
      const { parsePageQuery } = await import('../../shared/paging');
      const q = (k: string) => c.req.query(k);
      const spec = (c.req.queries('spec') ?? []) as string[];
      const page = parsePageQuery(q);
      // The sheet may load up to 500 rows a page (founder decision 2026-11-23);
      // every other list keeps the standard 100 cap from shared/paging.
      const limit = Math.min(RATES_PAGE_MAX, Math.max(1, Math.floor(Number(q('limit')) || page.limit)));
      return c.json(await listRatesPaged({ ...page, limit, offset: (page.page - 1) * limit }, {
        productId: q('productId'),
        vendorId: q('vendorId'),
        category: q('category'),
        batchId: q('batchId'),
        status: q('status'),
        priceMin: q('priceMin'),
        priceMax: q('priceMax'),
        netMin: q('netMin'),
        netMax: q('netMax'),
        leadMin: q('leadMin'),
        leadMax: q('leadMax'),
        from: q('from'),
        to: q('to'),
        missing: q('missing'),
        sort: q('sort'),
        spec: spec.length ? spec : q('spec'),
      }));
    } catch (e: any) {
      return c.json({ error: String(e?.message ?? 'could not load rates').slice(0, 300) }, 500);
    }
  });
  // ── Product detail (identity + guide + counted quote totals). The quotes
  //    themselves page via /api/product-line/rates?productId= (one product
  //    has 2,400+ quotes — never ship them all to the browser). ──
  app.get('/api/product-line/products/:id', async (c) => {
    try {
      const { getProductSummary } = await import('../../automations/product-line/service');
      return c.json(await getProductSummary(c.req.param('id') ?? ''));
    } catch (e: any) {
      return c.json({ error: String(e?.message ?? 'not found').slice(0, 300) }, 404);
    }
  });
  // ── Products ──
  app.post('/api/product-line/products', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { createProduct } = await import('../../automations/product-line/update');
      const row = await createProduct(await readBody(c));
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e); }
  });
  app.patch('/api/product-line/products/:id', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { updateProduct } = await import('../../automations/product-line/update');
      const row = await updateProduct(c.req.param('id') ?? '', await readBody(c));
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(row);
    } catch (e: any) { return writeError(c, e); }
  });
  app.delete('/api/product-line/products/:id', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { deleteProduct } = await import('../../automations/product-line/update');
      const out = await deleteProduct(c.req.param('id') ?? '');
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(out);
    } catch (e: any) { return writeError(c, e); }
  });
  // ── Guide ──
  app.post('/api/product-line/guide', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { createGuide } = await import('../../automations/product-line/update');
      const row = await createGuide(await readBody(c));
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e); }
  });
  app.patch('/api/product-line/guide/:id', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { updateGuide } = await import('../../automations/product-line/update');
      const row = await updateGuide(c.req.param('id') ?? '', await readBody(c));
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(row);
    } catch (e: any) { return writeError(c, e); }
  });
  app.delete('/api/product-line/guide/:id', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { deleteGuide } = await import('../../automations/product-line/update');
      const out = await deleteGuide(c.req.param('id') ?? '');
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(out);
    } catch (e: any) { return writeError(c, e); }
  });
  // ── Catalogue (live, editable) ─────────────────────────────────────────
  // GET /api/product-line/catalog — products + typed specs as they exist in D1.
  // The dashboard edits THIS (not the compiled seed) and the KYP JSON download
  // is generated from it.
  app.get('/api/product-line/catalog', async (c) => {
    try {
      const { getLiveCatalog } = await import('../../automations/product-line/catalog-live');
      return c.json(await getLiveCatalog());
    } catch (e: any) { return writeError(c, e); }
  });
  // GET /api/product-line/schema.json — download the KYP JSON built from D1.
  app.get('/api/product-line/schema.json', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { getLiveCatalog } = await import('../../automations/product-line/catalog-live');
      const { buildKypSchema, schemaFileName } = await import('../../automations/product-line/schema-export');
      const body = JSON.stringify(buildKypSchema(await getLiveCatalog()), null, 2);
      return new Response(body, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${schemaFileName()}"`,
          'cache-control': 'no-store',
        },
      });
    } catch (e: any) { return writeError(c, e); }
  });
  // POST /api/product-line/categories/rename — rename a category everywhere.
  app.post('/api/product-line/categories/rename', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const body = await readBody(c);
      const { renameCategory } = await import('../../automations/product-line/catalog-categories');
      const out = await renameCategory(body?.from, body?.to);
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(out);
    } catch (e: any) { return writeError(c, e); }
  });
  // POST /api/product-line/categories — declare a category ahead of products.
  app.post('/api/product-line/categories', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const body = await readBody(c);
      const { addCategory, deleteCategory } = await import('../../automations/product-line/catalog-categories');
      const out = await addCategory(body?.name);
      const { touched } = await import('../../automations/product-line/write-common');
      await touched();
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(out, 201);
    } catch (e: any) { return writeError(c, e); }
  });
  // DELETE /api/product-line/categories/:name — only while nothing uses it.
  app.delete('/api/product-line/categories/:name', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { deleteCategory } = await import('../../automations/product-line/catalog-categories');
      const out = await deleteCategory(decodeURIComponent(c.req.param('name') ?? ''));
      const { touched } = await import('../../automations/product-line/write-common');
      await touched();
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(out);
    } catch (e: any) { return writeError(c, e); }
  });
  // POST /api/product-line/guide/reorder — spec order for one product.
  app.post('/api/product-line/guide/reorder', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const body = await readBody(c);
      const { reorderGuide } = await import('../../automations/product-line/update');
      const out = await reorderGuide(String(body?.productId ?? ''), body?.ids ?? []);
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(out);
    } catch (e: any) { return writeError(c, e); }
  });
  // GET /api/product-line/prompt — the rate-intake prompt (template + rendered).
  // POST /api/product-line/prompt — save an edit; DELETE — back to the shipped one.
  app.get('/api/product-line/prompt', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { promptForCopy } = await import('../../automations/product-line/prompt');
      return c.json(await promptForCopy());
    } catch (e: any) { return writeError(c, e); }
  });
  app.post('/api/product-line/prompt', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const body = await readBody(c);
      const { saveRatePrompt } = await import('../../automations/product-line/prompt');
      return c.json(await saveRatePrompt(body?.template));
    } catch (e: any) { return writeError(c, e); }
  });
  app.delete('/api/product-line/prompt', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { resetRatePrompt } = await import('../../automations/product-line/prompt');
      return c.json(await resetRatePrompt());
    } catch (e: any) { return writeError(c, e); }
  });
  // GET /api/product-line/rates/:id — one quote + its product's spec contract.
  app.get('/api/product-line/rates/:id', async (c) => {
    try {
      const { getRateDetail } = await import('../../automations/product-line/service');
      return c.json(await getRateDetail(c.req.param('id') ?? ''));
    } catch (e: any) { return c.json({ error: String((e as any)?.message ?? 'rate not found').slice(0, 300) }, 404); }
  });

  // ── Vendors ──
  app.post('/api/product-line/vendors', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { createVendor } = await import('../../automations/product-line/update');
      const row = await createVendor(await readBody(c));
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e); }
  });
  app.patch('/api/product-line/vendors/:id', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { updateVendor } = await import('../../automations/product-line/update');
      const row = await updateVendor(c.req.param('id') ?? '', await readBody(c));
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(row);
    } catch (e: any) { return writeError(c, e); }
  });
  app.delete('/api/product-line/vendors/:id', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { deleteVendor } = await import('../../automations/product-line/update');
      const out = await deleteVendor(c.req.param('id') ?? '');
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(out);
    } catch (e: any) { return writeError(c, e); }
  });
  // ── Rates (holders of the `product-line` scope + root) ──
  app.post('/api/product-line/rates', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { createRate } = await import('../../automations/product-line/update');
      const row = await createRate(await readBody(c));
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e); }
  });
  app.patch('/api/product-line/rates/:id', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const body = await readBody(c);
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
  // Hard delete: the quote row is gone completely.
  app.delete('/api/product-line/rates/:id', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { deleteRate } = await import('../../automations/product-line/update');
      const out = await deleteRate(c.req.param('id') ?? '');
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(out);
    } catch (e: any) { return writeError(c, e); }
  });
}
