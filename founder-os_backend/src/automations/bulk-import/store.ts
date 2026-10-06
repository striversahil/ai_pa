// bulk-import/store.ts — persistence ONLY (mapping + D1/Memory stores).
// Pure matching lives in parse.ts + product-line/match.ts; AI batch steps
// live in match-rows.ts; routes orchestrate.
import { prisma } from '../../shared/prisma';
import { cached, cacheDel } from '../../shared/cache';
import type { BulkBatchRow, BulkRowRec, BulkSourceKind } from './types';

const LIST_KEY = 'bulk-import:batches:v1';
const LIST_TTL_MS = 60 * 1000;

function parseJsonObj(raw: unknown): Record<string, string> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[String(k)] = String(v ?? '');
    return out;
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) return parseJsonObj(v);
    } catch { /* fall through */ }
  }
  return {};
}

function parseJsonArr(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s)).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.map((s) => String(s)).filter(Boolean);
    } catch { /* fall through */ }
  }
  return [];
}

function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBatch(g: any): BulkBatchRow {
  return {
    id: String(g.id),
    vendorId: g.vendorId != null ? String(g.vendorId) : null,
    sourceKind: String(g.sourceKind ?? 'paste') as BulkSourceKind,
    sourceName: String(g.sourceName ?? ''),
    sourceFileKey: g.sourceFileKey != null ? String(g.sourceFileKey) : null,
    sourceText: g.sourceText != null ? String(g.sourceText) : null,
    quotedAt: g.quotedAt != null ? new Date(g.quotedAt).toISOString() : new Date().toISOString(),
    status: String(g.status ?? 'review') as BulkBatchRow['status'],
    disabled: g.disabled === true || g.disabled === 1,
    rowCount: Number(g.rowCount ?? 0) || 0,
    readyCount: Number(g.readyCount ?? 0) || 0,
    createdBy: String(g.createdBy ?? ''),
    createdAt: g.createdAt != null ? new Date(g.createdAt).toISOString() : new Date().toISOString(),
  };
}

export function toRow(r: any): BulkRowRec {
  return {
    id: String(r.id),
    batchId: String(r.batchId),
    rowNo: Number(r.rowNo ?? 0) || 0,
    rawText: String(r.rawText ?? ''),
    rawHash: String(r.rawHash ?? ''),
    productId: r.productId != null ? String(r.productId) : null,
    productName: r.productName != null ? String(r.productName) : null,
    isNewProduct: r.isNewProduct === true || r.isNewProduct === 1,
    newCategory: r.newCategory != null ? String(r.newCategory) : null,
    vendorId: r.vendorId != null ? String(r.vendorId) : null,
    vendorName: r.vendorName != null ? String(r.vendorName) : null,
    price: numOrNull(r.price),
    unit: r.unit != null ? String(r.unit) : null,
    discount: numOrNull(r.discount),
    moq: r.moq != null ? String(r.moq) : null,
    deliveryDays: r.deliveryDays != null ? Number(r.deliveryDays) : null,
    weightPerUnit: numOrNull(r.weightPerUnit),
    packageQty: r.packageQty != null ? String(r.packageQty) : null,
    packageDims: r.packageDims != null ? String(r.packageDims) : null,
    quotedAt: r.quotedAt != null ? new Date(r.quotedAt).toISOString() : null,
    specs: parseJsonObj(r.specs),
    missing: parseJsonArr(r.missing),
    matchConfidence: numOrNull(r.matchConfidence),
    duplicateOf: r.duplicateOf != null ? String(r.duplicateOf) : null,
    status: String(r.status ?? 'needs-product') as BulkRowRec['status'],
  };
}

