// update.ts — stock writes (MIS/stock-gated in routes; validation here).
// SKU is system-generated — createStockItem never accepts one.
import { prisma } from '../../shared/prisma-d1';
import { invalidateStockCache, validateDay } from './service';
import { generateSku } from './sku';

const KINDS = new Set(['opening', 'purchase-in', 'sales-out', 'transfer', 'adjustment']);

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
  for (const f of ['unitFactor', 'purchaseRate', 'saleRate', 'reorderLevel', 'minLevel', 'maxLevel']) {
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
    await (prisma as any).stockMovement.create({
      data: { itemId, day, kind, qty: Math.abs(qty), locationId: to, toLocationId: loc, rate: Number(input?.rate ?? 0) || 0, status: 'approved', refType: String(input?.refType ?? ''), refId: String(input?.refId ?? ''), note: String(input?.note ?? '').slice(0, 500), createdBy },
    });
    await invalidateStockCache();
    return out;
  }
  const status = kind === 'adjustment' ? 'pending' : 'approved';
  const row = await (prisma as any).stockMovement.create({
    data: { itemId, day, kind, qty, locationId: loc, toLocationId: '', rate: Number(input?.rate ?? 0) || 0, status, refType: String(input?.refType ?? ''), refId: String(input?.refId ?? ''), note: String(input?.note ?? '').slice(0, 500), createdBy },
  });
  await invalidateStockCache();
  return row;
}

export async function approveMovement(id: string) {
  const row = await (prisma as any).stockMovement.update({ where: { id: String(id) }, data: { status: 'approved' } });
  await invalidateStockCache();
  return row;
}

export async function createLocation(name: string) {
  const n = String(name ?? '').trim().toUpperCase();
  if (!n) throw new Error('name is required');
  const row = await (prisma as any).stockLocation.create({ data: { name: n, active: true } });
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
  await invalidateStockCache();
  return row;
}

export async function releaseReservation(id: string, mode: 'released' | 'consumed') {
  const r = await (prisma as any).stockReservation.findUnique({ where: { id: String(id) } });
  if (!r) throw new Error('reservation not found');
  if (mode === 'consumed') {
    await (prisma as any).stockMovement.create({
      data: { itemId: String(r.itemId), day: String(r.day), kind: 'sales-out', qty: -Math.abs(Number(r.qty)), locationId: String(r.locationId ?? ''), status: 'approved', refType: String(r.refType), refId: String(r.refId), note: 'reservation consumed', createdBy: 'system' },
    });
  }
  const row = await (prisma as any).stockReservation.update({ where: { id: String(id) }, data: { status: mode } });
  await invalidateStockCache();
  return row;
}
