// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.
import type { ProductLineData, GuideRow, ProductRow, RateRow, VendorRow, ProductDetail } from "../types";
import { cached, cacheDel } from "../../../shared/cache";
import { prisma } from "../../../shared/prisma";
import { getD1Database } from "../../../shared/prisma-d1";
import { DATA_KEY, DATA_TTL_MS, parseCondition, parseAliases, toRateRow, INDEX_KEY, INDEX_TTL_MS, RATES_TTL_MS, VENDORS_KEY, VENDORS_TTL_MS, DETAIL_TTL_MS } from "./pure";
import type { ProductIndexRow, VendorIndexRow } from "./types";

/** Dashboard payload — catalogue + guide + vendors + COUNTED rate totals.
 *  Rates themselves are NOT in this payload: the Rates tab pages them via
 *  `GET /api/product-line/rates` (listRatesPaged). Counts/best prices come
 *  from GROUP BY over the whole table, so they stay exact at any size. */
export async function getProductLineData(): Promise<ProductLineData> {
  return cached(DATA_KEY, DATA_TTL_MS, async () => {
    const db = getD1Database();
    const [products, guideRows, vendors, byProduct, byVendor, totalRow] = await Promise.all([
      (prisma as any).productItem.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
      (prisma as any).kypGuide.findMany({ orderBy: [{ productId: 'asc' }, { sortOrder: 'asc' }] }),
      (prisma as any).vendor.findMany({ orderBy: [{ name: 'asc' }] }),
      db.prepare(
        `SELECT productId, COUNT(*) AS n,
                MIN(CASE WHEN active = 1 AND pricePerUnit IS NOT NULL THEN pricePerUnit END) AS best
           FROM VendorRate WHERE productId IS NOT NULL GROUP BY productId`,
      ).all(),
      db.prepare(`SELECT vendorId, COUNT(*) AS n FROM VendorRate GROUP BY vendorId`).all(),
      db.prepare(`SELECT COUNT(*) AS n FROM VendorRate`).first(),
    ]);
    const guideCount = new Map<string, number>();
    const guide: Record<string, GuideRow[]> = {};
    for (const g of (guideRows as any[]) ?? []) {
      const pid = String(g.productId);
      guideCount.set(pid, (guideCount.get(pid) ?? 0) + 1);
      (guide[pid] ??= []).push({
        id: String(g.id),
        productId: pid,
        attrKey: String(g.attrKey ?? ''),
        question: String(g.question ?? ''),
        guideNote: g.guideNote != null ? String(g.guideNote) : null,
        sortOrder: Number(g.sortOrder ?? 0),
        isRequired: g.isRequired === true || g.isRequired === 1,
        condition: parseCondition(g.condition),
        active: g.active !== false && g.active !== 0,
      });
    }
    const rateCountByProduct = new Map<string, number>();
    const bestByProduct = new Map<string, number>();
    for (const r of ((byProduct as any)?.results ?? []) as any[]) {
      rateCountByProduct.set(String(r.productId), Number(r.n) || 0);
      if (r.best != null) bestByProduct.set(String(r.productId), Number(r.best));
    }
    const rateCountByVendor = new Map<string, number>();
    for (const r of ((byVendor as any)?.results ?? []) as any[]) rateCountByVendor.set(String(r.vendorId), Number(r.n) || 0);
    const rows: ProductRow[] = ((products as any[]) ?? []).map((p) => ({
      id: String(p.id),
      category: String(p.category ?? ''),
      name: String(p.name ?? ''),
      aliases: parseAliases(p.aliases),
      active: p.active !== false && p.active !== 0,
      guideCount: guideCount.get(String(p.id)) ?? 0,
      rateCount: rateCountByProduct.get(String(p.id)) ?? 0,
      bestPrice: bestByProduct.get(String(p.id)) ?? null,
    }));
    const vendorRows: VendorRow[] = ((vendors as any[]) ?? []).map((v) => ({
      id: String(v.id),
      name: String(v.name ?? ''),
      contactPerson: v.contactPerson != null ? String(v.contactPerson) : null,
      contactPhone1: v.contactPhone1 != null ? String(v.contactPhone1) : null,
      contactPhone2: v.contactPhone2 != null ? String(v.contactPhone2) : null,
      location: v.location != null ? String(v.location) : null,
      address: v.address != null ? String(v.address) : null,
      yearEstablished: v.yearEstablished != null ? Number(v.yearEstablished) : null,
      vendorType: String(v.vendorType ?? ''),
      active: v.active !== false && v.active !== 0,
      rateCount: rateCountByVendor.get(String(v.id)) ?? 0,
    }));
    return { products: rows, guide, vendors: vendorRows, rateTotal: Number((totalRow as any)?.n ?? 0) };
  });
}

