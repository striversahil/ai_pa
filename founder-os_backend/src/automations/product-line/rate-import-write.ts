// rate-import-write.ts — land a whole paste in a handful of D1 batches.
//
// The old path called `createRate()` once per row, so 300 quotes cost ~14 round
// trips each (vendor read + product read + INSERT + the shim's post-insert
// SELECT + a spec-index batch + 6 KV invalidations + 2 KV catalogue reads).
// Here the vendor rows, the quotes and their spec-index rows go out as plain
// statements in `db.batch()` chunks — no reads at all — and the cache wave runs
// ONCE for the distinct products instead of once per row.
//
// Validation is not re-implemented: every row still goes through
// `applySpecsToData` (the same `prepareRateSpecs`/`validateEnvelope` the drawer
// and the single-row writer use), so a pasted quote lands exactly what the form
// would produce. Failure attribution is preserved: a bad row fails alone.
import { getD1Database } from '../../shared/prisma-d1';
import { findLiveProduct, type LiveCatalog } from './catalog-live';
import { applySpecsToData } from './rate-specs';
import { baseRateFor, numOrNull, rateRowData } from './rate-row';
import {
  chunkPlannedRows,
  planRateRow,
  vendorInsertStatement,
  type SqlStatement,
} from './rate-import-plan';
import { touchedMany } from './write-common';

export interface WriteFailure {
  row: number;
  product?: string;
  vendor?: string;
  error: string;
}