function rowData(patch: Partial<BulkRowRec> & { specs?: unknown; missing?: unknown }): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  const str = (v: unknown) => (v === undefined ? undefined : (v == null ? null : String(v)));
  if (patch.productId !== undefined) d.productId = str(patch.productId);
  if (patch.productName !== undefined) d.productName = str(patch.productName);
  if (patch.isNewProduct !== undefined) d.isNewProduct = !!patch.isNewProduct;
  if (patch.newCategory !== undefined) d.newCategory = str(patch.newCategory);
  if (patch.vendorId !== undefined) d.vendorId = str(patch.vendorId);
  if (patch.vendorName !== undefined) d.vendorName = str(patch.vendorName);
  if (patch.price !== undefined) d.price = patch.price;
  if (patch.unit !== undefined) d.unit = str(patch.unit);
  if (patch.discount !== undefined) d.discount = patch.discount;
  if (patch.moq !== undefined) d.moq = str(patch.moq);
  if (patch.deliveryDays !== undefined) d.deliveryDays = patch.deliveryDays;
  if (patch.weightPerUnit !== undefined) d.weightPerUnit = patch.weightPerUnit;
  if (patch.packageQty !== undefined) d.packageQty = str(patch.packageQty);
  if (patch.packageDims !== undefined) d.packageDims = str(patch.packageDims);
  if (patch.quotedAt !== undefined) d.quotedAt = patch.quotedAt == null ? null : new Date(String(patch.quotedAt)).toISOString();
  if ((patch as any).specs !== undefined) d.specs = JSON.stringify((patch as any).specs ?? {});
  if ((patch as any).missing !== undefined) d.missing = JSON.stringify((patch as any).missing ?? []);
  if (patch.matchConfidence !== undefined) d.matchConfidence = patch.matchConfidence;
  if (patch.duplicateOf !== undefined) d.duplicateOf = str(patch.duplicateOf);
  if (patch.status !== undefined) d.status = String(patch.status);
  return d;
}

export async function createBatch(input: {
  vendorId?: string | null;
  sourceKind: BulkSourceKind;
  sourceName?: string;
  sourceFileKey?: string | null;
  sourceText?: string | null;
  quotedAt?: string;
  createdBy: string;
}): Promise<BulkBatchRow> {
  const row = await (prisma as any).bulkBatch.create({
    data: {
      vendorId: input.vendorId || null,
      sourceKind: input.sourceKind,
      sourceName: String(input.sourceName ?? '').slice(0, 300),
      sourceFileKey: input.sourceFileKey ?? null,
      sourceText: input.sourceText != null ? String(input.sourceText).slice(0, 200_000) : null,
      quotedAt: input.quotedAt ? new Date(input.quotedAt).toISOString() : new Date().toISOString(),
      status: 'review',
      disabled: false,
      rowCount: 0,
      readyCount: 0,
      createdBy: String(input.createdBy ?? '').slice(0, 200),
    },
  });
  await cacheDel(LIST_KEY).catch(() => {});
  return toBatch(row);
}

/** Bulk insert staged rows (chunked — D1 batch limits). Returns inserted count. */
export async function insertRows(batchId: string, lines: { rowNo: number; rawText: string; rawHash: string; price: number | null; unit: string | null; vendorId?: string | null; vendorName?: string | null; quotedAt?: string | null }[]): Promise<number> {
  const bid = String(batchId);
  let n = 0;
  for (let i = 0; i < lines.length; i += 50) {
    const chunk = lines.slice(i, i + 50);
    await Promise.all(chunk.map((l) =>
      (prisma as any).bulkRow.create({
        data: {
          batchId: bid,
          rowNo: l.rowNo,
          rawText: l.rawText,
          rawHash: l.rawHash,
          price: l.price,
          unit: l.unit,
          vendorId: l.vendorId ?? null,
          vendorName: l.vendorName ?? null,
          quotedAt: l.quotedAt ?? null,
          specs: '{}',
          missing: '[]',
          status: 'unprocessed',
        },
      }).then(() => { n++; }).catch(() => {})
    ));
  }
  await refreshCounts(bid).catch(() => {});
  await cacheDel(LIST_KEY).catch(() => {});
  return n;
}

export async function refreshCounts(batchId: string): Promise<void> {
  const bid = String(batchId);
  try {
    const [total, ready] = await Promise.all([
      (prisma as any).bulkRow.count({ where: { batchId: bid } }).catch(() => 0),
      (prisma as any).bulkRow.count({ where: { batchId: bid, status: 'ready' } }).catch(() => 0),
    ]);
    await (prisma as any).bulkBatch.update({ where: { id: bid }, data: { rowCount: Number(total) || 0, readyCount: Number(ready) || 0 } }).catch(() => {});
  } catch { /* best-effort */ }
}

