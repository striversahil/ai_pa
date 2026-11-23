// rate-specs.ts — one place where a vendor quote meets the KYP schema.
//
// Writes go through here so that (a) specs are typechecked against the
// product's schema branch, (b) `missingSpecs` always names every required spec
// AND envelope field that is still empty (founder call 2026-11-23: leave them
// empty until filled, never invent a value), and (c) the typed spec index stays
// in sync with the JSON document.
import { prisma } from '../../shared/prisma-d1';
import { resolveProductKey, validateEnvelope, validateSpecsFor, kypProduct, type EnvelopeInput, type SpecValue } from './kyp-schema';
import { findLiveProduct, getLiveCatalog } from './catalog-live';
import { clearSpecIndex, syncSpecIndex } from './spec-index';
import { missingFieldsFor } from './service-parts/missing';

export interface PreparedSpecs {
  /** JSON text for VendorRate.attrValues (the single truth). */
  attrValues: string;
  /** Canonical `k= v|k=v` snapshot used by the matcher. */
  attrKey: string;
  /** JSON array text for VendorRate.missingSpecs. */
  missingSpecs: string;
  specs: Record<string, SpecValue>;
  productKey: string | null;
}

function productIdOf(row: any, fallback: unknown): string {
  return String(row?.productId ?? fallback ?? '');
}

/** Product row lookup so a hand-added product still typechecks by its name. */
async function productName(productId: string): Promise<string | null> {
  if (!productId) return null;
  const row = await (prisma as any).productItem.findUnique({ where: { id: productId } }).catch(() => null);
  return row?.name ? String(row.name) : null;
}

/**
 * Validate + normalise a quote payload. Throws a plain Error (→ HTTP 400 via
 * writeError) on a schema violation; unknown envelope gaps are only reported.
 */
export async function prepareRateSpecs(
  productId: string,
  rawAttrValues: unknown,
  envelope: EnvelopeInput = {},
): Promise<PreparedSpecs> {
  // The LIVE catalogue (D1) is the contract — edits in the dashboard take effect
  // immediately; the compiled seed is only the import snapshot.
  const catalog = await getLiveCatalog();
  const live = findLiveProduct(catalog, { id: productId });
  const compiledKey = live ? null : resolveProductKey(productId, await productName(productId));
  const product = live ?? kypProduct(compiledKey);
  const key = product?.key ?? null;
  const check = validateSpecsFor(product, rawAttrValues);
  if (!check.ok) throw new Error(check.errors[0].message);

  const env = validateEnvelope(envelope);
  if (env.errors.length) throw new Error(env.errors[0].message);

  const label = (k: string) => product?.props[k]?.label ?? k;
  const missing = [
    ...check.missing.map(label),
    ...env.missing.map((m) => m.replace(/_/g, ' ')),
  ];

  const specs = check.specs;
  const attrKey = Object.keys(specs)
    .sort()
    .map((k) => `${k}=${String(specs[k])}`)
    .join('|')
    .slice(0, 2000);

  return {
    attrValues: JSON.stringify(specs),
    attrKey,
    missingSpecs: JSON.stringify([...new Set(missing)].slice(0, 50)),
    specs,
    productKey: key,
  };
}

/** Keep the typed index in step with a quote row (one D1 batch). */
export async function syncRateSpecs(rateId: string, prepared: PreparedSpecs): Promise<void> {
  try {
    await syncSpecIndex(rateId, prepared.specs);
  } catch {
    /* the JSON document stays authoritative; the index can be rebuilt */
  }
}

/** Re-index an existing row (used when only the product/quote changes). */
export async function reindexRate(rateId: string, row: any): Promise<void> {
  try {
    let specs: Record<string, unknown> = {};
    const raw = row?.attrValues;
    if (typeof raw === 'string' && raw.trim()) specs = JSON.parse(raw);
    else if (raw && typeof raw === 'object') specs = raw as Record<string, unknown>;
    await syncSpecIndex(rateId, specs);
  } catch {
    /* best-effort */
  }
}

