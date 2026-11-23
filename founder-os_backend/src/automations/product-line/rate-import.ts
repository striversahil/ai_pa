// rate-import.ts — paste a JSON block from a chat agent and land typed quotes.
//
// Two phases (founder decision 2026-11-23 v3):
//   1. previewImport()  — resolve every row, typecheck it, name the vendors that
//                         would have to be CREATED. Writes nothing.
//   2. importRates()    — take the user's vendor decisions (create / map / skip,
//                         with fully edited fields), create those vendors, write
//                         the quotes under ONE RateBatch so the paste is undoable.
//
// The agent is told to pick `vendor` from ACTIVE VENDORS and to set
// `is_new_vendor: true` only when it had to invent one; a name that matches an
// existing vendor is always treated as matched, whatever the flag says.
import { prisma } from '../../shared/prisma';
import { getLiveCatalog, findLiveProduct, type LiveCatalog, type LiveProduct } from './catalog-live';
import { UNIT_ENUM } from './kyp-schema';
import { prepareRateSpecs } from './rate-specs';
import { createRate } from './update';
import { createBatch, finishBatch } from './rate-batch';
import { extractJsonPayload, rowsOf } from './rate-import-parse';

export { extractJsonPayload, rowsOf };

export const IMPORT_MAX_ROWS = 500;

export interface ImportFailure {
  row: number;
  product?: string;
  vendor?: string;
  error: string;
}

/** What one row looks like before anything is written. */
export interface ImportRowAnalysis {
  index: number;
  productKey: string | null;
  productLabel: string | null;
  vendor: string;
  /** The agent had to invent this vendor (and it is not in the master either). */
  isNewVendor: boolean;
  vendorId: string | null;
  price: number | null;
  unit: string;
  ok: boolean;
  error?: string;
}

/** A vendor the paste would create — every field edited before it lands. */
export interface NewVendorCandidate {
  name: string;
  location: string;
  contactPerson: string;
  contactPhone1: string;
  contactPhone2: string;
  address: string;
  yearEstablished: number | null;
  vendorType: string;
  /** Rows in this paste that reference it. */
  rows: number;
  /** Exactly as the agent flagged it. */
  isNewVendor: boolean;
}

export interface ImportPreview {
  total: number;
  rows: ImportRowAnalysis[];
  newVendors: NewVendorCandidate[];
  matchedVendors: { name: string; vendorId: string; rows: number }[];
  okCount: number;
  errorCount: number;
}

export interface VendorDecision {
  name: string;
  action: 'create' | 'map' | 'skip';
  vendorId?: string;
  location?: string;
  contactPerson?: string;
  contactPhone1?: string;
  contactPhone2?: string;
  address?: string;
  yearEstablished?: number | null;
  vendorType?: string;
}