export async function listBatches(limit = 50): Promise<BulkBatchRow[]> {
  return cached(LIST_KEY, LIST_TTL_MS, async () => {
    const rows = await (prisma as any).bulkBatch.findMany({ orderBy: [{ createdAt: 'desc' }], take: Math.max(1, Math.min(200, limit)) }).catch(() => []);
    return ((rows as any[]) ?? []).map(toBatch);
  });
}

export async function getBatch(id: string): Promise<BulkBatchRow | null> {
  const row = await (prisma as any).bulkBatch.findUnique({ where: { id: String(id) } }).catch(() => null);
  return row ? toBatch(row) : null;
}

export async function getBatchRows(batchId: string, status?: string, limit = 500): Promise<BulkRowRec[]> {
  const where: Record<string, unknown> = { batchId: String(batchId) };
  if (status) where.status = String(status);
  const rows = await (prisma as any).bulkRow.findMany({ where, orderBy: [{ rowNo: 'asc' }], take: Math.max(1, Math.min(2000, limit)) }).catch(() => []);
  return ((rows as any[]) ?? []).map(toRow);
}

export async function getRow(id: string): Promise<BulkRowRec | null> {
  const row = await (prisma as any).bulkRow.findUnique({ where: { id: String(id) } }).catch(() => null);
  return row ? toRow(row) : null;
}

export async function updateRow(id: string, patch: Parameters<typeof rowData>[0], skipCounts = false): Promise<BulkRowRec | null> {
  const data = rowData(patch);
  if (Object.keys(data).length === 0) return null;
  const row = await (prisma as any).bulkRow.update({ where: { id: String(id) }, data }).catch(() => null);
  if (row && !skipCounts) await refreshCounts(String((row as any).batchId)).catch(() => {});
  await cacheDel(LIST_KEY).catch(() => {});
  return row ? toRow(row) : null;
}

/** Filtered bulk patch over one batch's staged rows. Returns updated count. */
export async function bulkPatchRows(batchId: string, filter: { status?: string; productId?: string; missingField?: string }, patch: Parameters<typeof rowData>[0]): Promise<number> {
  const rows = await getBatchRows(batchId, filter.status, 2000);
  const data = rowData(patch);
  if (Object.keys(data).length === 0) return 0;
  let n = 0;
  const targets = rows.filter((r) => {
    if (filter.productId && r.productId !== filter.productId) return false;
    if (filter.missingField && !(r.missing ?? []).includes(filter.missingField)) return false;
    return true;
  });
  for (let i = 0; i < targets.length; i += 25) {
    await Promise.all(targets.slice(i, i + 25).map((r) =>
      (prisma as any).bulkRow.update({ where: { id: r.id }, data: { ...data } }).then(() => { n++; }).catch(() => {})
    ));
  }
  await refreshCounts(batchId).catch(() => {});
  await cacheDel(LIST_KEY).catch(() => {});
  return n;
}

export interface BulkRowFilter {
  status?: string;
  productId?: string;
  /** case-insensitive substring on productName (or rawText fallback). */
  productContains?: string;
  /** only rows whose missing[] includes this label (substring ok). */
  missingContains?: string;
  /** explicit row ids (link flows). */
  ids?: string[];
}

