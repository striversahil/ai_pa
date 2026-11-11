// update.ts — stock writes (MIS/stock-gated in routes; validation here).
// SKU is system-generated — createStockItem never accepts one.
import { prisma } from '../../shared/prisma-d1';
import { invalidateStockCache, validateDay } from './service';
import { generateSku } from './sku';

const KINDS = new Set(['opening', 'purchase-in', 'sales-out', 'transfer', 'adjustment']);

/** Phase 4b dual-write helpers: project touched rows into core (never throws). */
async function mirrorEntries(ids: string[]): Promise<void> {
  try {
    const { mirrorStockEntries } = await import('../../modules/core/stock');
    if (ids.length) await mirrorStockEntries(ids);
  } catch { /* non-fatal */ }
}
async function mirrorResvs(ids: string[]): Promise<void> {
  try {
    const { mirrorReservations } = await import('../../modules/core/stock');
    if (ids.length) await mirrorReservations(ids);
  } catch { /* non-fatal */ }
}
async function mirrorWh(id: string): Promise<void> {
  try {
    const { mirrorWarehouse } = await import('../../modules/core/stock');
    if (id) await mirrorWarehouse(id);
  } catch { /* non-fatal */ }
}

async function defaultLocation(): Promise<string> {
  const locs = await (prisma as any).stockLocation.findMany({}).catch(() => []);
  const main = (locs as any[]).find((l) => String(l.name) === 'MAIN');
  return main ? String(main.id) : String((locs as any[])?.[0]?.id ?? 'MAIN');
}

export async function createStockItem(input: any) {
  const productName = String(input?.productName ?? '').trim();
  if (!productName) throw new Error('productName is required');
  const category = String(input?.category ?? '').trim();
  const sku = await generateSku(category, productName);
  const row = await (prisma as any).stockItem.create({
    data: {
      sku, productName, category,
      brand: String(input?.brand ?? '').trim(),
      barcode: String(input?.barcode ?? '').trim(),
      unit: String(input?.unit ?? 'pcs').trim() || 'pcs',
      unitPurchase: String(input?.unitPurchase ?? '').trim(),
      unitFactor: Number(input?.unitFactor ?? 1) || 1,
      purchaseRate: Number(input?.purchaseRate ?? 0) || 0,
      saleRate: Number(input?.saleRate ?? 0) || 0,
      supplier: String(input?.supplier ?? '').trim(),
      reorderLevel: Number(input?.reorderLevel ?? 0) || 0,
      minLevel: Number(input?.minLevel ?? 0) || 0,
      maxLevel: Number(input?.maxLevel ?? 0) || 0,
      avgDailyConsumption: Number(input?.avgDailyConsumption ?? 0) || 0,
      leadTimeDays: Number(input?.leadTimeDays ?? 0) || 0,
      safetyFactor: Number(input?.safetyFactor ?? 0) || 0,
      moq: Number(input?.moq ?? 0) || 0,
      imageUrl: String(input?.imageUrl ?? '').trim(),
      active: input?.active !== false,
    },
  });
  await invalidateStockCache();
  return row;
}

export async function updateStockItem(id: string, input: any) {
  const patch: Record<string, unknown> = {};
  for (const f of ['productName', 'category', 'brand', 'barcode', 'unit', 'unitPurchase', 'supplier', 'imageUrl']) {
    if (input?.[f] !== undefined) patch[f] = String(input[f]).trim();
  }
  for (const f of ['unitFactor', 'purchaseRate', 'saleRate', 'reorderLevel', 'minLevel', 'maxLevel', 'avgDailyConsumption', 'leadTimeDays', 'safetyFactor', 'moq']) {
    if (input?.[f] !== undefined) patch[f] = Number(input[f]) || 0;
  }
  if (input?.active !== undefined) patch.active = input.active !== false;
  if (patch.productName !== undefined && !String(patch.productName)) throw new Error('productName is required');
  const row = await (prisma as any).stockItem.update({ where: { id: String(id) }, data: patch });
  await invalidateStockCache();
  return row;
}

