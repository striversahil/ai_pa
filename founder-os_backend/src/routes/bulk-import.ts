// Express mirror of the bulk-import worker routes (alt runtime, NOT prod).
// Root-only. Real logic lives in automations/bulk-import/* (shared).
import { Router } from 'express';
import { prisma } from '../shared/prisma';
import { asyncHandler } from '../middleware/asyncHandler';
import { AuthError, ROOT_EMAIL } from '../modules/auth/types';
import { PrismaAuthStore } from '../modules/auth/store-prisma';
import { getMe } from '../modules/auth/service';

void prisma;

const router = Router();
const store = new PrismaAuthStore(prisma);

const rootGuard = asyncHandler(async (req, res, next) => {
  const me = await getMe(store as any, req.headers.cookie || null).catch(() => null);
  const email = String((me as any)?.user?.email ?? '').toLowerCase();
  if (!me || ((me as any)?.isRoot !== true && email !== ROOT_EMAIL.toLowerCase())) {
    return res.status(me ? 403 : 401).json({ error: me ? 'Bulk import is root-only for now' : 'Authentication required' });
  }
  next();
});

router.post('/batches', rootGuard, asyncHandler(async (req, res) => {
  const text = String((req.body as any)?.text ?? '');
  if (!text.trim()) return res.status(400).json({ error: 'text required (paste rows or CSV)' });
  const { createBatch, insertRows, getBatchRows, refreshCounts } = await import('../automations/bulk-import/store');
  const { splitLines, splitCsvRow, csvLine } = await import('../automations/bulk-import/parse');
  const kind = String((req.body as any)?.sourceKind ?? 'paste');
  const sourceKind = (kind === 'csv' ? 'csv' : 'paste') as 'paste' | 'csv';
  const rawLines = sourceKind === 'csv'
    ? String(text).split(/\r?\n/).map((l) => csvLine(splitCsvRow(l)))
    : [text];
  const batch = await createBatch({
    vendorId: (req.body as any)?.vendorId ? String((req.body as any).vendorId) : null,
    sourceKind,
    sourceName: String((req.body as any)?.sourceName ?? 'pasted list').slice(0, 300),
    sourceText: text.slice(0, 200_000),
    quotedAt: (req.body as any)?.quotedAt ? String((req.body as any).quotedAt) : undefined,
    createdBy: 'root',
  });
  // Raw capture ONLY — rows land unprocessed; the Bulk chat AI does everything after.
  const parsed = splitLines(rawLines.join('\n'), 2000);
  const inserted = await insertRows(batch.id, parsed.map((p, i) => ({
    rowNo: i + 1, rawText: p.rawText, rawHash: p.rawHash,
    price: null, unit: null,
    vendorId: batch.vendorId, quotedAt: batch.quotedAt,
  })));
  await refreshCounts(batch.id).catch(() => {});
  res.status(201).json({ ok: true, batchId: batch.id, inserted, unprocessed: inserted });
}));

router.get('/batches', rootGuard, asyncHandler(async (_req, res) => {
  const { listBatches } = await import('../automations/bulk-import/store');
  res.json({ batches: await listBatches(50) });
}));

router.get('/batches/:id', rootGuard, asyncHandler(async (req, res) => {
  const { getBatch, getBatchRows } = await import('../automations/bulk-import/store');
  const batch = await getBatch(String(req.params.id ?? ''));
  if (!batch) return res.status(404).json({ error: 'batch not found' });
  const rows = await getBatchRows(batch.id, (req.query as any)?.status || undefined, 2000);
  res.json({ batch, rows });
}));

