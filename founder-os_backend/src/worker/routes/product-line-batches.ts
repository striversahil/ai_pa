// ─────────────────────────────────────────────────────────────────────────────
// routes/product-line-batches.ts — the bulk-paste surfaces:
//   · preview (resolve + typecheck, writes nothing)
//   · import  (land under ONE RateBatch, with the operator's vendor decisions)
//   · the batch log itself (list / one batch + its quotes / undo the paste)
// Registered from product-line.ts so worker.ts keeps one registration line.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { notifyLive, LiveEvent, type Bindings } from '../context';
import { requireViewer } from '../viewer';
import { requireQuoteScope, writeError, adminScopeError } from './product-line-guards';

export function registerProductLineBatchRoutes(app: Hono<{ Bindings: Bindings }>): void {
  /** Body is either `{json:"<fenced block>"}`, a bare payload, or text/plain. */
  const importBody = async (c: any) => {
    const raw = await c.req.text();
    let body: any = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = { json: raw };
    }
    const { extractJsonPayload } = await import('../../automations/product-line/rate-import');
    return { body, payload: typeof body?.json === 'string' ? extractJsonPayload(body.json) : (body?.payload ?? body) };
  };

  // POST /api/product-line/rates/import/preview — resolve + typecheck, no writes.
  app.post('/api/product-line/rates/import/preview', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { payload } = await importBody(c);
      const { previewImport } = await import('../../automations/product-line/rate-import');
      return c.json(await previewImport(payload));
    } catch (e: any) { return writeError(c, e); }
  });

  // POST /api/product-line/rates/import — land it under one RateBatch.
  // Body: { json | payload, vendors: [{ name, action: create|map|skip, …fields }], label }
  app.post('/api/product-line/rates/import', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { payload, body } = await importBody(c);
      const me = await requireViewer(c);
      const { importRates } = await import('../../automations/product-line/rate-import');
      const out = await importRates(payload, {
        vendors: Array.isArray(body?.vendors) ? body.vendors : [],
        label: body?.label,
        actor: {
          id: (me as any)?.user?.id ?? null,
          name: (me as any)?.user?.displayName || (me as any)?.user?.name || (me as any)?.user?.email || null,
        },
      });
      if (out.created) notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(out);
    } catch (e: any) { return writeError(c, e); }
  });

  // GET /api/product-line/batches — the paste log, newest first.
  app.get('/api/product-line/batches', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { listBatches } = await import('../../automations/product-line/rate-batch');
      return c.json({ batches: await listBatches(Number(c.req.query('limit')) || 100) });
    } catch (e: any) { return writeError(c, e); }
  });

  // GET /api/product-line/batches/:id — one batch + the quotes it created.
  app.get('/api/product-line/batches/:id', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { getBatch, batchRates } = await import('../../automations/product-line/rate-batch');
      const id = c.req.param('id') ?? '';
      const batch = await getBatch(id);
      if (!batch) return c.json({ error: 'batch not found' }, 404);
      return c.json({ batch, rates: await batchRates(id) });
    } catch (e: any) { return writeError(c, e); }
  });

  // DELETE /api/product-line/batches/:id — undo the paste (quotes go, log stays).
  app.delete('/api/product-line/batches/:id', async (c) => {
    try { await requireQuoteScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const { deleteBatch } = await import('../../automations/product-line/rate-batch');
      const out = await deleteBatch(c.req.param('id') ?? '');
      notifyLive(c, { type: LiveEvent.ProductLine });
      return c.json(out);
    } catch (e: any) { return writeError(c, e); }
  });
}