export async function postStockMovement(input: any, createdBy: string) {
  const itemId = String(input?.itemId ?? '').trim();
  if (!itemId) throw new Error('itemId is required');
  const kind = String(input?.kind ?? '').trim();
  if (!KINDS.has(kind)) throw new Error('kind must be opening|purchase-in|sales-out|transfer|adjustment');
  const day = validateDay(input?.day);
  let qty = Number(input?.qty);
  if (!Number.isFinite(qty) || qty === 0) throw new Error('qty must be a non-zero number');
  const item = await (prisma as any).stockItem.findUnique({ where: { id: itemId } });
  if (!item) throw new Error('item not found');
  const loc = String(input?.locationId ?? '').trim() || await defaultLocation();
  if (kind === 'sales-out') qty = -Math.abs(qty);
  if (kind === 'purchase-in' || kind === 'opening') qty = Math.abs(qty);
  if (kind === 'transfer') {
    const to = String(input?.toLocationId ?? '').trim();
    if (!to) throw new Error('toLocationId is required for transfer');
    if (to === loc) throw new Error('transfer needs two different locations');
    qty = -Math.abs(qty);
    const out = await (prisma as any).stockMovement.create({
      data: { itemId, day, kind, qty, locationId: loc, toLocationId: to, rate: Number(input?.rate ?? 0) || 0, status: 'approved', refType: String(input?.refType ?? ''), refId: String(input?.refId ?? ''), note: String(input?.note ?? '').slice(0, 500), createdBy },
    });
    const inl = await (prisma as any).stockMovement.create({
      data: { itemId, day, kind, qty: Math.abs(qty), locationId: to, toLocationId: loc, rate: Number(input?.rate ?? 0) || 0, status: 'approved', refType: String(input?.refType ?? ''), refId: String(input?.refId ?? ''), note: String(input?.note ?? '').slice(0, 500), createdBy },
    });
    // Phase 4b dual-write: both transfer legs.
    await mirrorEntries([String((out as any)?.id ?? ''), String((inl as any)?.id ?? '')].filter(Boolean));
    await invalidateStockCache();
    return out;
  }
  const status = kind === 'adjustment' ? 'pending' : 'approved';
  const row = await (prisma as any).stockMovement.create({
    data: { itemId, day, kind, qty, locationId: loc, toLocationId: '', rate: Number(input?.rate ?? 0) || 0, status, refType: String(input?.refType ?? ''), refId: String(input?.refId ?? ''), note: String(input?.note ?? '').slice(0, 500), createdBy },
  });
  // Phase 4b dual-write.
  await mirrorEntries([String((row as any)?.id ?? '')].filter(Boolean));
  await invalidateStockCache();
  return row;
}

export async function approveMovement(id: string) {
  const row = await (prisma as any).stockMovement.update({ where: { id: String(id) }, data: { status: 'approved' } });
  // Phase 4b dual-write: status transition converges in core.
  await mirrorEntries([String(id)]);
  await invalidateStockCache();
  return row;
}

export async function createLocation(name: string) {
  const n = String(name ?? '').trim().toUpperCase();
  if (!n) throw new Error('name is required');
  const row = await (prisma as any).stockLocation.create({ data: { name: n, active: true } });
  // Phase 4b dual-write.
  await mirrorWh(String((row as any)?.id ?? ''));
  await invalidateStockCache();
  return row;
}

export async function reserveStock(input: any, createdBy: string) {
  const itemId = String(input?.itemId ?? '').trim();
  const qty = Number(input?.qty);
  if (!itemId || !Number.isFinite(qty) || qty <= 0) throw new Error('itemId + positive qty required');
  const row = await (prisma as any).stockReservation.create({
    data: { itemId, locationId: String(input?.locationId ?? ''), qty, refType: String(input?.refType ?? 'SO'), refId: String(input?.refId ?? ''), status: 'open', day: validateDay(input?.day ?? new Date().toISOString().slice(0, 10)), createdBy },
  });
  // Phase 4b dual-write.
  await mirrorResvs([String((row as any)?.id ?? '')].filter(Boolean));
  await invalidateStockCache();
  return row;
}

