// ─────────────────────────────────────────────────────────────────────────────
// routes/bulk-import.ts — vendor price-list bulk import (ROOT-only for now).
// Thin orchestrator: parse input → root check → store/match calls → live
// broadcast. Heavy AI batch steps (match misses, spec extract) arrive in
// match-rows.ts Phase 3; file (xlsx/pdf/photo) parsing via the GH runner.
// Mirror: founder-os_backend/src/routes/bulk-import.ts (Express alt runtime).
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { notifyLive, authStore, getMe, readSessionCookie, requireSecret, type Bindings } from '../context';
import { AuthError } from '../../modules/auth/types';
import { ROOT_EMAIL } from '../../modules/auth/types';

/** Root-only gate (founder decision: bulk import stays root until v2). */
async function requireRoot(c: any): Promise<void> {
  const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
  if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
  const email = String((me as any)?.user?.email ?? '').toLowerCase();
  if ((me as any)?.isRoot !== true && email !== ROOT_EMAIL.toLowerCase()) {
    throw new AuthError('FORBIDDEN', 'Bulk import is root-only for now', 403);
  }
}

function rootError(c: any, e: any) {
  if (e instanceof AuthError) return c.json({ error: e.message }, (e as any).status ?? 403);
  return c.json({ error: String(e?.message ?? 'request failed').slice(0, 300) }, 400);
}

