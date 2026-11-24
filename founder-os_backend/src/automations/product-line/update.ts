import { prisma } from '../../shared/prisma';
import {
  fail,
  parseAliasesInput,
  slugAttrKey,
  str,
  touched,
  touchedGuide,
} from './write-common';
import {
  invalidateProductDetailCache,
  invalidateProductRatesCache,
} from './service';
import { dropRateSpecs, applySpecsToData, syncRateSpecs, refreshMissingSpecs } from './rate-specs';
import { baseRateFor, rateRowData } from './rate-row';
import {
  assertGuideDeletable,
  guideTypedData,
  normalizeDefaultValue,
  productKeyFor,
} from './catalog-write';

export { slugAttrKey };

/** Enum members out of a stored/offered `enumJson` column. */
function enumList(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return String(json).split(',').map((x) => x.trim()).filter(Boolean);
  }
}

const hasDefault = (body: any) => body?.default !== undefined || body?.defaultValue !== undefined;

// ── Products ────────────────────────────────────────────────────────────────
export async function createProduct(body: any): Promise<any> {
  const category = str(body?.category, 120);
  const name = str(body?.name, 300);
  if (!category) fail('category required');
  if (!name) fail('product name required');
  const dup = await (prisma as any).productItem.findUnique({ where: { name } }).catch(() => null);
  if (dup) fail(`product "${name}" already exists`);
  const createData: Record<string, unknown> = {
    category,
    name,
    key: productKeyFor(body, name),
    aliases: parseAliasesInput(body?.aliases) ?? '[]',
    active: body?.active === false ? false : true,
  };
  const row = await (prisma as any).productItem.create({ data: createData });
  await touched();
  return row;
}

export async function updateProduct(id: string, body: any): Promise<any> {
  const data: Record<string, unknown> = {};
  if (body?.category !== undefined) {
    const v = str(body.category, 120);
    if (!v) fail('category required');
    data.category = v;
  }
  if (body?.name !== undefined) {
    const v = str(body.name, 300);
    if (!v) fail('product name required');
    const dup = await (prisma as any).productItem.findUnique({ where: { name: v } }).catch(() => null);
    if (dup && String((dup as any).id) !== String(id)) fail(`product "${v}" already exists`);
    data.name = v;
  }
  const aliases = parseAliasesInput(body?.aliases);
  if (aliases !== null) data.aliases = aliases;
  if (body?.key !== undefined) data.key = productKeyFor(body, String(body?.name ?? ''));
  if (body?.active !== undefined) data.active = body.active !== false;
  if (Object.keys(data).length === 0) fail('nothing to update');
  const row = await (prisma as any).productItem.update({ where: { id: String(id) }, data });
  await touched(String(id));
  return row;
}

export async function deleteProduct(id: string): Promise<{ ok: true }> {
  const pid = String(id);
  const rates = await (prisma as any).vendorRate.findMany({ where: { productId: pid }, select: { id: true } }).catch(() => []);
  if ((rates as any[]).length > 0) fail(`cannot delete — ${ (rates as any[]).length } vendor rate(s) reference this product (unlink them first)`);
  await (prisma as any).kypGuide.deleteMany({ where: { productId: pid } });
  await (prisma as any).productItem.delete({ where: { id: pid } });
  await touched(pid);
  return { ok: true };
}