export async function releaseReservation(id: string, mode: 'released' | 'consumed') {
  const r = await (prisma as any).stockReservation.findUnique({ where: { id: String(id) } });
  if (!r) throw new Error('reservation not found');
  if (mode === 'consumed') {
    const mv = await (prisma as any).stockMovement.create({
      data: { itemId: String(r.itemId), day: String(r.day), kind: 'sales-out', qty: -Math.abs(Number(r.qty)), locationId: String(r.locationId ?? ''), status: 'approved', refType: String(r.refType), refId: String(r.refId), note: 'reservation consumed', createdBy: 'system' },
    });
    // Phase 4b dual-write: the consumed movement + the reservation transition.
    await mirrorEntries([String((mv as any)?.id ?? '')].filter(Boolean));
  }
  const row = await (prisma as any).stockReservation.update({ where: { id: String(id) }, data: { status: mode } });
  await mirrorResvs([String(id)]);
  await invalidateStockCache();
  return row;
}

export interface BackfillLine {
  productName: string; category?: string; brand?: string; unit?: string;
  supplier?: string; avgDailyConsumption?: number; maxLevel?: number;
  reorderLevel?: number; leadTimeDays?: number; safetyFactor?: number; moq?: number;
}

export interface BackfillInput {
  planning?: { leadTimeDays?: number; safetyFactor?: number; moq?: number; source?: string };
  items: BackfillLine[];
}

/**
 * Idempotent SEFAR-style backfill: match on (category, productName); create
 * missing SKUs (auto BOL-0007…), refresh planning fields on existing rows.
 * Never posts movements — on-hand stays derived, pending_to_order computed.
 */
export async function backfillStockFromPayload(input: BackfillInput, actor: string) {
  const lines = Array.isArray(input?.items) ? input.items : [];
  if (!lines.length) throw new Error('items[] is required');
  const planning = {
    leadTimeDays: Number(input?.planning?.leadTimeDays) || 60,
    safetyFactor: Number(input?.planning?.safetyFactor) || 5,
    moq: Number(input?.planning?.moq) || 25,
    source: String(input?.planning?.source ?? 'stock_update.json'),
  };
  await (prisma as any).setting.upsert({
    where: { key: 'stock:planning' },
    update: { value: JSON.stringify(planning) },
    create: { key: 'stock:planning', value: JSON.stringify(planning) },
  }).catch(() => null);
  let created = 0, updated = 0;
  for (const l of lines) {
    const productName = String(l?.productName ?? '').trim();
    if (!productName) continue;
    const category = String(l?.category ?? '').trim();
    const maxLevel = Number(l?.maxLevel ?? 0) || 0;
    const avg = Number(l?.avgDailyConsumption ?? 0) || 0;
    const data = {
      category,
      brand: String(l?.brand ?? '').trim(),
      unit: String(l?.unit ?? '').trim() || 'meters',
      supplier: String(l?.supplier ?? '').trim(),
      reorderLevel: Number(l?.reorderLevel ?? 0) || (maxLevel > 0 ? maxLevel : 0),
      maxLevel,
      avgDailyConsumption: avg,
      leadTimeDays: Number(l?.leadTimeDays) || planning.leadTimeDays,
      safetyFactor: Number(l?.safetyFactor) || planning.safetyFactor,
      moq: Number(l?.moq) || planning.moq,
      active: true,
    };
    const existing = await (prisma as any).stockItem.findMany({}).catch(() => []);
    const hit = ((existing as any[]) ?? []).find(
      (r) => String(r.productName ?? '').trim().toLowerCase() === productName.toLowerCase()
        && String(r.category ?? '').trim().toLowerCase() === category.toLowerCase(),
    );
    if (hit) {
      await (prisma as any).stockItem.update({ where: { id: String(hit.id) }, data }).catch(() => null);
      updated++;
    } else {
      const sku = await generateSku(category, productName);
      await (prisma as any).stockItem.create({ data: { sku, productName, ...data } });
      created++;
    }
  }
  await invalidateStockCache();
  return { created, updated, total: lines.length, planning, actor };
}
