import { prisma } from '../../shared/prisma';
import { invalidateProductLineCache, invalidateProductDetailCache } from './service';

function fail(msg: string): never {
  throw new Error(msg);
}

function mediaUrl(v: unknown): string | null {
  const s = String(v ?? '').trim().slice(0, 2000);
  if (!s) return null;
  if (!/^https?:\/\/.+/i.test(s) && !/^data:image\//i.test(s) && !/^\/api\/chat\/files\//.test(s)) {
    fail('media must be an uploaded photo or an https:// URL');
  }
  return s;
}

function str(v: unknown, max = 500): string {
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

function parseAliasesInput(v: unknown): string | null {
  if (v === undefined) return null;
  const list = Array.isArray(v)
    ? v.map((s) => String(s).trim()).filter(Boolean)
    : String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return JSON.stringify(list.slice(0, 50));
}

async function touched(productId?: string): Promise<void> {
  await invalidateProductLineCache();
  if (productId) await invalidateProductDetailCache(productId);
}

async function touchedGuide(guideId?: string, productId?: string): Promise<void> {
  let pid = productId;
  if (!pid && guideId) {
    try {
      const g = await (prisma as any).kypGuide.findUnique({ where: { id: String(guideId) } }).catch(() => null);
      if (g) pid = String((g as any).productId);
    } catch { /* best-effort */ }
  }
  await touched(pid);
}

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
      active: body?.active === false ? false : true,
    },
  });
  await touchedGuide(undefined, productId);
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
  if (Object.keys(data).length === 0) fail('nothing to update');
  const row = await (prisma as any).kypGuide.update({ where: { id: String(id) }, data });
  await touchedGuide(String(id));
  return row;
}

export async function deleteGuide(id: string): Promise<{ ok: true }> {
  const gid = String(id);
  await (prisma as any).kypGuide.delete({ where: { id: gid } });
  await touchedGuide(gid);
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
  // Soft-delete: rate history stays queryable.
  await (prisma as any).vendor.update({ where: { id: String(id) }, data: { active: false } });
  await touched();
  return { ok: true };
}

// ── Rates ───────────────────────────────────────────────────────────────────
function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rateData(body: any, isCreate: boolean): { data: Record<string, unknown>; productId: string | null } {
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
  if (body?.active !== undefined) data.active = body.active !== false;
  return { data, productId };
}

export async function createRate(body: any): Promise<any> {
  const { data, productId } = rateData(body, true);
  if (body?.pricePerUnit !== undefined && body.pricePerUnit !== null && body.pricePerUnit !== '') {
    const price = Number(body.pricePerUnit);
    const disc = Number(body?.discountPercent ?? 0) || 0;
    if (Number.isFinite(price)) data.baseRate = Math.round(price * (1 - Math.min(100, Math.max(0, disc)) / 100) * 100) / 100;
  }
  const vendor = await (prisma as any).vendor.findUnique({ where: { id: String((data as any).vendorId) } }).catch(() => null);
  if (!vendor) fail('vendor not found');
  if (productId) {
    const product = await (prisma as any).productItem.findUnique({ where: { id: productId } }).catch(() => null);
    if (!product) fail('product not found');
  }
  const row = await (prisma as any).vendorRate.create({ data });
  await touched();
  if (productId) await invalidateProductDetailCache(productId);
  return row;
}

export async function updateRate(id: string, body: any): Promise<any> {
  const rid = String(id);
  const { data } = rateData(body, false);
  if (body?.pricePerUnit !== undefined || body?.discountPercent !== undefined) {
    const cur = await (prisma as any).vendorRate.findUnique({ where: { id: rid } }).catch(() => null);
    const price = body?.pricePerUnit !== undefined ? Number(body.pricePerUnit) : Number((cur as any)?.pricePerUnit);
    const disc = body?.discountPercent !== undefined ? Number(body.discountPercent) : Number((cur as any)?.discountPercent ?? 0);
    if (Number.isFinite(price)) data.baseRate = Math.round(price * (1 - Math.min(100, Math.max(0, disc || 0)) / 100) * 100) / 100;
    else data.baseRate = null;
  }
  if (Object.keys(data).length === 0) fail('nothing to update');
  const row = await (prisma as any).vendorRate.update({ where: { id: rid }, data });
  await touched();
  try {
    const pid = (row as any)?.productId ?? (body as any)?.productId;
    if (pid) await invalidateProductDetailCache(String(pid));
  } catch { /* best-effort */ }
  return row;
}

export async function setRateActive(id: string, active: boolean): Promise<{ ok: true }> {
  const row = await (prisma as any).vendorRate.update({ where: { id: String(id) }, data: { active } });
  await touched();
  try {
    const pid = (row as any)?.productId;
    if (pid) await invalidateProductDetailCache(String(pid));
  } catch { /* best-effort */ }
  return { ok: true };
}
