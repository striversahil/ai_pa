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
import { writeImportRows } from './rate-import-write';
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
async function validateRow(product: LiveProduct, row: any, catalog?: LiveCatalog | null): Promise<{ price: number; unit: string }> {
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
  }, catalog);
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
      const checked = await validateRow(product, row, catalog);
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
  // The preview already resolved + typechecked every row; the write pass trusts
  // its analysis but re-validates specs through the same catalogue snapshot so
  // a quote can never land untyped.
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

  // ONE catalogue read + ONE vendor read for the whole paste (they used to be
  // per row), then every INSERT goes out in a handful of D1 batches.
  const [catalog, known] = await Promise.all([getLiveCatalog(), existingVendors()]);
  const written = await writeImportRows({
    rows,
    analyses: preview.rows.map((r) => ({
      ok: r.ok,
      error: r.error,
      productKey: r.productKey,
      vendor: r.vendor,
      price: r.price,
      unit: r.unit,
    })),
    catalog,
    knownVendors: known,
    decisions,
    batchId,
    label: opts.label ?? null,
  });

  const vendorNames = [...new Set([...preview.matchedVendors.map((m) => m.name), ...preview.newVendors.map((v) => v.name)])];
  await finishBatch(batchId, {
    createdCount: written.created,
    failedCount: written.failed.length,
    vendorNames,
    failures: written.failed,
  });

  return {
    batchId,
    created: written.created,
    failed: written.failed,
    vendorsCreated: written.vendorsCreated,
    total: preview.total,
  };
}
