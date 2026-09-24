import { prisma } from '../../shared/prisma';
import { cached, cacheDel } from '../../shared/cache';
import type { GuideRow, ProductDetail, ProductLineData, ProductRow, RateRow, VendorRow } from './types';

const DATA_KEY = 'product-line:data:v1';
const DATA_TTL_MS = 10 * 60 * 1000;

function parseAliases(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s)).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.map((s) => String(s)).filter(Boolean);
    } catch { /* fall through */ }
  }
  return [];
}

function parseAttrValues(raw: unknown): Record<string, string> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[String(k)] = String(v ?? '');
    return out;
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) return parseAttrValues(v);
    } catch { /* fall through */ }
  }
  return {};
}
function parseCondition(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object') return v;
    } catch { /* fall through */ }
  }
  return null;
}

/** Dashboard payload — full catalogue + guide + vendors + latest rates. */
export async function getProductLineData(): Promise<ProductLineData> {
  return cached(DATA_KEY, DATA_TTL_MS, async () => {
    const [products, guideRows, vendors, rates] = await Promise.all([
      (prisma as any).productItem.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
      (prisma as any).kypGuide.findMany({ orderBy: [{ productId: 'asc' }, { sortOrder: 'asc' }] }),
      (prisma as any).vendor.findMany({ orderBy: [{ name: 'asc' }] }),
      (prisma as any).vendorRate.findMany({ orderBy: [{ quotedAt: 'desc' }], take: 300 }),
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
    const rateCountByVendor = new Map<string, number>();
    const vendorName = new Map<string, string>();
    for (const v of (vendors as any[]) ?? []) vendorName.set(String(v.id), String(v.name ?? ''));
    const vendorType = new Map<string, string>();
    for (const v of (vendors as any[]) ?? []) vendorType.set(String(v.id), String((v as any).vendorType ?? ''));
    const productName = new Map<string, string>();
    const rows: ProductRow[] = ((products as any[]) ?? []).map((p) => {
      productName.set(String(p.id), String(p.name ?? ''));
      return {
        id: String(p.id),
        category: String(p.category ?? ''),
        name: String(p.name ?? ''),
        aliases: parseAliases(p.aliases),
        active: p.active !== false && p.active !== 0,
        guideCount: guideCount.get(String(p.id)) ?? 0,
        rateCount: 0,
      };
    });
    const rateRows: RateRow[] = ((rates as any[]) ?? []).map((r) => {
      const pid = r.productId != null ? String(r.productId) : null;
      if (pid) rateCountByProduct.set(pid, (rateCountByProduct.get(pid) ?? 0) + 1);
      rateCountByVendor.set(String(r.vendorId), (rateCountByVendor.get(String(r.vendorId)) ?? 0) + 1);
      return {
        id: String(r.id),
        vendorId: String(r.vendorId),
        vendorName: vendorName.get(String(r.vendorId)) ?? null,
        vendorType: vendorType.get(String(r.vendorId)) ?? null,
        productId: pid,
        productName: pid ? (productName.get(pid) ?? null) : null,
        attrKey: String(r.attrKey ?? ''),
        attrValues: parseAttrValues(r.attrValues),
        pricePerUnit: r.pricePerUnit != null ? Number(r.pricePerUnit) : null,
        unit: String(r.unit ?? ''),
        discountPercent: r.discountPercent != null ? Number(r.discountPercent) : null,
        baseRate: r.baseRate != null ? Number(r.baseRate) : null,
        weightPerUnit: r.weightPerUnit != null ? Number(r.weightPerUnit) : null,
        packageQty: r.packageQty != null ? String(r.packageQty) : null,
        packageDims: r.packageDims != null ? String(r.packageDims) : null,
        moq: r.moq != null ? String(r.moq) : null,
        deliveryDays: r.deliveryDays != null ? Number(r.deliveryDays) : null,
        imageUrl: r.imageUrl ? String(r.imageUrl) : null,
        videoUrl: r.videoUrl ? String(r.videoUrl) : null,
        quotedAt: String(r.quotedAt ?? ''),
        enquiryRef: r.enquiryRef != null ? String(r.enquiryRef) : null,
        active: r.active !== false && r.active !== 0,
      };
    });
    for (const p of rows) p.rateCount = rateCountByProduct.get(p.id) ?? 0;
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
    return { products: rows, guide, vendors: vendorRows, rates: rateRows };
  });
}

export async function invalidateProductLineCache(): Promise<void> {
  try { await cacheDel(DATA_KEY); } catch { /* best-effort */ }
}

const DETAIL_TTL_MS = 10 * 60 * 1000;

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
    const rateRows: RateRow[] = ((rates as any[]) ?? []).map((r) => ({
      id: String(r.id),
      vendorId: String(r.vendorId),
      vendorName: vendorName.get(String(r.vendorId)) ?? null,
      vendorType: vendorType.get(String(r.vendorId)) ?? null,
      productId: pid,
      productName: String((product as any).name ?? ''),
      attrKey: String(r.attrKey ?? ''),
      attrValues: parseAttrValues(r.attrValues),
      pricePerUnit: r.pricePerUnit != null ? Number(r.pricePerUnit) : null,
      unit: String(r.unit ?? ''),
      discountPercent: r.discountPercent != null ? Number(r.discountPercent) : null,
      baseRate: r.baseRate != null ? Number(r.baseRate) : null,
      weightPerUnit: r.weightPerUnit != null ? Number(r.weightPerUnit) : null,
      packageQty: r.packageQty != null ? String(r.packageQty) : null,
      packageDims: r.packageDims != null ? String(r.packageDims) : null,
      moq: r.moq != null ? String(r.moq) : null,
      deliveryDays: r.deliveryDays != null ? Number(r.deliveryDays) : null,
      imageUrl: r.imageUrl ? String(r.imageUrl) : null,
      videoUrl: r.videoUrl ? String(r.videoUrl) : null,
      quotedAt: String(r.quotedAt ?? ''),
      enquiryRef: r.enquiryRef != null ? String(r.enquiryRef) : null,
      active: r.active !== false && r.active !== 0,
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