// ── Guide ───────────────────────────────────────────────────────────────────
export async function createGuide(body: any): Promise<any> {
  const productId = str(body?.productId);
  const question = str(body?.question, 2000);
  if (!productId) fail('productId required');
  if (!question) fail('question required');
  const product = await (prisma as any).productItem.findUnique({ where: { id: productId } }).catch(() => null);
  if (!product) fail('product not found');
  const existing = await (prisma as any).kypGuide.findMany({ where: { productId }, select: { attrKey: true, sortOrder: true } }).catch(() => []);
  const taken = new Set(((existing as any[]) ?? []).map((g) => String(g.attrKey)));
  const maxOrder = Math.max(-1, ...(((existing as any[]) ?? []).map((g) => Number(g.sortOrder ?? 0))));
  const typed = guideTypedData(body, true);
  const defaultValue = hasDefault(body)
    ? normalizeDefaultValue(body?.default ?? body?.defaultValue, { type: typed.type, enum: enumList(typed.enumJson) })
    : undefined;
  const row = await (prisma as any).kypGuide.create({
    data: {
      productId,
      attrKey: slugAttrKey(question, taken),
      question,
      guideNote: body?.guideNote !== undefined ? str(body.guideNote, 2000) || null : null,
      sortOrder: body?.sortOrder !== undefined ? Math.max(0, Math.floor(Number(body.sortOrder) || 0)) : maxOrder + 1,
      isRequired: body?.isRequired === false ? false : true,
      condition: body?.condition !== undefined && body.condition !== null
        ? (typeof body.condition === 'string' ? body.condition : JSON.stringify(body.condition)).slice(0, 2000)
        : null,
      ...typed,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      active: body?.active === false ? false : true,
    },
  });
  await touchedGuide(undefined, productId);
  // A new required spec turns existing quotes incomplete — keep the stored
  // `missingSpecs` (what the sheet's incomplete filter reads) honest.
  if (row?.isRequired) await refreshMissingSpecs(productId).catch(() => {});
  return row;
}

export async function updateGuide(id: string, body: any): Promise<any> {
  const data: Record<string, unknown> = {};
  // NOTE: attrKey is immutable by design (VendorRate keys off it) — edits
  // change the question text only. To rename the key, delete + re-add.
  if (body?.question !== undefined) {
    const v = str(body.question, 2000);
    if (!v) fail('question required');
    data.question = v;
  }
  if (body?.guideNote !== undefined) data.guideNote = str(body.guideNote, 2000) || null;
  if (body?.sortOrder !== undefined) data.sortOrder = Math.max(0, Math.floor(Number(body.sortOrder) || 0));
  if (body?.isRequired !== undefined) data.isRequired = body.isRequired !== false;
  if (body?.condition !== undefined) {
    data.condition = body.condition === null ? null
      : (typeof body.condition === 'string' ? body.condition : JSON.stringify(body.condition)).slice(0, 2000);
  }
  if (body?.active !== undefined) data.active = body.active !== false;
  const typed = guideTypedData(body, false);
  Object.assign(data, typed);
  if (hasDefault(body)) {
    // The enum may come from this request or from the stored row; validating
    // against the merge keeps a selector-only edit from inventing a value.
    const cur = await (prisma as any).kypGuide.findUnique({ where: { id: String(id) } }).catch(() => null);
    const type = typed.type ?? String((cur as any)?.type ?? 'string');
    const enums = typed.enumJson !== undefined ? enumList(typed.enumJson) : enumList((cur as any)?.enumJson);
    data.defaultValue = normalizeDefaultValue(body?.default ?? body?.defaultValue, { type, enum: enums });
  }
  if (Object.keys(data).length === 0) fail('nothing to update');
  const row = await (prisma as any).kypGuide.update({ where: { id: String(id) }, data });
  await touchedGuide(String(id));
  if (body?.isRequired !== undefined) {
    await refreshMissingSpecs(String((row as any)?.productId ?? '')).catch(() => {});
  }
  return row;
}

export async function deleteGuide(id: string): Promise<{ ok: true }> {
  const gid = String(id);
  // Capture the product BEFORE deleting — after the delete the lookup finds
  // nothing and the product's detail/rates caches stay stale (deleted rows
  // keep showing in an open product view: "delete is not working").
  const cur = await (prisma as any).kypGuide.findUnique({ where: { id: gid } }).catch(() => null);
  // Deleting a spec that live quotes still answer is blocked, with the count
  // (founder decision 2026-11-23) — the UI surfaces this message verbatim.
  await assertGuideDeletable(cur);
  await (prisma as any).kypGuide.delete({ where: { id: gid } });
  await touchedGuide(undefined, (cur as any)?.productId);
  return { ok: true };
}