export interface VendorDecisionInput {
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

export interface WriteImportInput {
  /** Raw paste rows (same objects the preview analysed). */
  rows: any[];
  /** Preview analyses, index-parallel to `rows`. */
  analyses: { ok: boolean; error?: string; productKey: string | null; vendor: string; price: number | null; unit: string }[];
  catalog: LiveCatalog;
  /** Master vendors keyed by LOWER-CASED name (the preview's own map). */
  knownVendors: Map<string, { id: string; name: string }>;
  decisions: Map<string, VendorDecisionInput>;
  batchId: string;
  label?: string | null;
  now?: string;
}

export interface WriteImportResult {
  created: number;
  failed: WriteFailure[];
  vendorsCreated: string[];
}

const text = (v: unknown, max = 500) => String(v ?? '').trim().slice(0, max);
const lower = (v: unknown) => text(v, 300).toLowerCase();

/** `db.batch()` of prepared statements — ONE round trip. */
async function runStatements(db: any, statements: SqlStatement[]): Promise<void> {
  if (!statements.length) return;
  await db.batch(statements.map((s) => db.prepare(s.sql).bind(...(s.params as any[]))));
}

/**
 * Create the vendors the operator approved (`create`), one batch.
 * A batch that fails is retried row-by-row so one bad vendor (e.g. a name that
 * raced into the master) cannot take the others down with it.
 */
async function createVendors(
  db: any,
  decisions: VendorDecisionInput[],
  known: Map<string, { id: string; name: string }>,
  now: string,
): Promise<{ created: Map<string, string>; names: string[]; errors: Map<string, string> }> {
  const created = new Map<string, string>();
  const names: string[] = [];
  const errors = new Map<string, string>();
  const pending = decisions.filter((d) => d.action === 'create' && d.name && !known.has(lower(d.name)));
  if (!pending.length) return { created, names, errors };

  const rows = pending.map((d) => {
    const id = crypto.randomUUID();
    created.set(lower(d.name), id);
    names.push(text(d.name, 300));
    return {
      id,
      name: text(d.name, 300),
      location: text(d.location, 300),
      contactPerson: text(d.contactPerson, 300),
      contactPhone1: text(d.contactPhone1, 120),
      contactPhone2: text(d.contactPhone2, 120),
      address: text(d.address, 1000),
      yearEstablished:
        d.yearEstablished === null || d.yearEstablished === undefined ? null : Math.floor(Number(d.yearEstablished)) || null,
      vendorType: text(d.vendorType, 120) || 'manufacturer',
      now,
    };
  });

  try {
    await runStatements(db, rows.map(vendorInsertStatement));
    return { created, names, errors };
  } catch {
    // Fall back to one-by-one so a single failure is attributed.
    for (const row of rows) {
      try {
        await runStatements(db, [vendorInsertStatement(row)]);
      } catch (e: any) {
        const key = lower(row.name);
        created.delete(key);
        const i = names.indexOf(row.name);
        if (i >= 0) names.splice(i, 1);
        errors.set(key, String(e?.message ?? 'could not create vendor').slice(0, 300));
      }
    }
    return { created, names, errors };
  }
}

/** Vendor id for a pasted name, or a thrown reason the row cannot land. */
function resolveVendorId(
  name: string,
  known: Map<string, { id: string; name: string }>,
  created: Map<string, string>,
  decisions: Map<string, VendorDecisionInput>,
  vendorErrors: Map<string, string>,
): string {
  const key = lower(name);
  const existing = known.get(key);
  if (existing) return existing.id;
  const fresh = created.get(key);
  if (fresh) return fresh;
  if (vendorErrors.has(key)) throw new Error(vendorErrors.get(key)!);
  const decision = decisions.get(key);
  if (decision?.action === 'skip') throw new Error('vendor skipped');
  if (decision?.action === 'map' && decision.vendorId) return String(decision.vendorId);
  throw new Error('vendor not confirmed — decide create or skip');
}

/** The body the single-row writer would have received for this paste row. */
function bodyForRow(row: any, input: { vendorId: string; productId: string | null; price: number | null; unit: string; batchId: string; label?: string | null }) {
  return {
    vendorId: input.vendorId,
    productId: input.productId,
    attrValues: row?.specs ?? row?.attrValues ?? row?.attributes ?? {},
    pricePerUnit: input.price,
    discountPercent: numOrNull(row?.discount_percent ?? row?.discountPercent),
    unit: input.unit,
    moq: row?.moq ?? null,
    weightPerUnit: numOrNull(row?.weight_per_unit ?? row?.weightPerUnit),
    packageQty: text(row?.package_qty ?? row?.packageQty, 300) || null,
    packageDims: text(row?.package_dims ?? row?.packageDims, 300) || null,
    deliveryDays: numOrNull(row?.delivery_days ?? row?.deliveryDays),
    deliveryMaxDays: numOrNull(row?.delivery_max_days ?? row?.deliveryMaxDays),
    quotedAt: text(row?.quoted_at ?? row?.quotedAt, 40) || undefined,
    enquiryRef: text(row?.enquiry_ref ?? row?.enquiryRef, 300) || null,
    notes: text(row?.notes, 2000) || null,
    imageUrl: text(row?.image_url ?? row?.imageUrl, 2000) || null,
    videoUrl: text(row?.video_url ?? row?.videoUrl, 2000) || null,
    active: row?.active === false ? false : true,
    batchId: input.batchId,
    sourceRef: input.label ? text(input.label, 200) : null,
  };
}

/**
 * Write every accepted row of a paste.
 * Returns what landed, what did not (with the reason) and which vendors were
 * created. Cache invalidation happens once at the end.
 */
export async function writeImportRows(input: WriteImportInput): Promise<WriteImportResult> {
  const db = getD1Database();
  const now = input.now ?? new Date().toISOString();
  const failed: WriteFailure[] = [];

  // 1. Vendors first — quotes reference them, and the id has to exist.
  const { created: createdVendors, names: vendorsCreated, errors: vendorErrors } = await createVendors(
    db,
    [...input.decisions.values()],
    input.knownVendors,
    now,
  );

  // 2. Build + validate every row (same typechecker as the drawer).
  const planned: { index: number; statements: SqlStatement[] }[] = [];
  const plannedRows = new Map<number, { product?: string; vendor: string; productId: string | null }>();
  for (let i = 0; i < input.rows.length; i += 1) {
    const row = input.rows[i];
    const analysis = input.analyses[i];
    const rowNo = i + 1;
    if (!analysis?.ok) {
      failed.push({ row: rowNo, product: analysis?.productKey ?? undefined, vendor: analysis?.vendor ?? '', error: analysis?.error ?? 'invalid row' });
      continue;
    }
    const product = analysis.productKey ? findLiveProduct(input.catalog, { key: analysis.productKey }) : null;
    try {
      const vendorId = resolveVendorId(analysis.vendor, input.knownVendors, createdVendors, input.decisions, vendorErrors);
      const body = bodyForRow(row, {
        vendorId,
        productId: product?.id ?? null,
        price: analysis.price ?? numOrNull(row?.price_per_unit ?? row?.pricePerUnit ?? row?.price),
        unit: analysis.unit ?? '',
        batchId: input.batchId,
        label: input.label ?? null,
      });
      const { data, productId } = rateRowData(body, true);
      if (body.pricePerUnit !== undefined && body.pricePerUnit !== null) {
        const price = Number(body.pricePerUnit);
        if (Number.isFinite(price)) data.baseRate = baseRateFor(price, body.discountPercent);
      }
      // Schema typecheck + missingSpecs, exactly as createRate would.
      await applySpecsToData(data, String(productId ?? ''), body, true, input.catalog);
      data.id = crypto.randomUUID();
      data.createdAt = now;
      data.updatedAt = now;
      const id = String(data.id);
      planned.push(planRateRow({ index: rowNo, id, data }, now));
      plannedRows.set(rowNo, { product: analysis.productKey ?? undefined, vendor: analysis.vendor, productId });
    } catch (e: any) {
      failed.push({
        row: rowNo,
        product: analysis.productKey ?? undefined,
        vendor: analysis.vendor,
        error: String(e?.message ?? 'could not prepare the row').slice(0, 300),
      });
    }
  }

  // 3. One batch per chunk of statements; a failed chunk retries row-by-row so
  //    the reason lands on the quote that caused it.
  let created = 0;
  for (const chunk of chunkPlannedRows(planned)) {
    try {
      await runStatements(db, chunk.flatMap((r) => r.statements));
      created += chunk.length;
    } catch {
      for (const rowPlan of chunk) {
        try {
          await runStatements(db, rowPlan.statements);
          created += 1;
        } catch (e: any) {
          const meta = plannedRows.get(rowPlan.index);
          failed.push({
            row: rowPlan.index,
            product: meta?.product,
            vendor: meta?.vendor ?? '',
            error: String(e?.message ?? 'could not import').slice(0, 300),
          });
        }
      }
    }
  }

  // 4. ONE cache wave for the distinct products (not once per row).
  const productIds = [...new Set([...plannedRows.values()].map((m) => m.productId).filter(Boolean))] as string[];
  if (created || vendorsCreated.length) await touchedMany(productIds).catch(() => {});

  failed.sort((a, b) => a.row - b.row);
  return { created, failed, vendorsCreated };
}