function matchesFilter(r: BulkRowRec, filter: BulkRowFilter): boolean {
  if (filter.status && r.status !== filter.status) return false;
  if (filter.productId && r.productId !== filter.productId) return false;
  if (filter.productContains) {
    const needle = filter.productContains.toLowerCase();
    const hay = `${r.productName ?? ''} ${r.rawText ?? ''}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (filter.missingContains) {
    const needle = filter.missingContains.toLowerCase();
    if (!(r.missing ?? []).some((m) => m.toLowerCase().includes(needle))) return false;
  }
  if (filter.ids && filter.ids.length && !filter.ids.includes(r.id)) return false;
  return true;
}

/** Dry-run a filtered bulk change: matched count + sample rows (no writes).
 *  Powers chat previews AND the Confirm card ("applies to N rows"). */
export async function previewBulkRows(batchId: string, filter: BulkRowFilter, limit = 2000): Promise<{ count: number; sample: BulkRowRec[] }> {
  const rows = await getBatchRows(batchId, filter.status, limit);
  const targets = rows.filter((r) => matchesFilter(r, filter));
  return { count: targets.length, sample: targets.slice(0, 3) };
}

export interface BulkSetPatch {
  price?: number | null;
  unit?: string | null;
  discount?: number | null;
  moq?: string | null;
  deliveryDays?: number | null;
  weightPerUnit?: number | null;
  packageQty?: string | null;
  packageDims?: string | null;
  vendorId?: string | null;
  vendorName?: string | null;
  productId?: string | null;
  productName?: string | null;
  isNewProduct?: boolean;
  newCategory?: string | null;
  /** Merged into existing specs (never wholesale-replaced). */
  mergeSpecs?: Record<string, string>;
}

/** Filtered bulk write with specs-merge + per-row finalize (missing/status
 *  recomputed, so fixed rows flip to ready in the same turn). Returns the
 *  updated rows (id + new status) for the Confirm receipt. */
export async function bulkApplySet(batchId: string, filter: BulkRowFilter, patch: BulkSetPatch): Promise<{ updated: number; rows: { id: string; rowNo: number; status: string }[] }> {
  const { count } = await previewBulkRows(batchId, filter);
  if (count === 0) return { updated: 0, rows: [] };
  if (count > 2000) throw new Error(`refusing bulk write over ${count} rows (cap 2000)`);
  const rows = await getBatchRows(batchId, filter.status, 2000);
  const targets = rows.filter((r) => matchesFilter(r, filter));
  const { finalizeRow } = await import('./match-rows');
  const out: { id: string; rowNo: number; status: string }[] = [];
  for (let i = 0; i < targets.length; i += 25) {
    await Promise.all(targets.slice(i, i + 25).map(async (r) => {
      try {
        const base = rowData({
          price: patch.price, unit: patch.unit, discount: patch.discount, moq: patch.moq,
          deliveryDays: patch.deliveryDays, weightPerUnit: patch.weightPerUnit,
          packageQty: patch.packageQty, packageDims: patch.packageDims,
          vendorId: patch.vendorId, vendorName: patch.vendorName,
          productId: patch.productId, productName: patch.productName,
          isNewProduct: patch.isNewProduct, newCategory: patch.newCategory,
        } as any);
        // Drop undefined keys (rowData keeps nulls as explicit clears).
        for (const k of Object.keys(base)) if ((base as any)[k] === undefined) delete (base as any)[k];
        if (patch.mergeSpecs && Object.keys(patch.mergeSpecs).length) {
          (base as any).specs = { ...(r.specs ?? {}), ...patch.mergeSpecs };
        }
        if (Object.keys(base).length) await updateRow(r.id, base as any, true);
        const fin = await finalizeRow(r.id, true).catch(() => null);
        out.push({ id: r.id, rowNo: r.rowNo, status: fin?.status ?? r.status });
      } catch { /* per-row best-effort */ }
    }));
  }
  await refreshCounts(batchId).catch(() => {});
  return { updated: out.length, rows: out };
}

export async function setBatchStatus(id: string, status: BulkBatchRow['status']): Promise<BulkBatchRow | null> {
  const row = await (prisma as any).bulkBatch.update({ where: { id: String(id) }, data: { status: String(status) } }).catch(() => null);
  await cacheDel(LIST_KEY).catch(() => {});
  return row ? toBatch(row) : null;
}

export async function setBatchDisabled(id: string, disabled: boolean): Promise<BulkBatchRow | null> {
  const row = await (prisma as any).bulkBatch.update({ where: { id: String(id) }, data: { disabled: !!disabled } }).catch(() => null);
  await cacheDel(LIST_KEY).catch(() => {});
  return row ? toBatch(row) : null;
}
