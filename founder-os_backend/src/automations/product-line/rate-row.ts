// rate-row.ts — the ONE VendorRate column mapping.
//
// Extracted verbatim from update.ts (2026-11-23) so the single-row writer and
// the bulk importer can never land different fields: `createRate`/`updateRate`
// and `rate-import-write.ts` all build their pending row here.
//
// I/O-free by design (string/number coercion only) — the caller decides what to
// persist. `write-common` is imported for the three small coercers, so this
// module is NOT safe to bundle without the D1 layer; the pure SQL planner lives
// in `rate-import-plan.ts` instead.
import { fail, mediaUrl, str } from './write-common';

export function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Net rate = price × (1 − discount/100), 2dp. The single derivation —
 *  `baseRate` is stored so filters/sorting/matching never recompute it. */
export function baseRateFor(price: number, discount: unknown): number {
  const disc = Number(discount ?? 0) || 0;
  return Math.round(price * (1 - Math.min(100, Math.max(0, disc)) / 100) * 100) / 100;
}

/**
 * Request body → pending VendorRate columns.
 * `isCreate` seeds the fields D1 has no default for (quotedAt, attrValues).
 */
export function rateRowData(body: any, isCreate: boolean): { data: Record<string, unknown>; productId: string | null } {
  const data: Record<string, unknown> = {};
  let productId: string | null = null;
  if (body?.vendorId !== undefined || isCreate) {
    const v = str(body?.vendorId);
    if (!v) fail('vendor required');
    data.vendorId = v;
  }
  if (body?.productId !== undefined || isCreate) {
    const v = str(body?.productId);
    productId = v || null;
    data.productId = v || null;
  }
  if (body?.attrValues !== undefined) {
    const raw = body.attrValues;
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = String(k).trim().slice(0, 120);
      const val = String(v ?? '').trim().slice(0, 500);
      if (key && val) clean[key] = val;
    }
    data.attrValues = JSON.stringify(clean);
    data.attrKey = Object.entries(clean).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('|').slice(0, 2000);
  } else if (isCreate) {
    data.attrValues = '{}';
    data.attrKey = '';
  }
  if (body?.pricePerUnit !== undefined) data.pricePerUnit = numOrNull(body.pricePerUnit);
  if (body?.unit !== undefined) data.unit = str(body.unit, 120);
  if (body?.discountPercent !== undefined) {
    const d = numOrNull(body.discountPercent);
    if (d !== null && (d < 0 || d > 100)) fail('discount must be 0–100%');
    data.discountPercent = d;
  }
  if (body?.weightPerUnit !== undefined) data.weightPerUnit = numOrNull(body.weightPerUnit);
  if (body?.packageQty !== undefined) data.packageQty = str(body.packageQty, 300) || null;
  if (body?.packageDims !== undefined) data.packageDims = str(body.packageDims, 300) || null;
  if (body?.moq !== undefined) data.moq = str(body.moq, 300) || null;
  if (body?.deliveryDays !== undefined) {
    const dd = numOrNull(body.deliveryDays);
    data.deliveryDays = dd === null ? null : Math.max(0, Math.floor(dd));
  }
  if (body?.deliveryMaxDays !== undefined) {
    const dm = numOrNull(body.deliveryMaxDays);
    data.deliveryMaxDays = dm === null ? null : Math.max(0, Math.floor(dm));
  }
  // Quote media: vendor's item photo + manufacturing video (per quote, not product).
  if (body?.imageUrl !== undefined) data.imageUrl = mediaUrl(body.imageUrl);
  if (body?.videoUrl !== undefined) data.videoUrl = mediaUrl(body.videoUrl);
  if (body?.quotedAt !== undefined && String(body.quotedAt).trim()) {
    const t = new Date(String(body.quotedAt));
    if (isNaN(t.getTime())) fail('quoted date invalid');
    data.quotedAt = t.toISOString();
  } else if (isCreate) {
    // D1 has no column default — the shim only auto-fills createdAt/updatedAt.
    data.quotedAt = new Date().toISOString();
  }
  if (body?.enquiryRef !== undefined) data.enquiryRef = str(body.enquiryRef, 300) || null;
  if (body?.notes !== undefined) data.notes = str(body.notes, 2000) || null;
  // Bulk-import trace: the RateBatch this quote arrived in (mig 0160).
  if (body?.batchId !== undefined) data.batchId = str(body.batchId, 120) || null;
  if (body?.sourceRef !== undefined) data.sourceRef = str(body.sourceRef, 300) || null;
  if (body?.missingSpecs !== undefined) {
    const ms = Array.isArray(body.missingSpecs) ? body.missingSpecs.map(String).filter(Boolean).slice(0, 50) : [];
    data.missingSpecs = JSON.stringify(ms);
  }
  if (body?.active !== undefined) data.active = body.active !== false;
  return { data, productId };
}
