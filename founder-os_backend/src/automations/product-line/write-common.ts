// write-common.ts — shared helpers for the Product Line write paths.
//
// Split out of update.ts (2026-11-23) so update.ts stays inside the 400-line
// budget; the cache-busting wave is the important part: every catalogue or
// quote write must drop the live catalogue too, because rate writes typecheck
// against it and the KYP JSON export reads it.
import { prisma } from '../../shared/prisma';
import {
  invalidateProductLineCache,
  invalidateProductDetailCache,
  invalidateProductIndex,
  invalidateProductRatesCache,
  invalidateVendorIndex,
} from './service';
import { invalidateLiveCatalog } from './catalog-live';

export function fail(msg: string): never {
  throw new Error(msg);
}

export function mediaUrl(v: unknown): string | null {
  const s = String(v ?? '').trim().slice(0, 2000);
  if (!s) return null;
  if (!/^https?:\/\/.+/i.test(s) && !/^data:image\//i.test(s) && !/^\/api\/chat\/files\//.test(s)) {
    fail('media must be an uploaded photo or an https:// URL');
  }
  return s;
}

export function str(v: unknown, max = 500): string {
  return String(v ?? '').trim().slice(0, max);
}

/** Stable attrKey slug — generated once at create, never renamed after. */
export function slugAttrKey(question: string, taken: Set<string>): string {
  const words = String(question || '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const base = words.slice(0, 6).join('_').slice(0, 48) || 'attr';
  let k = base;
  let i = 1;
  while (taken.has(k)) {
    i += 1;
    k = `${base}_${i}`;
  }
  taken.add(k);
  return k;
}

export function parseAliasesInput(v: unknown): string | null {
  if (v === undefined) return null;
  const list = Array.isArray(v)
    ? v.map((s) => String(s).trim()).filter(Boolean)
    : String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return JSON.stringify(list.slice(0, 50));
}

export async function touched(productId?: string): Promise<void> {
  // One wave, not five round trips: every del is independent, so they fire
  // together. This runs per write — on a 20-row Confirm it used to be
  // 100 sequential KV deletes.
  await Promise.all([
    invalidateProductLineCache(),
    // The live catalogue is the contract every rate write typechecks against
    // and every KYP JSON export reads (2026-11-23) — bust it with the rest.
    invalidateLiveCatalog().catch(() => {}),
    // Scale-path caches: index rebuilds on next read (one slim query);
    // rates cache is per-product. Unconditional — correctness over micro-opt.
    invalidateProductIndex().catch(() => {}),
    invalidateVendorIndex().catch(() => {}),
    ...(productId
      ? [invalidateProductDetailCache(productId), invalidateProductRatesCache(productId).catch(() => {})]
      : []),
  ]);
}

export async function touchedGuide(guideId?: string, productId?: string): Promise<void> {
  let pid = productId;
  if (!pid && guideId) {
    try {
      const g = await (prisma as any).kypGuide.findUnique({ where: { id: String(guideId) } }).catch(() => null);
      if (g) pid = String((g as any).productId);
    } catch { /* best-effort */ }
  }
  await touched(pid);
}