export async function dropRateSpecs(rateId: string): Promise<void> {
  try {
    await clearSpecIndex(rateId);
  } catch {
    /* best-effort */
  }
}

/** `data` wins over the raw body when the field was explicitly written. */
function pick(data: any, body: any, key: string): unknown {
  return data && key in data ? data[key] : body?.[key];
}

/**
 * Mutate a pending VendorRate row so its spec document is schema-clean, and
 * return the prepared snapshot for the index sync. Call AFTER the row's
 * productId/prices are known and BEFORE the D1 write.
 */
export async function applySpecsToData(
  data: any,
  productId: string,
  body: any,
  strict = true,
): Promise<PreparedSpecs> {
  let raw: unknown = {};
  if (body?.attrValues !== undefined) raw = body.attrValues;
  else if (data?.attrValues) {
    try {
      raw = JSON.parse(String(data.attrValues));
    } catch {
      raw = {};
    }
  }
  if (!strict) {
    // Partial edit (price/notes only): keep the stored document untouched so a
    // legacy or hand-written quote never blocks an unrelated field update.
    const specs = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, SpecValue>;
    return {
      attrValues: String(data?.attrValues ?? JSON.stringify(specs)),
      attrKey: String(data?.attrKey ?? ''),
      missingSpecs: String(data?.missingSpecs ?? '[]'),
      specs,
      productKey: null,
    };
  }
  const prepared = await prepareRateSpecs(productId, raw, {
    unit: pick(data, body, 'unit'),
    moq: pick(data, body, 'moq'),
    pricePerUnit: pick(data, body, 'pricePerUnit'),
    discountPercent: pick(data, body, 'discountPercent'),
    deliveryDays: pick(data, body, 'deliveryDays'),
    deliveryMaxDays: pick(data, body, 'deliveryMaxDays'),
    quotedAt: pick(data, body, 'quotedAt'),
  });
  data.attrValues = prepared.attrValues;
  data.attrKey = prepared.attrKey;
  data.missingSpecs = prepared.missingSpecs;
  return prepared;
}

/**
 * Re-fill `missingSpecs` for every quote of one product.
 *
 * Needed when the REQUIRED list changes: a spec made required two minutes ago
 * turns existing complete quotes into incomplete ones, and the sheet's
 * `incomplete` filter reads the stored column. Runs in small parallel batches
 * (largest product ≈ 2.4k quotes) and only writes rows whose label list moved.
 */
export async function refreshMissingSpecs(productId: string): Promise<{ updated: number }> {
  if (!productId) return { updated: 0 };
  const catalog = await getLiveCatalog();
  const product = findLiveProduct(catalog, { id: productId });
  if (!product) return { updated: 0 };
  const rows = await (prisma as any).vendorRate
    .findMany({
      where: { productId },
      select: {
        id: true,
        attrValues: true,
        missingSpecs: true,
        unit: true,
        moq: true,
        pricePerUnit: true,
        deliveryDays: true,
        quotedAt: true,
      },
    })
    .catch(() => []);
  const dirty: { id: string; missingSpecs: string }[] = [];
  for (const row of (rows ?? []) as any[]) {
    const next = JSON.stringify([...new Set(missingFieldsFor(row, product))].slice(0, 50));
    if (next === String(row.missingSpecs ?? '[]')) continue;
    dirty.push({ id: String(row.id), missingSpecs: next });
  }
  let updated = 0;
  for (let i = 0; i < dirty.length; i += 40) {
    const chunk = dirty.slice(i, i + 40);
    await Promise.all(
      chunk.map((d) =>
        (prisma as any).vendorRate
          .update({ where: { id: d.id }, data: { missingSpecs: d.missingSpecs } })
          .then(() => { updated += 1; })
          .catch(() => {}),
      ),
    );
  }
  return { updated };
}