router.patch('/rows/:id', rootGuard, asyncHandler(async (req, res) => {
  const { updateRow } = await import('../automations/bulk-import/store');
  const allowed = ['productId', 'productName', 'isNewProduct', 'newCategory', 'vendorId', 'vendorName', 'price', 'unit', 'discount', 'moq', 'deliveryDays', 'weightPerUnit', 'packageQty', 'packageDims', 'quotedAt', 'specs', 'status'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if ((req.body as any)?.[k] !== undefined) patch[k] = (req.body as any)[k];
  const row = await updateRow(String(req.params.id ?? ''), patch);
  if (!row) return res.status(404).json({ error: 'row not found' });
  const { finalizeRow } = await import('../automations/bulk-import/match-rows');
  const final = (req.body as any)?.status === undefined
    ? (await finalizeRow(row.id).catch(() => row) ?? row)
    : row;
  res.json({ ok: true, row: final });
}));

router.post('/batches/:id/bulk-patch', rootGuard, asyncHandler(async (req, res) => {
  const { bulkPatchRows } = await import('../automations/bulk-import/store');
  const n = await bulkPatchRows(
    String(req.params.id ?? ''),
    { status: (req.body as any)?.filter?.status, productId: (req.body as any)?.filter?.productId, missingField: (req.body as any)?.filter?.missingField },
    (req.body as any)?.patch ?? {},
  );
  res.json({ ok: true, updated: n });
}));

// File upload + KV file serving are Worker-only (same as /api/chat/files).
router.post('/upload', (_req, res) => res.status(501).json({ error: 'File upload is only available on the Cloudflare Worker runtime' }));

router.post('/batches/:id/commit', rootGuard, asyncHandler(async (req, res) => {
  try {
    const { commitBatch } = await import('../automations/bulk-import/commit');
    const out = await commitBatch(String(req.params.id ?? ''));
    res.json({ ok: true, ...out });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? 'commit failed').slice(0, 300) });
  }
}));

router.post('/batches/:id/block', rootGuard, asyncHandler(async (req, res) => {
  try {
    const { setBlockActive } = await import('../automations/bulk-import/commit');
    const out = await setBlockActive(String(req.params.id ?? ''), (req.body as any)?.disabled !== false);
    res.json({ ok: true, disabled: (req.body as any)?.disabled !== false, ...out });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? 'block toggle failed').slice(0, 300) });
  }
}));

router.delete('/batches/:id', rootGuard, asyncHandler(async (req, res) => {
  try {
    const { deleteBlock } = await import('../automations/bulk-import/commit');
    const out = await deleteBlock(String(req.params.id ?? ''));
    res.json({ ok: true, ...out });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? 'block delete failed').slice(0, 300) });
  }
}));

// Runner endpoints (SHARED_SECRET) — work once Postgres carries migration 0054.
// Mounted at /api/runner/bulk-import/* to mirror the worker paths.
export const bulkImportRunnerRouter = Router();
bulkImportRunnerRouter.get('/file/:id', (_req, res) => res.status(501).json({ error: 'File serving is only available on the Cloudflare Worker runtime' }));

function runnerSecretOk(req: any): boolean {
  return String(req.headers.authorization ?? '') === `Bearer ${process.env.SHARED_SECRET ?? ''}`;
}

bulkImportRunnerRouter.get('/index', asyncHandler(async (req, res) => {
  if (!runnerSecretOk(req)) return res.status(403).json({ error: 'forbidden' });
  const { getProductIndex, getVendorIndex } = await import('../automations/product-line/service');
  const [products, vendors] = await Promise.all([
    getProductIndex().catch(() => []),
    getVendorIndex().catch(() => []),
  ]);
  const cats = [...new Set((products ?? []).map((p: any) => String(p.category ?? '').trim()).filter(Boolean))].sort();
  res.json({
    products: (products ?? []).filter((p: any) => p?.active !== false).map((p: any) => ({
      id: String(p.id), name: String(p.name ?? ''), category: String(p.category ?? ''),
      aliases: Array.isArray(p.aliases) ? p.aliases.map(String).slice(0, 10) : [],
    })),
    vendors: (vendors ?? []).filter((v: any) => v?.active !== false).map((v: any) => ({
      id: String(v.id), name: String(v.name ?? ''),
    })),
    categories: cats,
  });
}));