// ── Vendors ─────────────────────────────────────────────────────────────────
export async function createVendor(body: any): Promise<any> {
  const name = str(body?.name, 300);
  if (!name) fail('vendor name required');
  const dup = await (prisma as any).vendor.findUnique({ where: { name } }).catch(() => null);
  if (dup) fail(`vendor "${name}" already exists`);
  const row = await (prisma as any).vendor.create({
    data: {
      name,
      contactPerson: body?.contactPerson !== undefined ? str(body.contactPerson, 300) || null : null,
      contactPhone1: body?.contactPhone1 !== undefined ? str(body.contactPhone1, 120) || null : null,
      contactPhone2: body?.contactPhone2 !== undefined ? str(body.contactPhone2, 120) || null : null,
      location: body?.location !== undefined ? str(body.location, 300) || null : null,
      address: body?.address !== undefined ? str(body.address, 1000) || null : null,
      yearEstablished: body?.yearEstablished !== undefined && body.yearEstablished !== null && body.yearEstablished !== ''
        ? Math.floor(Number(body.yearEstablished)) || null
        : null,
      vendorType: body?.vendorType !== undefined ? str(body.vendorType, 120) : '',
      active: body?.active === false ? false : true,
    },
  });
  await touched();
  return row;
}

export async function updateVendor(id: string, body: any): Promise<any> {
  const data: Record<string, unknown> = {};
  if (body?.name !== undefined) {
    const v = str(body.name, 300);
    if (!v) fail('vendor name required');
    const dup = await (prisma as any).vendor.findUnique({ where: { name: v } }).catch(() => null);
    if (dup && String((dup as any).id) !== String(id)) fail(`vendor "${v}" already exists`);
    data.name = v;
  }
  for (const f of ['contactPerson', 'contactPhone1', 'contactPhone2', 'location', 'address', 'vendorType'] as const) {
    if ((body as any)?.[f] !== undefined) data[f] = str((body as any)[f], f === 'address' ? 1000 : 300) || null;
  }
  if (body?.yearEstablished !== undefined) {
    data.yearEstablished = body.yearEstablished === null || body.yearEstablished === ''
      ? null
      : Math.floor(Number(body.yearEstablished)) || null;
  }
  if (body?.active !== undefined) data.active = body.active !== false;
  if (Object.keys(data).length === 0) fail('nothing to update');
  const row = await (prisma as any).vendor.update({ where: { id: String(id) }, data });
  await touched();
  return row;
}

export async function deleteVendor(id: string): Promise<{ ok: true }> {
  // Hard delete: the row is gone. Blocked while any rate references it
  // (delete those rates first) — same guard as deleteProduct.
  const vid = String(id);
  const rates = await (prisma as any).vendorRate.findMany({ where: { vendorId: vid }, select: { id: true } }).catch(() => []);
  if ((rates as any[]).length > 0) fail(`cannot delete — ${(rates as any[]).length} vendor rate(s) reference this vendor (delete them first)`);
  await (prisma as any).vendor.delete({ where: { id: vid } });
  await touched();
  return { ok: true };
}

// ── Rates ───────────────────────────────────────────────────────────────────