export async function invalidateProductLineCache(): Promise<void> {
  try { await cacheDel(DATA_KEY); } catch { /* best-effort */ }
}

/** Slim catalogue index: id/category/name/aliases for matching (no rates). */
export async function getProductIndex(): Promise<ProductIndexRow[]> {
  return cached(INDEX_KEY, INDEX_TTL_MS, async () => {
    const rows = await (prisma as any).productItem.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
    return ((rows as any[]) ?? []).map((p) => ({
      id: String(p.id),
      category: String(p.category ?? ''),
      name: String(p.name ?? ''),
      aliases: parseAliases(p.aliases),
      active: p.active !== false && p.active !== 0,
    }));
  });
}

export async function invalidateProductIndex(): Promise<void> {
  try { await cacheDel(INDEX_KEY); } catch { /* best-effort */ }
}

/** ALL rates for one product (no take-cap), with vendor names joined. */
export async function getRatesForProduct(productId: string): Promise<RateRow[]> {
  const pid = String(productId);
  return cached(`product-line:rates:v1:${pid}`, RATES_TTL_MS, async () => {
    const rates = await (prisma as any).vendorRate.findMany({ where: { productId: pid }, orderBy: [{ quotedAt: 'desc' }] });
    const list = ((rates as any[]) ?? []);
    const vendorIds = [...new Set(list.map((r) => String(r.vendorId ?? '')).filter(Boolean))];
    const vendorName = new Map<string, string>();
    const vendorType = new Map<string, string>();
    if (vendorIds.length > 0) {
      const vendors = await (prisma as any).vendor.findMany({ where: { id: { in: vendorIds } } }).catch(() => []);
      for (const v of ((vendors as any[]) ?? [])) {
        vendorName.set(String(v.id), String(v.name ?? ''));
        vendorType.set(String(v.id), String((v as any).vendorType ?? ''));
      }
    }
    const productName = await (prisma as any).productItem.findUnique({ where: { id: pid } })
      .then((p: any) => (p ? String(p.name ?? '') : '')).catch(() => '');
    return list.map((r) => toRateRow(r, {
      vendorName: vendorName.get(String(r.vendorId)) ?? null,
      vendorType: vendorType.get(String(r.vendorId)) ?? null,
      productId: pid,
      productName,
    }));
  });
}

export async function invalidateProductRatesCache(productId: string): Promise<void> {
  try { await cacheDel(`product-line:rates:v1:${String(productId)}`); } catch { /* best-effort */ }
}

/** Single rate by id with vendor/product names joined (delete-confirm path). */
export async function getRateById(id: string): Promise<RateRow | null> {
  const rid = String(id);
  const r = await (prisma as any).vendorRate.findUnique({ where: { id: rid } }).catch(() => null);
  if (!r) return null;
  const pid = String((r as any).productId ?? '');
  const vendor = (r as any).vendorId
    ? await (prisma as any).vendor.findUnique({ where: { id: String((r as any).vendorId) } }).catch(() => null)
    : null;
  const product = pid
    ? await (prisma as any).productItem.findUnique({ where: { id: pid } }).catch(() => null)
    : null;
  return toRateRow(r, {
    vendorName: vendor ? String((vendor as any).name ?? '') : null,
    vendorType: vendor ? String((vendor as any).vendorType ?? '') : null,
    productId: pid,
    productName: product ? String((product as any).name ?? '') : '',
  });
}

