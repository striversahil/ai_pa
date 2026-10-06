// bulk-import/commit.ts — batch → catalogue writes (commit-as-block).
// Thin lifecycle over product-line/update.ts: resolves vendors/products
// (creating staged new ones), files ready rows as VendorRates stamped with
// batchId + sourceRef, and implements block disable/enable/delete. Every
// rate here carries its origin — the Rates tab reads batchId/sourceRef.
import { prisma } from '../../shared/prisma';
import { createProduct, createRate, createVendor, slugAttrKey } from '../product-line/update';
import { getProductIndex } from '../product-line/service';
import { getBatch, getBatchRows, refreshCounts, setBatchDisabled, setBatchStatus } from './store';
import type { BulkRowRec } from './types';

async function liveCategories(): Promise<string[]> {
  const products = await getProductIndex().catch(() => []);
  const seen = new Map<string, string>();
  for (const p of (products ?? []) as any[]) {
    if (p?.active === false) continue;
    const c = String(p?.category ?? '').trim();
    if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  return [...seen.values()].sort();
}

async function resolveVendorId(row: BulkRowRec): Promise<string | null> {
  if (row.vendorId) return row.vendorId;
  const name = String(row.vendorName ?? '').trim();
  if (!name) return null;
  const hit = await (prisma as any).vendor.findUnique({ where: { name } }).catch(() => null);
  if (hit) return String((hit as any).id);
  const created: any = await createVendor({ name });
  return String(created.id);
}

async function resolveProductId(row: BulkRowRec): Promise<string | null> {
  if (row.productId && !row.isNewProduct) return row.productId;
  if (row.isNewProduct) {
    const name = String(row.productName ?? row.rawText ?? '').trim().slice(0, 300);
    if (!name) return null;
    const cats = await liveCategories().catch(() => [] as string[]);
    const cat = cats.find((c) => c.toLowerCase() === String(row.newCategory ?? '').toLowerCase());
    if (!cat) return null;
    const created: any = await createProduct({ name, category: cat });
    const pid = String(created.id);
    // New product inherits its staged specs as the first checklist: every
    // spec key becomes a required KypGuide question (attrKeys stay stable).
    const taken = new Set<string>();
    let order = 0;
    for (const [k, v] of Object.entries(row.specs ?? {})) {
      if (!String(v ?? '').trim()) continue;
      const attrKey = slugAttrKey(k, taken);
      await (prisma as any).kypGuide.create({
        data: { productId: pid, attrKey, question: String(k).slice(0, 500), sortOrder: order++, isRequired: true, active: true },
      }).catch(() => {});
    }
    return pid;
  }
  return null;
}

export interface CommitResult {
  committed: number;
  skippedDuplicates: number;
  skippedIncomplete: { rowNo: number; reason: string }[];
  rateIds: string[];
}

/** File every ready row as a live rate. Duplicates + incomplete rows skip
 *  (reported, never forced). Batch → committed. */
export async function commitBatch(batchId: string): Promise<CommitResult> {
  const bid = String(batchId);
  const batch = await getBatch(bid);
  if (!batch) throw new Error('batch not found');
  if (batch.status === 'committed') throw new Error('batch already committed');
  const rows = await getBatchRows(bid, undefined, 2000);
  const res: CommitResult = { committed: 0, skippedDuplicates: 0, skippedIncomplete: [], rateIds: [] };
  for (const r of rows) {
    if (r.status === 'duplicate' || r.duplicateOf) { res.skippedDuplicates++; continue; }
    if (r.status !== 'ready') {
      res.skippedIncomplete.push({ rowNo: r.rowNo, reason: `status ${r.status}: ${(r.missing ?? []).slice(0, 3).join('; ') || 'unresolved'}` });
      continue;
    }
    try {
      const vendorId = await resolveVendorId(r);
      if (!vendorId) throw new Error('vendor unresolved');
      const productId = await resolveProductId(r);
      if (!productId) throw new Error('product unresolved');
      if (r.price == null || !(r.price > 0) || !r.unit) throw new Error('price/unit missing');
      const created: any = await createRate({
        vendorId, productId,
        attrValues: { ...(r.specs ?? {}) },
        pricePerUnit: r.price, unit: r.unit,
        discountPercent: r.discount ?? 0,
        moq: r.moq ?? null, deliveryDays: r.deliveryDays ?? null,
        weightPerUnit: r.weightPerUnit ?? null,
        packageQty: r.packageQty ?? null, packageDims: r.packageDims ?? null,
        quotedAt: r.quotedAt ?? batch.quotedAt,
      });
      const rid = String(created.id);
      // Stamp the origin (traceability survives every dashboard read).
      await (prisma as any).vendorRate.update({
        where: { id: rid },
        data: { batchId: bid, sourceRef: `bulk:${bid}:row-${r.rowNo}` },
      }).catch(() => {});
      res.committed++;
      res.rateIds.push(rid);
    } catch (e: any) {
      res.skippedIncomplete.push({ rowNo: r.rowNo, reason: String(e?.message ?? 'commit failed').slice(0, 120) });
    }
  }
  await setBatchStatus(bid, 'committed');
  await bustBatchCaches(bid);
  await refreshCounts(bid).catch(() => {});
  return res;
}

async function batchRateIds(bid: string): Promise<string[]> {
  const rows = await (prisma as any).vendorRate.findMany({ where: { batchId: bid }, select: { id: true } }).catch(() => []);
  return ((rows as any[]) ?? []).map((r) => String((r as any).id));
}

/** Bust every read cache that can serve this batch's rates (dashboard
 *  monolith + per-product detail/rates), or disable/delete looks dead. */
async function bustBatchCaches(bid: string): Promise<void> {
  try {
    const { invalidateProductLineCache, invalidateProductDetailCache, invalidateProductRatesCache } =
      await import('../product-line/service');
    await invalidateProductLineCache().catch(() => {});
    const rows = await (prisma as any).vendorRate.findMany({ where: { batchId: bid }, select: { productId: true } }).catch(() => []);
    const pids = [...new Set(((rows as any[]) ?? []).map((r) => String((r as any)?.productId ?? '')).filter(Boolean))];
    await Promise.all(pids.map((pid) => Promise.all([
      invalidateProductDetailCache(pid).catch(() => {}),
      invalidateProductRatesCache(pid).catch(() => {}),
    ])));
  } catch { /* best-effort */ }
}

/** Block disable/enable: flips active on every batch rate (reversible). */
export async function setBlockActive(batchId: string, disabled: boolean): Promise<{ rates: number }> {
  const bid = String(batchId);
  const batch = await getBatch(bid);
  if (!batch) throw new Error('batch not found');
  const ids = await batchRateIds(bid);
  for (let i = 0; i < ids.length; i += 25) {
    await Promise.all(ids.slice(i, i + 25).map((id) =>
      (prisma as any).vendorRate.update({ where: { id }, data: { active: !disabled } }).catch(() => {})
    ));
  }
  await setBatchDisabled(bid, disabled);
  await bustBatchCaches(bid);
  return { rates: ids.length };
}

/** Block delete: hard-wipes every batch rate. The BulkBatch record stays as
 *  the audit trail (status committed, disabled false). */
export async function deleteBlock(batchId: string): Promise<{ rates: number }> {
  const bid = String(batchId);
  const batch = await getBatch(bid);
  if (!batch) throw new Error('batch not found');
  const ids = await batchRateIds(bid);
  await bustBatchCaches(bid); // reads productIds BEFORE the wipe
  for (let i = 0; i < ids.length; i += 25) {
    await Promise.all(ids.slice(i, i + 25).map((id) =>
      (prisma as any).vendorRate.delete({ where: { id } }).catch(() => {})
    ));
  }
  await setBatchDisabled(bid, false);
  await bustBatchCaches(bid); // monolith after the wipe
  await refreshCounts(bid).catch(() => {});
  return { rates: ids.length };
}
