// bulk-import/match-rows.ts — Steps 1+5 (code, ZERO AI):
// deterministic product resolve over the slim index, duplicate detection
// against live rates, and missing-field computation. The batched LLM steps
// (2 = match misses, 4 = extract specs) build on these row states.
import { getProductDetail, getProductIndex, getRatesForProduct } from '../product-line/service';
import { resolveProduct } from '../product-line/match';
import type { BulkRowRec } from './types';
import { updateRow } from './store';

const COMMERCIAL_LABELS: { key: string; label: string }[] = [
  { key: 'price', label: 'price' },
  { key: 'unit', label: 'unit' },
  { key: 'vendor', label: 'vendor' },
];

/** Missing labels for one row: commercials + required spec questions. */
export async function computeMissing(row: BulkRowRec): Promise<string[]> {
  const out: string[] = [];
  if (row.price == null || !(row.price > 0)) out.push('price');
  if (!row.unit) out.push('unit');
  if (!row.vendorId && !row.vendorName) out.push('vendor');
  const productResolved = !!(row.productId || (row.isNewProduct && row.newCategory && row.productName));
  if (row.productId && !row.isNewProduct) {
    try {
      const detail = await getProductDetail(row.productId).catch(() => null);
      const guide = (((detail as any)?.guide ?? []) as any[])
        .filter((g: any) => g?.active && g?.isRequired)
        .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      for (const g of guide) {
        const k = String(g.attrKey);
        if (!String((row.specs ?? {})[k] ?? '').trim()) out.push(`spec: ${String(g.question).slice(0, 80)}`);
      }
    } catch { /* best-effort */ }
  } else if (!productResolved) {
    // New-product drafts without name+category yet stay product-blocked.
    out.push('product');
  }
  // New-product drafts with name+category: specs are free-form (they seed
  // the checklist at commit), so no per-spec gates here.
  return out;
}

function rowStatus(row: BulkRowRec, missing: string[]): BulkRowRec['status'] {
  if (row.duplicateOf) return 'duplicate';
  if (!row.productId && !(row.isNewProduct && row.newCategory && row.productName)) return 'needs-product';
  if (missing.length > 0) return 'needs-specs';
  return 'ready';
}

/** Step 1: resolve every row deterministically (exact → substring → token).
 *  Rows that hit exactly resolve with confidence 1; partial hits resolve
 *  with 0.7 and stay reviewable; the rest wait for the batched LLM pass. */
export async function deterministicMatch(rows: BulkRowRec[]): Promise<{ resolved: number; exact: number }> {
  const index = await getProductIndex().catch(() => []);
  const products = (index ?? []).map((p: any) => ({
    id: String(p.id), category: String(p.category ?? ''), name: String(p.name ?? ''),
    aliases: Array.isArray(p.aliases) ? p.aliases : [], active: p.active !== false,
  }));
  let resolved = 0;
  let exact = 0;
  for (const r of rows) {
    if (r.productId || r.isNewProduct) continue;
    // Strip the commercial tail for matching ("V belt B-type ₹450" → item words).
    const itemGuess = String(r.rawText ?? '').replace(/(₹|rs\.?|inr|@|\d[\d,]*\.?\d*).*/i, '').trim() || r.rawText;
    const hit = resolveProduct(products, itemGuess, '');
    if (!hit) {
      // Still flag what's missing so the row doesn't sit blank in review.
      const missing = await computeMissing(r);
      await updateRow(r.id, { missing, status: 'needs-product' }).catch(() => {});
      continue;
    }
    const missing = await computeMissing({ ...r, productId: hit.product.id, productName: hit.product.name, matchConfidence: hit.exact ? 1 : 0.7 });
    await updateRow(r.id, {
      productId: hit.product.id,
      productName: hit.product.name,
      matchConfidence: hit.exact ? 1 : 0.7,
      missing,
      status: rowStatus({ ...r, productId: hit.product.id }, missing),
    }).catch(() => {});
    resolved++;
    if (hit.exact) exact++;
  }
  return { resolved, exact };
}

/** Step 5 (code part): same product + same specs + same vendor already live
 *  → flag duplicate so commit skips it by default. */
export async function flagDuplicates(rows: BulkRowRec[]): Promise<number> {
  let n = 0;
  const byProduct = new Map<string, BulkRowRec[]>();
  for (const r of rows) {
    if (!r.productId || r.isNewProduct || r.duplicateOf) continue;
    if (!byProduct.has(r.productId)) byProduct.set(r.productId, []);
    byProduct.get(r.productId)!.push(r);
  }
  for (const [pid, list] of byProduct) {
    const rates = await getRatesForProduct(pid).catch(() => []);
    const live = (rates ?? []).filter((x: any) => x && x.active !== false);
    if (!live.length) continue;
    for (const r of list) {
      const sig = JSON.stringify({ v: r.vendorId ?? r.vendorName ?? '', s: r.specs ?? {}, p: r.price ?? null, u: r.unit ?? '' });
      const dup = live.find((x: any) => JSON.stringify({
        v: String(x.vendorId ?? ''), s: x.attrValues ?? {}, p: x.pricePerUnit ?? null, u: String(x.unit ?? ''),
      }) === sig || JSON.stringify({ v: String(x.vendorId ?? ''), s: x.attrValues ?? {} }) === JSON.stringify({ v: r.vendorId ?? r.vendorName ?? '', s: r.specs ?? {} }));
      if (dup) {
        await updateRow(r.id, { duplicateOf: String((dup as any).id), status: 'duplicate', missing: [] }).catch(() => {});
        n++;
      }
    }
  }
  return n;
}

export { COMMERCIAL_LABELS };

/** Recompute missing + status for one staged row after any edit/enrich.
 *  Returns the refreshed row. */
export async function finalizeRow(id: string, skipCounts = false): Promise<BulkRowRec | null> {
  const { getRow } = await import('./store');
  const row = await getRow(id);
  if (!row) return null;
  const missing = await computeMissing(row);
  const status = rowStatus(row, missing);
  if (JSON.stringify(missing) === JSON.stringify(row.missing) && status === row.status) return row;
  const { updateRow } = await import('./store');
  return (await updateRow(id, { missing, status }, skipCounts).catch(() => null)) ?? row;
}