/** Slim vendor list for name/location matching (counts resolved per hit). */
export async function getVendorIndex(): Promise<VendorIndexRow[]> {
  return cached(VENDORS_KEY, VENDORS_TTL_MS, async () => {
    const rows = await (prisma as any).vendor.findMany({ orderBy: [{ name: 'asc' }] });
    return ((rows as any[]) ?? []).map((v) => ({
      id: String(v.id),
      name: String(v.name ?? ''),
      vendorType: String(v.vendorType ?? ''),
      location: v.location != null ? String(v.location) : null,
      active: v.active !== false && v.active !== 0,
    }));
  });
}

export async function invalidateVendorIndex(): Promise<void> {
  try { await cacheDel(VENDORS_KEY); } catch { /* best-effort */ }
}

/** Targeted rate count for one vendor (keeps vendor_lookup accurate at scale). */
export async function countRatesForVendor(vendorId: string): Promise<number> {
  try {
    const n = await (prisma as any).vendorRate.count({ where: { vendorId: String(vendorId) } });
    return Number(n) || 0;
  } catch {
    return 0;
  }
}

/** ACTIVE rate count for one vendor (vendor-delete guard — history stays deletable). */
export async function countActiveRatesForVendor(vendorId: string): Promise<number> {
  try {
    const n = await (prisma as any).vendorRate.count({ where: { vendorId: String(vendorId), active: true } });
    return Number(n) || 0;
  } catch {
    return 0;
  }
}

/** Full product detail: identity + guide + every vendor rate with specs. */
export async function getProductDetail(id: string): Promise<ProductDetail> {
  const pid = String(id);
  return cached(`product-line:detail:v1:${pid}`, DETAIL_TTL_MS, async () => {
    const [product, guideRows, rates, vendors] = await Promise.all([
      (prisma as any).productItem.findUnique({ where: { id: pid } }),
      (prisma as any).kypGuide.findMany({ where: { productId: pid }, orderBy: [{ sortOrder: 'asc' }] }),
      (prisma as any).vendorRate.findMany({ where: { productId: pid }, orderBy: [{ quotedAt: 'desc' }] }),
      (prisma as any).vendor.findMany({}),
    ]);
    if (!product) throw new Error('product not found');
    const vendorName = new Map<string, string>();
    const vendorType = new Map<string, string>();
    for (const v of (vendors as any[]) ?? []) {
      vendorName.set(String(v.id), String(v.name ?? ''));
      vendorType.set(String(v.id), String((v as any).vendorType ?? ''));
    }
    const guide: GuideRow[] = ((guideRows as any[]) ?? []).map((g) => ({
      id: String(g.id),
      productId: pid,
      attrKey: String(g.attrKey ?? ''),
      question: String(g.question ?? ''),
      guideNote: g.guideNote != null ? String(g.guideNote) : null,
      sortOrder: Number(g.sortOrder ?? 0),
      isRequired: g.isRequired === true || g.isRequired === 1,
      condition: parseCondition(g.condition),
      active: g.active !== false && g.active !== 0,
    }));
    const rateRows: RateRow[] = ((rates as any[]) ?? []).map((r) => toRateRow(r, {
      vendorName: vendorName.get(String(r.vendorId)) ?? null,
      vendorType: vendorType.get(String(r.vendorId)) ?? null,
      productId: pid,
      productName: String((product as any).name ?? ''),
    }));
    return {
      product: {
        id: pid,
        category: String((product as any).category ?? ''),
        name: String((product as any).name ?? ''),
        aliases: parseAliases((product as any).aliases),
        active: (product as any).active !== false && (product as any).active !== 0,
        guideCount: guide.length,
        rateCount: rateRows.length,
        bestPrice: rateRows.reduce<number | null>((m, r) => (r.active && r.pricePerUnit != null && (m == null || r.pricePerUnit < m) ? r.pricePerUnit : m), null),
        createdAt: String((product as any).createdAt ?? ''),
      },
      guide,
      rates: rateRows,
    };
  });
}

export async function invalidateProductDetailCache(id: string): Promise<void> {
  try { await cacheDel(`product-line:detail:v1:${String(id)}`); } catch { /* best-effort */ }
}