export interface ImportResult {
  batchId: string;
  created: number;
  failed: ImportFailure[];
  vendorsCreated: string[];
  total: number;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function text(v: unknown, max = 500): string {
  return String(v ?? '').trim().slice(0, max);
}

const rowVendor = (row: any) => text(row?.vendor ?? row?.vendor_name ?? row?.vendorName, 300);

/** Resolve `product_key|product|product_name` against the live catalogue. */
function resolveProduct(catalog: LiveCatalog, row: any): LiveProduct {
  const ref = text(row?.product_key ?? row?.productKey ?? row?.product ?? row?.product_name, 120);
  if (!ref) throw new Error('product_key missing');
  const direct = findLiveProduct(catalog, { key: ref, id: ref, name: ref });
  if (direct) return direct;
  const needle = ref.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const aliasHit = catalog.products.find(
    (p) =>
      p.aliases.some((a) => a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === needle) ||
      p.label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === needle,
  );
  if (aliasHit) return aliasHit;
  throw new Error(`unknown product "${ref}" — use one of the schema product_key values`);
}

/** Everything the row must satisfy, checked WITHOUT writing anything. */
async function validateRow(product: LiveProduct, row: any): Promise<{ price: number; unit: string }> {
  const unit = text(row?.unit, 120);
  if (unit && !(UNIT_ENUM as readonly string[]).includes(unit)) {
    throw new Error(`unit "${unit}" is not allowed — use one of: ${(UNIT_ENUM as readonly string[]).join(', ')}`);
  }
  const price = num(row?.price_per_unit ?? row?.pricePerUnit ?? row?.price);
  if (price === null || price <= 0) throw new Error('price_per_unit must be a positive number');
  const disc = num(row?.discount_percent ?? row?.discountPercent) ?? 0;
  if (disc < 0 || disc > 100) throw new Error('discount_percent must be 0–100');
  const delivery = num(row?.delivery_days ?? row?.deliveryDays);
  const deliveryMax = num(row?.delivery_max_days ?? row?.deliveryMaxDays);
  if (delivery !== null && deliveryMax !== null && deliveryMax < delivery) {
    throw new Error('delivery_max_days must be greater than or equal to delivery_days');
  }
  const specs = row?.specs ?? row?.attrValues ?? row?.attributes ?? {};
  if (typeof specs !== 'object' || Array.isArray(specs)) throw new Error('specs must be an object of spec_key → value');
  // The spec contract is the same one the drawer validates against.
  await prepareRateSpecs(product.id, specs, {
    unit,
    moq: row?.moq ?? null,
    pricePerUnit: price,
    discountPercent: disc,
    deliveryDays: delivery,
    deliveryMaxDays: deliveryMax,
    quotedAt: text(row?.quoted_at ?? row?.quotedAt, 40) || undefined,
  });
  return { price, unit };
}

async function existingVendors(): Promise<Map<string, { id: string; name: string }>> {
  const list = await (prisma as any).vendor.findMany({ select: { id: true, name: true } }).catch(() => []);
  const map = new Map<string, { id: string; name: string }>();
  for (const v of (list ?? []) as any[]) {
    map.set(String(v.name).trim().toLowerCase(), { id: String(v.id), name: String(v.name) });
  }
  return map;
}

/**
 * Resolve + typecheck every row and name the vendors that would be created.
 * Never writes. This is what the review step shows.
 */
export async function previewImport(payload: unknown): Promise<ImportPreview> {
  const rows = rowsOf(payload);
  if (!rows.length) throw new Error('no rows found in the payload');
  if (rows.length > IMPORT_MAX_ROWS) {
    throw new Error(`too many rows (${rows.length}) — one paste is capped at ${IMPORT_MAX_ROWS}`);
  }
  const catalog = await getLiveCatalog();
  const known = await existingVendors();
  const newVendors = new Map<string, NewVendorCandidate>();
  const matched = new Map<string, { name: string; vendorId: string; rows: number }>();
  const out: ImportRowAnalysis[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const vendorName = rowVendor(row);
    const hit = vendorName ? known.get(vendorName.toLowerCase()) : undefined;
    const flaggedNew = row?.is_new_vendor === true || row?.isNewVendor === true;
    let productKey: string | null = null;
    let productLabel: string | null = null;
    let price: number | null = num(row?.price_per_unit ?? row?.pricePerUnit ?? row?.price);
    let unit = text(row?.unit, 120);
    let error: string | undefined;

    try {
      const product = resolveProduct(catalog, row);
      productKey = product.key;
      productLabel = product.label;
      if (!vendorName) throw new Error('vendor missing');
      if (hit) {
        const m = matched.get(hit.name.toLowerCase()) ?? { name: hit.name, vendorId: hit.id, rows: 0 };
        m.rows += 1;
        matched.set(hit.name.toLowerCase(), m);
      } else {
        if (!flaggedNew) {
          throw new Error(
            `vendor "${vendorName}" is not in the master and the agent did not mark it is_new_vendor — add it in the Vendors tab or re-run the prompt`,
          );
        }
        const key = vendorName.toLowerCase();
        const cand = newVendors.get(key) ?? {
          name: vendorName,
          location: text(row?.vendor_location ?? row?.location, 300),
          contactPerson: text(row?.contact_person ?? row?.contactPerson, 300),
          contactPhone1: text(row?.contact_number_1 ?? row?.contactPhone1 ?? row?.phone, 120),
          contactPhone2: text(row?.contact_number_2 ?? row?.contactPhone2, 120),
          address: text(row?.address, 1000),
          yearEstablished: num(row?.year_of_establishment ?? row?.yearEstablished),
          vendorType: text(row?.vendor_type ?? row?.vendorType, 120) || 'manufacturer',
          rows: 0,
          isNewVendor: true,
        };
        cand.rows += 1;
        newVendors.set(key, cand);
      }
      const checked = await validateRow(product, row);
      price = checked.price;
      unit = checked.unit;
    } catch (e: any) {
      error = String(e?.message ?? 'could not read the row').slice(0, 300);
    }

    out.push({
      index: i + 1,
      productKey,
      productLabel,
      vendor: vendorName,
      isNewVendor: !hit && (flaggedNew || !!error),
      vendorId: hit?.id ?? null,
      price,
      unit,
      ok: !error,
      ...(error ? { error } : {}),
    });
  }

  return {
    total: rows.length,
    rows: out,
    newVendors: [...newVendors.values()],
    matchedVendors: [...matched.values()],
    okCount: out.filter((r) => r.ok).length,
    errorCount: out.filter((r) => !r.ok).length,
  };
}

function decisionKey(name: string): string {
  return String(name ?? '').trim().toLowerCase();
}

/**
 * Land the paste. Vendors are created only from an explicit `create` decision
 * (with the user's edited fields) — nothing is invented on the operator's behalf.
 */
export async function importRates(
  payload: unknown,
  opts: {
    vendors?: VendorDecision[];
    label?: string;
    actor?: { id?: string | null; name?: string | null };
    source?: string;
  } = {},
): Promise<ImportResult> {
  const preview = await previewImport(payload);
  const rows = rowsOf(payload);
  const decisions = new Map<string, VendorDecision>();
  for (const d of opts.vendors ?? []) {
    if (d?.name) decisions.set(decisionKey(d.name), d);
  }

  const batchId = await createBatch({
    source: opts.source ?? 'ai_paste',
    actorId: opts.actor?.id ?? null,
    actorName: opts.actor?.name ?? null,
    label: opts.label ?? null,
    rowCount: preview.total,
  });

  const vendorCache = new Map<string, string>();
  const created: string[] = [];
  const vendorsCreated: string[] = [];
  const failed: ImportFailure[] = [];
  let createdCount = 0;

  /** name → vendorId, or a thrown reason the row is skipped. */
  const vendorIdFor = async (name: string): Promise<string> => {
    const key = decisionKey(name);
    const cached = vendorCache.get(key);
    if (cached) return cached;
    const decision = decisions.get(key);
    const known = await (prisma as any).vendor.findFirst({ where: { name } }).catch(() => null);
    if (known) {
      vendorCache.set(key, String(known.id));
      return String(known.id);
    }
    if (!decision || decision.action === 'skip') {
      throw new Error(decision?.action === 'skip' ? 'vendor skipped' : 'vendor not confirmed — decide create or skip');
    }
    if (decision.action === 'map') {
      if (!decision.vendorId) throw new Error('map decision needs a vendorId');
      vendorCache.set(key, String(decision.vendorId));
      return String(decision.vendorId);
    }
    const row = await (prisma as any).vendor.create({
      data: {
        name: text(decision.name, 300),
        location: text(decision.location, 300) || null,
        contactPerson: text(decision.contactPerson, 300) || null,
        contactPhone1: text(decision.contactPhone1, 120) || null,
        contactPhone2: text(decision.contactPhone2, 120) || null,
        address: text(decision.address, 1000) || null,
        yearEstablished:
          decision.yearEstablished === null || decision.yearEstablished === undefined
            ? null
            : Math.floor(Number(decision.yearEstablished)) || null,
        vendorType: text(decision.vendorType, 120) || 'manufacturer',
        active: true,
      },
    });
    const id = String((row as any).id);
    vendorCache.set(key, id);
    vendorsCreated.push(text(decision.name, 300));
    created.push(id);
    return id;
  };

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const analysis = preview.rows[i];
    if (!analysis.ok) {
      failed.push({ row: i + 1, product: analysis.productKey ?? undefined, vendor: analysis.vendor, error: analysis.error ?? 'invalid row' });
      continue;
    }
    try {
      const vendorId = await vendorIdFor(analysis.vendor);
      await createRate({
        vendorId,
        productId: analysis.productKey ? resolveProduct(await getLiveCatalog(), row).id : null,
        attrValues: row?.specs ?? row?.attrValues ?? row?.attributes ?? {},
        pricePerUnit: analysis.price,
        discountPercent: num(row?.discount_percent ?? row?.discountPercent),
        unit: analysis.unit,
        moq: row?.moq ?? null,
        weightPerUnit: num(row?.weight_per_unit ?? row?.weightPerUnit),
        packageQty: text(row?.package_qty ?? row?.packageQty, 300) || null,
        packageDims: text(row?.package_dims ?? row?.packageDims, 300) || null,
        deliveryDays: num(row?.delivery_days ?? row?.deliveryDays),
        deliveryMaxDays: num(row?.delivery_max_days ?? row?.deliveryMaxDays),
        quotedAt: text(row?.quoted_at ?? row?.quotedAt, 40) || undefined,
        enquiryRef: text(row?.enquiry_ref ?? row?.enquiryRef, 300) || null,
        notes: text(row?.notes, 2000) || null,
        imageUrl: text(row?.image_url ?? row?.imageUrl, 2000) || null,
        videoUrl: text(row?.video_url ?? row?.videoUrl, 2000) || null,
        active: row?.active === false ? false : true,
        batchId,
        sourceRef: opts.label ? text(opts.label, 200) : null,
      });
      createdCount += 1;
    } catch (e: any) {
      failed.push({
        row: i + 1,
        product: analysis.productKey ?? undefined,
        vendor: analysis.vendor,
        error: String(e?.message ?? 'could not import').slice(0, 300),
      });
    }
  }

  const vendorNames = [...new Set([...preview.matchedVendors.map((m) => m.name), ...preview.newVendors.map((v) => v.name)])];
  await finishBatch(batchId, {
    createdCount,
    failedCount: failed.length,
    vendorNames,
    failures: failed,
  });

  return { batchId, created: createdCount, failed, vendorsCreated, total: preview.total };
}