export async function createRate(body: any): Promise<any> {
  const { data, productId } = rateRowData(body, true);
  if (body?.pricePerUnit !== undefined && body.pricePerUnit !== null && body.pricePerUnit !== '') {
    const price = Number(body.pricePerUnit);
    if (Number.isFinite(price)) data.baseRate = baseRateFor(price, body?.discountPercent);
  }
  const vendor = await (prisma as any).vendor.findUnique({ where: { id: String((data as any).vendorId) } }).catch(() => null);
  if (!vendor) fail('vendor not found');
  if (productId) {
    const product = await (prisma as any).productItem.findUnique({ where: { id: productId } }).catch(() => null);
    if (!product) fail('product not found');
  }
  // Typecheck the spec document against the product's schema branch (KYP v2)
  // and refresh missingSpecs before the row lands.
  const prepared = await applySpecsToData(data, String(productId ?? ''), body);
  const row = await (prisma as any).vendorRate.create({ data });
  await syncRateSpecs(String((row as any)?.id ?? ''), prepared);
  await touched();
  // Per-product rates cache MUST bust here: dup detection (commit_all) and
  // sales matching read getRatesForProduct, which would otherwise serve the
  // pre-create snapshot for the full TTL.
  if (productId) {
    await invalidateProductDetailCache(productId);
    await invalidateProductRatesCache(productId).catch(() => {});
  }
  return row;
}

export async function updateRate(id: string, body: any): Promise<any> {
  const rid = String(id);
  const { data } = rateRowData(body, false);
  if (body?.pricePerUnit !== undefined || body?.discountPercent !== undefined) {
    const cur = await (prisma as any).vendorRate.findUnique({ where: { id: rid } }).catch(() => null);
    const price = body?.pricePerUnit !== undefined ? Number(body.pricePerUnit) : Number((cur as any)?.pricePerUnit);
    const disc = body?.discountPercent !== undefined ? Number(body.discountPercent) : Number((cur as any)?.discountPercent ?? 0);
    if (Number.isFinite(price)) data.baseRate = baseRateFor(price, disc);
    else data.baseRate = null;
  }
  if (Object.keys(data).length === 0) fail('nothing to update');
  const cur = await (prisma as any).vendorRate.findUnique({ where: { id: rid } }).catch(() => null);
  if (!cur) fail('rate not found');
  const prepared = await applySpecsToData(
    data,
    String((data as any).productId ?? (cur as any)?.productId ?? ''),
    body,
    body?.attrValues !== undefined,
  );
  const row = await (prisma as any).vendorRate.update({ where: { id: rid }, data });
  await syncRateSpecs(rid, prepared);
  await touched();
  try {
    const pid = (row as any)?.productId ?? (body as any)?.productId;
    if (pid) {
      await invalidateProductDetailCache(String(pid));
      await invalidateProductRatesCache(String(pid)).catch(() => {});
    }
  } catch { /* best-effort */ }
  return row;
}

export async function deleteRate(id: string): Promise<{ ok: true }> {
  // Hard delete: the quote row is gone completely (use the Turn off toggle
  // when you only want to hide it temporarily).
  const rid = String(id);
  const cur = await (prisma as any).vendorRate.findUnique({ where: { id: rid } }).catch(() => null);
  if (!cur) fail('rate not found');
  await (prisma as any).vendorRate.delete({ where: { id: rid } });
  await dropRateSpecs(rid);
  await touched(String((cur as any)?.productId ?? ''));
  return { ok: true };
}

export async function setRateActive(id: string, active: boolean): Promise<{ ok: true }> {
  const row = await (prisma as any).vendorRate.update({ where: { id: String(id) }, data: { active } });
  await touched();
  try {
    const pid = (row as any)?.productId;
    if (pid) {
      await invalidateProductDetailCache(String(pid));
      await invalidateProductRatesCache(String(pid));
    }
  } catch { /* best-effort */ }
  return { ok: true };
}

// ── Catalogue order ─────────────────────────────────────────────────────────
/** Reorder a product's spec rows (the dashboard's up/down + drag handles). */
export async function reorderGuide(productId: string, ids: string[]): Promise<{ ok: true }> {
  const pid = str(productId);
  if (!pid) fail('productId required');
  const list = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean).slice(0, 200);
  if (!list.length) fail('spec order required');
  let i = 0;
  for (const id of list) {
    await (prisma as any).kypGuide.update({ where: { id }, data: { sortOrder: i } });
    i += 1;
  }
  await touchedGuide(undefined, pid);
  return { ok: true };
}