export function registerBulkImportRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Create batch from pasted/CSV text (Step 0 + Step 1 run inline) ──
  app.post('/api/bulk-import/batches', async (c) => {
    try { await requireRoot(c); } catch (e) { return rootError(c, e); }
    let body: any = {};
    try { body = await c.req.json(); } catch { return c.json({ error: 'JSON body required' }, 400); }
    const text = String(body?.text ?? '');
    if (!text.trim()) return c.json({ error: 'text required (paste rows or CSV)' }, 400);
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null)).catch(() => null);
    const who = String((me as any)?.user?.email ?? 'root').toLowerCase();
    const { createBatch, insertRows, getBatchRows, refreshCounts } = await import('../../automations/bulk-import/store');
    const { splitLines, splitCsvRow, csvLine } = await import('../../automations/bulk-import/parse');
    const kind = String(body?.sourceKind ?? 'paste');
    const sourceKind = (kind === 'csv' ? 'csv' : 'paste') as 'paste' | 'csv';
    const rawLines = sourceKind === 'csv'
      ? String(text).split(/\r?\n/).map((l) => csvLine(splitCsvRow(l)))
      : [text];
    const batch = await createBatch({
      vendorId: body?.vendorId ? String(body.vendorId) : null,
      sourceKind,
      sourceName: String(body?.sourceName ?? 'pasted list').slice(0, 300),
      sourceText: text.slice(0, 200_000),
      quotedAt: body?.quotedAt ? String(body.quotedAt) : undefined,
      createdBy: who,
    });
    // Raw capture ONLY — no regex, no deterministic match, no duplicate
    // flags. Rows land as `unprocessed`; the Bulk chat AI does every step
    // after this (founder decision: zero auto-processing).
    const parsed = splitLines(rawLines.join('\n'), 2000);
    const quotedIso = batch.quotedAt;
    const vendorId = batch.vendorId;
    let vendorName: string | null = null;
    if (vendorId) {
      try {
        const { prisma } = await import('../../shared/prisma');
        const v = await (prisma as any).vendor.findUnique({ where: { id: vendorId } }).catch(() => null);
        if (v) vendorName = String((v as any).name ?? '');
      } catch { /* best-effort */ }
    }
    const inserted = await insertRows(batch.id, parsed.map((p, i) => ({
      rowNo: i + 1, rawText: p.rawText, rawHash: p.rawHash,
      price: null, unit: null,
      vendorId, vendorName, quotedAt: quotedIso,
    })));
    await refreshCounts(batch.id).catch(() => {});
    notifyLive(c, { type: 'data-changed' });
    return c.json({ ok: true, batchId: batch.id, inserted, unprocessed: inserted }, 201);
  });

  // ── List batches ──
  app.get('/api/bulk-import/batches', async (c) => {
    try { await requireRoot(c); } catch (e) { return rootError(c, e); }
    const { listBatches } = await import('../../automations/bulk-import/store');
    return c.json({ batches: await listBatches(50) });
  });

  // ── Batch detail + rows (?status=needs-product etc.) ──
  app.get('/api/bulk-import/batches/:id', async (c) => {
    try { await requireRoot(c); } catch (e) { return rootError(c, e); }
    const { getBatch, getBatchRows } = await import('../../automations/bulk-import/store');
    const batch = await getBatch(c.req.param('id') ?? '');
    if (!batch) return c.json({ error: 'batch not found' }, 404);
    const rows = await getBatchRows(batch.id, c.req.query('status') || undefined, 2000);
    return c.json({ batch, rows });
  });

  // ── Single staged-row edit (dashboard inline corrections) ──
  app.patch('/api/bulk-import/rows/:id', async (c) => {
    try { await requireRoot(c); } catch (e) { return rootError(c, e); }
    let body: any = {};
    try { body = await c.req.json(); } catch { return c.json({ error: 'JSON body required' }, 400); }
    const { updateRow } = await import('../../automations/bulk-import/store');
    const { finalizeRow } = await import('../../automations/bulk-import/match-rows');
    const allowed = ['productId', 'productName', 'isNewProduct', 'newCategory', 'vendorId', 'vendorName', 'price', 'unit', 'discount', 'moq', 'deliveryDays', 'weightPerUnit', 'packageQty', 'packageDims', 'quotedAt', 'specs', 'status'];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (body?.[k] !== undefined) patch[k] = body[k];
    const row = await updateRow(c.req.param('id') ?? '', patch);
    if (!row) return c.json({ error: 'row not found' }, 404);
    // Recompute missing + status after any edit so flags stay truthful
    // (a specs PATCH that fills the last gap flips needs-specs → ready).
    const final = (body?.status === undefined)
      ? (await finalizeRow(row.id).catch(() => row) ?? row)
      : row;
    notifyLive(c, { type: 'data-changed' });
    return c.json({ ok: true, row: final });
  });

  // ── File upload (xlsx/csv/pdf/image → KV, batch status parsing) ──
  // Heavy parsing runs in the GH bulk-parse runner (dispatched below).
  app.post('/api/bulk-import/upload', async (c) => {
    try { await requireRoot(c); } catch (e) { return rootError(c, e); }
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    let form: FormData;
    try { form = await c.req.formData(); } catch {
      return c.json({ error: 'Expected multipart/form-data with a file field' }, 400);
    }
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'file required (.xlsx .csv .pdf .png .jpg)' }, 400);
    const name = String(file.name || 'pricelist');
    const ext = (name.split('.').pop() || '').toLowerCase();
    const ok = ['xlsx', 'xls', 'csv', 'pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext);
    if (!ok) return c.json({ error: 'only .xlsx .csv .pdf .png .jpg accepted' }, 400);
    if (file.size > 15 * 1024 * 1024) return c.json({ error: 'file too large (max 15MB)' }, 413);
    if (file.size === 0) return c.json({ error: 'empty file' }, 400);
    const sourceKind = ext === 'csv' ? 'csv' : ext === 'pdf' ? 'pdf'
      : (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') ? 'image' : 'xlsx';
    const key = `bulk-import/${crypto.randomUUID()}.${ext}`;
    await c.env.CHAT_FILES.put(key, await file.arrayBuffer(), {
      metadata: { name, type: file.type || 'application/octet-stream' },
    });
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null)).catch(() => null);
    const who = String((me as any)?.user?.email ?? 'root').toLowerCase();
    const { createBatch, setBatchStatus } = await import('../../automations/bulk-import/store');
    const batch = await createBatch({
      vendorId: String(form.get('vendorId') ?? '') || null,
      sourceKind,
      sourceName: name.slice(0, 300),
      sourceFileKey: key,
      quotedAt: String(form.get('quotedAt') ?? '') || undefined,
      createdBy: who,
    });
    await setBatchStatus(batch.id, 'parsing');
    // Fire the GH parse runner (best-effort; the 15-min cron also sweeps
    // stuck parsing batches — see ops-bulk-parse.yml).
    try {
      const token = String((c.env as any).GITHUB_ACCESS_TOKEN ?? '');
      if (token) {
        const { dispatchGitHubWorkflow } = await import('../cron');
        c.executionCtx?.waitUntil?.(dispatchGitHubWorkflow('ops-bulk-parse.yml', token, { batch_id: batch.id }));
      }
    } catch { /* runner also sweeps on schedule */ }
    notifyLive(c, { type: 'data-changed' });
    return c.json({ ok: true, batchId: batch.id, sourceKind }, 201);
  });

  // ── Runner endpoints (SHARED_SECRET) for scripts/bulk-parse-runner.js ──
  app.get('/api/runner/bulk-import/pending', async (c) => {
    if (!requireSecret(c)) return c.json({ error: 'forbidden' }, 403);
    const { prisma } = await import('../../shared/prisma');
    const rows = await (prisma as any).bulkBatch.findMany({
      where: { status: 'parsing' }, orderBy: [{ createdAt: 'asc' }], take: 5,
    }).catch(() => []);
    return c.json({
      batches: ((rows as any[]) ?? []).map((b: any) => ({
        id: String(b.id), vendorId: b.vendorId != null ? String(b.vendorId) : null,
        sourceKind: String(b.sourceKind ?? 'xlsx'), sourceName: String(b.sourceName ?? ''),
        sourceFileKey: b.sourceFileKey != null ? String(b.sourceFileKey) : null,
        quotedAt: b.quotedAt != null ? new Date(b.quotedAt).toISOString() : new Date().toISOString(),
      })),
    });
  });

  app.get('/api/runner/bulk-import/file/:id', async (c) => {
    if (!requireSecret(c)) return c.json({ error: 'forbidden' }, 403);
    if (!c.env.CHAT_FILES) return c.json({ error: 'no file storage' }, 501);
    const { getBatch } = await import('../../automations/bulk-import/store');
    const batch = await getBatch(c.req.param('id') ?? '');
    if (!batch?.sourceFileKey) return c.json({ error: 'no source file' }, 404);
    const buf = await (c.env.CHAT_FILES as any).get(batch.sourceFileKey, 'arrayBuffer').catch(() => null);
    if (!buf) return c.json({ error: 'file not found' }, 404);
    const b64 = Buffer.from(buf).toString('base64');
    return c.json({ base64: b64, name: batch.sourceName, sourceKind: batch.sourceKind });
  });

  app.post('/api/runner/bulk-import/rows', async (c) => {
    if (!requireSecret(c)) return c.json({ error: 'forbidden' }, 403);
    let body: any = {};
    try { body = await c.req.json(); } catch { return c.json({ error: 'JSON required' }, 400); }
    const batchId = String(body?.batchId ?? '');
    if (!batchId) return c.json({ error: 'batchId required' }, 400);
    const { getBatch, insertRows, setBatchStatus, refreshCounts } = await import('../../automations/bulk-import/store');
    const batch = await getBatch(batchId);
    if (!batch) return c.json({ error: 'batch not found' }, 404);
    const lines = Array.isArray(body?.lines) ? body.lines : [];
    const { hashLine } = await import('../../automations/bulk-import/parse');
    const startNo = batch.rowCount;
    // Raw capture ONLY (same as paste): file rows land unprocessed; the
    // Bulk chat AI does all matching/extraction afterwards.
    const prepared = lines.slice(0, 2000).map((l: any, i: number) => {
      const rawText = String(l?.rawText ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
      return {
        rowNo: startNo + i + 1,
        rawText,
        rawHash: hashLine(rawText),
        price: null,
        unit: null,
        vendorId: batch.vendorId,
        quotedAt: batch.quotedAt,
      };
    }).filter((l: any) => l.rawText.length >= 2);
    const inserted = await insertRows(batchId, prepared);
    if (body?.done === true) await setBatchStatus(batchId, 'review');
    await refreshCounts(batchId).catch(() => {});
    notifyLive(c, { type: 'data-changed' });
    return c.json({ ok: true, inserted });
  });

  // ── Runner: slim catalogue snapshot (names only — never rates/specs) ──
  app.get('/api/runner/bulk-import/index', async (c) => {
    if (!requireSecret(c)) return c.json({ error: 'forbidden' }, 403);
    const { getProductIndex, getVendorIndex } = await import('../../automations/product-line/service');
    const [products, vendors] = await Promise.all([
      getProductIndex().catch(() => []),
      getVendorIndex().catch(() => []),
    ]);
    const cats = [...new Set((products ?? []).map((p: any) => String(p.category ?? '').trim()).filter(Boolean))].sort();
    return c.json({
      products: (products ?? []).filter((p: any) => p?.active !== false).map((p: any) => ({
        id: String(p.id), name: String(p.name ?? ''), category: String(p.category ?? ''),
        aliases: Array.isArray(p.aliases) ? p.aliases.map(String).slice(0, 10) : [],
      })),
      vendors: (vendors ?? []).filter((v: any) => v?.active !== false).map((v: any) => ({
        id: String(v.id), name: String(v.name ?? ''),
      })),
      categories: cats,
    });
  });

  // ── Runner: oldest batch with unfinished rows + loose candidates ──
  app.get('/api/runner/bulk-import/work', async (c) => {
    if (!requireSecret(c)) return c.json({ error: 'forbidden' }, 403);
    const batchId = String(c.req.query('batch_id') ?? '');
    const { prisma } = await import('../../shared/prisma');
    let batch: any = null;
    if (batchId) {
      batch = await (prisma as any).bulkBatch.findUnique({ where: { id: batchId } }).catch(() => null);
    } else {
      const open = await (prisma as any).bulkRow.findMany({
        where: { status: { in: ['needs-product', 'needs-specs'] } },
        select: { batchId: true }, take: 1, orderBy: [{ rowNo: 'asc' }],
      }).catch(() => []);
      if (open?.length) batch = await (prisma as any).bulkBatch.findUnique({ where: { id: String(open[0].batchId) } }).catch(() => null);
    }
    if (!batch || String((batch as any).status) === 'committed') return c.json({ batch: null, rows: [] });
    const { getBatchRows } = await import('../../automations/bulk-import/store');
    const { getProductIndex } = await import('../../automations/product-line/service');
    const { rankProducts } = await import('../../automations/product-line/match');
    const rows = (await getBatchRows(String((batch as any).id), undefined, 2000))
      .filter((r) => r.status === 'needs-product' || r.status === 'needs-specs')
      .slice(0, 150);
    const index = await getProductIndex().catch(() => []);
    const products = (index ?? []).map((p: any) => ({
      id: String(p.id), category: String(p.category ?? ''), name: String(p.name ?? ''),
      aliases: Array.isArray(p.aliases) ? p.aliases : [], active: p.active !== false,
    }));
    const withCands = rows.map((r) => ({
      id: r.id, rowNo: r.rowNo, rawText: r.rawText,
      productId: r.productId, productName: r.productName, isNewProduct: r.isNewProduct,
      vendorId: r.vendorId, vendorName: r.vendorName,
      price: r.price, unit: r.unit, specs: r.specs, missing: r.missing, status: r.status,
      candidates: rankProducts(products, String(r.rawText ?? ''), 5, 1, 0.3)
        .map((x) => ({ id: x.product.id, name: x.product.name, category: x.product.category, exact: x.exact })),
    }));
    return c.json({
      batch: {
        id: String((batch as any).id),
        vendorId: (batch as any).vendorId != null ? String((batch as any).vendorId) : null,
        quotedAt: (batch as any).quotedAt != null ? new Date((batch as any).quotedAt).toISOString() : new Date().toISOString(),
      },
      rows: withCands,
    });
  });

  // ── Runner: apply enrich updates (alias appends + row patches + finalize) ──
  app.post('/api/runner/bulk-import/enrich', async (c) => {
    if (!requireSecret(c)) return c.json({ error: 'forbidden' }, 403);
    let body: any = {};
    try { body = await c.req.json(); } catch { return c.json({ error: 'JSON required' }, 400); }
    const batchId = String(body?.batchId ?? '');
    if (!batchId) return c.json({ error: 'batchId required' }, 400);
    const updates = Array.isArray(body?.updates) ? body.updates.slice(0, 500) : [];
    const { updateRow, refreshCounts, getRow } = await import('../../automations/bulk-import/store');
    const { finalizeRow } = await import('../../automations/bulk-import/match-rows');
    let applied = 0;
    for (const u of updates) {
      try {
        const id = String(u?.id ?? '');
        if (!id) continue;
        const cur = await getRow(id);
        if (!cur || cur.batchId !== batchId) continue;
        // Alias flow: append the raw term to the product, then link the row.
        if (u?.aliasFor && !cur.productId) {
          try {
            const { updateProduct } = await import('../../automations/product-line/update');
            const { getProductDetail } = await import('../../automations/product-line/service');
            const detail = await getProductDetail(String(u.aliasFor)).catch(() => null);
            const term = String(u?.aliasTerm ?? cur.rawText ?? '').trim().slice(0, 120);
            if (detail && term) {
              const existing = (((detail as any)?.product as any)?.aliases ?? []) as string[];
              if (!existing.map((a) => String(a).toLowerCase()).includes(term.toLowerCase())) {
                await updateProduct(String(u.aliasFor), { aliases: [...existing, term] }).catch(() => {});
              }
            }
          } catch { /* link anyway */ }
          await updateRow(id, { productId: String(u.aliasFor), productName: String(u?.productName ?? '') || cur.productName });
        } else {
          const patch: Record<string, unknown> = {};
          for (const k of ['productId', 'productName', 'isNewProduct', 'newCategory', 'vendorId', 'vendorName', 'price', 'unit', 'discount', 'moq', 'deliveryDays', 'weightPerUnit', 'packageQty', 'packageDims', 'specs']) {
            if ((u as any)?.[k] !== undefined) patch[k] = (u as any)[k];
          }
          if (Object.keys(patch).length) await updateRow(id, patch as any);
        }
        await finalizeRow(id).catch(() => {});
        applied++;
      } catch { /* per-row best-effort */ }
    }
    await refreshCounts(batchId).catch(() => {});
    notifyLive(c, { type: 'data-changed' });
    return c.json({ ok: true, applied });
  });

  // ── Commit batch → live rates (ready rows only, origin-stamped) ──
  app.post('/api/bulk-import/batches/:id/commit', async (c) => {
    try { await requireRoot(c); } catch (e) { return rootError(c, e); }
    try {
      const { commitBatch } = await import('../../automations/bulk-import/commit');
      const out = await commitBatch(c.req.param('id') ?? '');
      notifyLive(c, { type: 'data-changed' });
      return c.json({ ok: true, ...out });
    } catch (e: any) {
      return c.json({ error: String(e?.message ?? 'commit failed').slice(0, 300) }, 400);
    }
  });

  // ── Block disable/enable (one click hides/restores every batch rate) ──
  app.post('/api/bulk-import/batches/:id/block', async (c) => {
    try { await requireRoot(c); } catch (e) { return rootError(c, e); }
    let body: any = {};
    try { body = await c.req.json(); } catch { body = {}; }
    try {
      const { setBlockActive } = await import('../../automations/bulk-import/commit');
      const out = await setBlockActive(c.req.param('id') ?? '', body?.disabled !== false);
      notifyLive(c, { type: 'data-changed' });
      return c.json({ ok: true, disabled: body?.disabled !== false, ...out });
    } catch (e: any) {
      return c.json({ error: String(e?.message ?? 'block toggle failed').slice(0, 300) }, 400);
    }
  });

  // ── Block delete (one click hard-wipes every batch rate; batch kept) ──
  app.delete('/api/bulk-import/batches/:id', async (c) => {
    try { await requireRoot(c); } catch (e) { return rootError(c, e); }
    try {
      const { deleteBlock } = await import('../../automations/bulk-import/commit');
      const out = await deleteBlock(c.req.param('id') ?? '');
      notifyLive(c, { type: 'data-changed' });
      return c.json({ ok: true, ...out });
    } catch (e: any) {
      return c.json({ error: String(e?.message ?? 'block delete failed').slice(0, 300) }, 400);
    }
  });

  // ── Filtered bulk patch ("all belts are V-type" primitive) ──
  app.post('/api/bulk-import/batches/:id/bulk-patch', async (c) => {
    try { await requireRoot(c); } catch (e) { return rootError(c, e); }
    let body: any = {};
    try { body = await c.req.json(); } catch { return c.json({ error: 'JSON body required' }, 400); }
    const { bulkPatchRows } = await import('../../automations/bulk-import/store');
    const n = await bulkPatchRows(
      c.req.param('id') ?? '',
      { status: body?.filter?.status, productId: body?.filter?.productId, missingField: body?.filter?.missingField },
      body?.patch ?? {},
    );
    notifyLive(c, { type: 'data-changed' });
    return c.json({ ok: true, updated: n });
  });
}