bulkImportRunnerRouter.get('/work', asyncHandler(async (req, res) => {
  if (!runnerSecretOk(req)) return res.status(403).json({ error: 'forbidden' });
  const batchId = String((req.query as any)?.batch_id ?? '');
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
  if (!batch || String((batch as any).status) === 'committed') return res.json({ batch: null, rows: [] });
  const { getBatchRows } = await import('../automations/bulk-import/store');
  const { getProductIndex } = await import('../automations/product-line/service');
  const { rankProducts } = await import('../automations/product-line/match');
  const rows = (await getBatchRows(String((batch as any).id), undefined, 2000))
    .filter((r) => r.status === 'needs-product' || r.status === 'needs-specs')
    .slice(0, 150);
  const index = await getProductIndex().catch(() => []);
  const products = (index ?? []).map((p: any) => ({
    id: String(p.id), category: String(p.category ?? ''), name: String(p.name ?? ''),
    aliases: Array.isArray(p.aliases) ? p.aliases : [], active: p.active !== false,
  }));
  res.json({
    batch: {
      id: String((batch as any).id),
      vendorId: (batch as any).vendorId != null ? String((batch as any).vendorId) : null,
      quotedAt: (batch as any).quotedAt != null ? new Date((batch as any).quotedAt).toISOString() : new Date().toISOString(),
    },
    rows: rows.map((r) => ({
      id: r.id, rowNo: r.rowNo, rawText: r.rawText,
      productId: r.productId, productName: r.productName, isNewProduct: r.isNewProduct,
      vendorId: r.vendorId, vendorName: r.vendorName,
      price: r.price, unit: r.unit, specs: r.specs, missing: r.missing, status: r.status,
      candidates: rankProducts(products, String(r.rawText ?? ''), 5, 1, 0.3)
        .map((x) => ({ id: x.product.id, name: x.product.name, category: x.product.category, exact: x.exact })),
    })),
  });
}));

bulkImportRunnerRouter.post('/enrich', asyncHandler(async (req, res) => {
  if (!runnerSecretOk(req)) return res.status(403).json({ error: 'forbidden' });
  const batchId = String((req.body as any)?.batchId ?? '');
  if (!batchId) return res.status(400).json({ error: 'batchId required' });
  const updates = Array.isArray((req.body as any)?.updates) ? (req.body as any).updates.slice(0, 500) : [];
  const { updateRow, refreshCounts, getRow } = await import('../automations/bulk-import/store');
  const { finalizeRow } = await import('../automations/bulk-import/match-rows');
  let applied = 0;
  for (const u of updates) {
    try {
      const id = String(u?.id ?? '');
      if (!id) continue;
      const cur = await getRow(id);
      if (!cur || cur.batchId !== batchId) continue;
      if (u?.aliasFor && !cur.productId) {
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
  res.json({ ok: true, applied });
}));
bulkImportRunnerRouter.get('/pending', asyncHandler(async (_req, res) => {
  if (String(_req.headers.authorization ?? '') !== `Bearer ${process.env.SHARED_SECRET ?? ''}`) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const rows = await (prisma as any).bulkBatch.findMany({
    where: { status: 'parsing' }, orderBy: [{ createdAt: 'asc' }], take: 5,
  }).catch(() => []);
  res.json({
    batches: ((rows as any[]) ?? []).map((b: any) => ({
      id: String(b.id), vendorId: b.vendorId != null ? String(b.vendorId) : null,
      sourceKind: String(b.sourceKind ?? 'xlsx'), sourceName: String(b.sourceName ?? ''),
      sourceFileKey: null,
      quotedAt: b.quotedAt != null ? new Date(b.quotedAt).toISOString() : new Date().toISOString(),
    })),
  });
}));

bulkImportRunnerRouter.post('/rows', asyncHandler(async (req, res) => {
  if (String(req.headers.authorization ?? '') !== `Bearer ${process.env.SHARED_SECRET ?? ''}`) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const batchId = String((req.body as any)?.batchId ?? '');
  if (!batchId) return res.status(400).json({ error: 'batchId required' });
  const { getBatch, insertRows, getBatchRows, setBatchStatus, refreshCounts } = await import('../automations/bulk-import/store');
  const batch = await getBatch(batchId);
  if (!batch) return res.status(404).json({ error: 'batch not found' });
  const { hashLine } = await import('../automations/bulk-import/parse');
  const lines = Array.isArray((req.body as any)?.lines) ? (req.body as any).lines : [];
  const prepared = lines.slice(0, 2000).map((l: any, i: number) => {
    const rawText = String(l?.rawText ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
    return {
      rowNo: batch.rowCount + i + 1, rawText, rawHash: hashLine(rawText),
      price: null, unit: null,
      vendorId: batch.vendorId, quotedAt: batch.quotedAt,
    };
  }).filter((l: any) => l.rawText.length >= 2);
  const inserted = await insertRows(batchId, prepared);
  if ((req.body as any)?.done === true) await setBatchStatus(batchId, 'review');
  await refreshCounts(batchId).catch(() => {});
  res.json({ ok: true, inserted });
}));

export default router;
