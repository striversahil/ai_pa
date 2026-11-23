// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.
import type { RateRow } from "../types";

// v2 (2026-11-21): rates left the payload (paged endpoint); rateTotal + bestPrice added.
export const DATA_KEY = 'product-line:data:v2';

export const DATA_TTL_MS = 10 * 60 * 1000;

export function parseAliases(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s)).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.map((s) => String(s)).filter(Boolean);
    } catch { /* fall through */ }
  }
  return [];
}

export function parseAttrValues(raw: unknown): Record<string, string> {
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

export function parseCondition(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object') return v;
    } catch { /* fall through */ }
  }
  return null;
}

export function parseMissingSpecs(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.map(String).filter(Boolean);
    } catch { /* fall through */ }
  }
  return null;
}

/** One D1 VendorRate row → RateRow (the single mapper; joined names passed in). */
export function toRateRow(
  r: any,
  joined: { vendorName: string | null; vendorType: string | null; productId: string | null; productName: string | null },
): RateRow {
  return {
    id: String(r.id),
    vendorId: String(r.vendorId ?? ''),
    vendorName: joined.vendorName,
    vendorType: joined.vendorType,
    productId: joined.productId,
    productName: joined.productName,
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
    deliveryMaxDays: r.deliveryMaxDays != null ? Number(r.deliveryMaxDays) : null,
    imageUrl: r.imageUrl ? String(r.imageUrl) : null,
    videoUrl: r.videoUrl ? String(r.videoUrl) : null,
    quotedAt: String(r.quotedAt ?? ''),
    enquiryRef: r.enquiryRef != null ? String(r.enquiryRef) : null,
    notes: r.notes ? String(r.notes) : null,
    missingSpecs: parseMissingSpecs(r.missingSpecs),
    active: r.active !== false && r.active !== 0,
  };
}

export const INDEX_KEY = 'product-line:index:v1';

export const INDEX_TTL_MS = 10 * 60 * 1000;

export const RATES_TTL_MS = 10 * 60 * 1000;

export const VENDORS_KEY = 'product-line:vendors:v1';

export const VENDORS_TTL_MS = 10 * 60 * 1000;

export const DETAIL_TTL_MS = 10 * 60 * 1000;
