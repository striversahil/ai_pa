import { prisma } from '../../shared/prisma';
import { HrError } from './errors';
import { invalidateHumanResourcesCache } from './cache';
import {
  cleanExpenseCreate, cleanInventoryItemCreate, cleanInventoryItemPatch,
  cleanInventoryTxnCreate, inventoryQtyEffect, isValidMonth, istMonthStr,
} from './parse';
import type { InventoryItemPatch } from './types';

function itemJson(item: any, stats?: any) {
  const currentQty = Number(stats?.currentQty) || 0;
  const reorderLevel = Number(item.reorderLevel) || 0;
  const unitCost = item.unitCost === null || item.unitCost === undefined ? null : Number(item.unitCost);
  return {
    id: String(item.id),
    name: item.name ?? '',
    category: item.category ?? null,
    unit: item.unit ?? 'pcs',
    reorderLevel,
    unitCost,
    notes: item.notes ?? null,
    order: item.order ?? 0,
    currentQty: Math.round(currentQty * 1000) / 1000,
    purchasedThisMonth: Math.round((Number(stats?.purchasedThisMonth) || 0) * 1000) / 1000,
    consumedThisMonth: Math.round((Number(stats?.consumedThisMonth) || 0) * 1000) / 1000,
    movementCount: Number(stats?.movementCount) || 0,
    lastMovementAt: stats?.lastMovementAt ?? null,
    stockValue: unitCost === null ? null : Math.round(currentQty * unitCost * 100) / 100,
    lowStock: reorderLevel > 0 && currentQty > 0 && currentQty <= reorderLevel,
    outOfStock: currentQty <= 0,
    createdAt: item.createdAt ?? null,
    updatedAt: item.updatedAt ?? null,
  };
}

function txnJson(row: any) {
  return {
    id: String(row.id),
    itemId: String(row.itemId),
    txnType: row.txnType ?? 'purchase',
    quantity: Number(row.quantity) || 0,
    txnDate: row.txnDate ?? null,
    txnMonth: row.txnMonth ?? null,
    notes: row.notes ?? null,
    expenseId: row.expenseId ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt ?? null,
  };
}

function statsByItem(txns: any[], month: string) {
  const stats = new Map<string, any>();
  for (const t of txns) {
    const id = String(t.itemId);
    const cur = stats.get(id) ?? {
      currentQty: 0, purchasedThisMonth: 0, consumedThisMonth: 0,
      movementCount: 0, lastMovementAt: null,
    };
    const qty = Number(t.quantity) || 0;
    cur.currentQty += inventoryQtyEffect(String(t.txnType), qty);
    if (t.txnMonth === month) {
      cur.movementCount += 1;
      if (t.txnType === 'purchase') cur.purchasedThisMonth += Math.abs(qty);
      if (t.txnType === 'consumption') cur.consumedThisMonth += Math.abs(qty);
    }
    const at = String(t.createdAt ?? t.txnDate ?? '');
    if (!cur.lastMovementAt || at > String(cur.lastMovementAt)) cur.lastMovementAt = at || null;
    stats.set(id, cur);
  }
  return stats;
}

async function itemStats(itemId: string) {
  const txns = await prisma.humanResourcesInventoryTxn.findMany({
    where: { itemId, deleted: false },
    orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
    take: 20000,
  });
  return statsByItem(txns, istMonthStr()).get(itemId) ?? null;
}

export async function getInventorySnapshot(monthInput?: unknown) {
  const month = isValidMonth(monthInput) ? monthInput : istMonthStr();
  const [items, txns] = await Promise.all([
    prisma.humanResourcesInventoryItem.findMany({
      where: { deleted: false }, orderBy: [{ order: 'asc' }, { name: 'asc' }],
    }) as Promise<any[]>,
    prisma.humanResourcesInventoryTxn.findMany({
      where: { deleted: false },
      orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
      take: 20000,
    }) as Promise<any[]>,
  ]);
  const stats = statsByItem(txns, month);
  const list = items.map((item) => itemJson(item, stats.get(String(item.id))));
  const stockValue = list.reduce((sum, i) => sum + (i.stockValue ?? 0), 0);
  return {
    month,
    items: list,
    summary: {
      itemCount: list.length,
      lowStockCount: list.filter((i) => i.lowStock).length,
      outOfStockCount: list.filter((i) => i.outOfStock).length,
      movementCount: list.reduce((sum, i) => sum + i.movementCount, 0),
      stockValue: Math.round(stockValue * 100) / 100,
    },
  };
}

export async function listInventoryItems(includeDeleted = false) {
  const items = await prisma.humanResourcesInventoryItem.findMany({
    where: includeDeleted ? {} : { deleted: false },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  }) as any[];
  const txns = await prisma.humanResourcesInventoryTxn.findMany({
    where: { deleted: false }, take: 20000,
  }) as any[];
  const stats = statsByItem(txns, istMonthStr());
  return items.map((item) => itemJson(item, stats.get(String(item.id))));
}

export async function createInventoryItem(input: Record<string, any>, actor: string | null) {
  const data = cleanInventoryItemCreate(input);
  const row: any = await prisma.humanResourcesInventoryItem.create({
    data: {
      name: data.name,
      category: data.category,
      unit: data.unit,
      reorderLevel: data.reorderLevel,
      unitCost: data.unitCost,
      notes: data.notes,
      order: data.order,
    },
  });
  if (data.openingQty > 0) {
    await prisma.humanResourcesInventoryTxn.create({
      data: {
        itemId: String(row.id),
        txnType: 'opening',
        quantity: data.openingQty,
        txnDate: data.openingDate,
        txnMonth: data.openingDate.slice(0, 7),
        notes: 'Opening stock',
        createdBy: actor,
      },
    });
  }
  await invalidateHumanResourcesCache();
  const stats = await itemStats(String(row.id));
  return itemJson(row, stats);
}

export async function updateInventoryItem(id: string, input: Record<string, any>) {
  const current: any = await prisma.humanResourcesInventoryItem.findUnique({ where: { id } });
  if (!current || current.deleted) throw new HrError('inventory item not found', 404);
  const patch: InventoryItemPatch = cleanInventoryItemPatch(input);
  const row = await prisma.humanResourcesInventoryItem.update({ where: { id }, data: patch });
  await invalidateHumanResourcesCache();
  const stats = await itemStats(id);
  return itemJson(row, stats);
}

export async function deleteInventoryItem(id: string) {
  const current: any = await prisma.humanResourcesInventoryItem.findUnique({ where: { id } });
  if (!current || current.deleted) throw new HrError('inventory item not found', 404);
  await prisma.humanResourcesInventoryItem.update({ where: { id }, data: { deleted: true } });
  await invalidateHumanResourcesCache();
}

export async function listInventoryTransactions(itemId: string, month?: unknown) {
  const item: any = await prisma.humanResourcesInventoryItem.findUnique({ where: { id: itemId } });
  if (!item || item.deleted) throw new HrError('inventory item not found', 404);
  const where: Record<string, any> = { itemId, deleted: false };
  if (isValidMonth(month)) where.txnMonth = month;
  const rows = await prisma.humanResourcesInventoryTxn.findMany({
    where,
    orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  }) as any[];
  return rows.map(txnJson);
}

export async function recordInventoryTransaction(
  input: Record<string, any>,
  actor: string | null,
  access: { canManage: boolean },
) {
  const data = cleanInventoryTxnCreate(input);
  const item: any = await prisma.humanResourcesInventoryItem.findUnique({ where: { id: data.itemId } });
  if (!item || item.deleted) throw new HrError('inventory item not found', 404);
  if (data.txnType === 'adjustment' && !access.canManage) {
    throw new HrError('Only HR/MIS users can adjust stock', 403);
  }

  const stock = await itemStats(String(item.id));
  const currentQty = Number(stock?.currentQty) || 0;
  if (data.txnType === 'consumption' && Math.abs(data.quantity) > currentQty) {
    throw new HrError(`Only ${currentQty} ${item.unit ?? 'units'} in stock`, 409);
  }

  let expense: any = null;
  if (data.logExpense) {
    if (!data.expenseAmount) throw new HrError('expenseAmount is required when logging an expense');
    const expenseData = cleanExpenseCreate({
      title: `Stock purchase: ${item.name}`,
      expenseType: data.expenseType,
      category: data.expenseCategory,
      amount: data.expenseAmount,
      expenseDate: data.txnDate,
      paymentMode: data.paymentMode,
      notes: data.notes,
    });
    expense = await prisma.humanResourcesExpense.create({
      data: { ...expenseData, createdBy: actor, updatedBy: actor },
    });
  }

  const row: any = await prisma.humanResourcesInventoryTxn.create({
    data: {
      itemId: String(item.id),
      txnType: data.txnType,
      quantity: data.quantity,
      txnDate: data.txnDate,
      txnMonth: data.txnDate.slice(0, 7),
      notes: data.notes,
      expenseId: expense ? String(expense.id) : null,
      createdBy: actor,
    },
  });
  await invalidateHumanResourcesCache();
  return { transaction: txnJson(row), expense: expense ? { id: String(expense.id) } : null };
}

export async function deleteInventoryTransaction(id: string) {
  const current: any = await prisma.humanResourcesInventoryTxn.findUnique({ where: { id } });
  if (!current || current.deleted) throw new HrError('stock movement not found', 404);
  await prisma.humanResourcesInventoryTxn.update({ where: { id }, data: { deleted: true } });
  if (current.expenseId) {
    const expense: any = await prisma.humanResourcesExpense.findUnique({ where: { id: current.expenseId } });
    if (expense && !expense.deleted) {
      await prisma.humanResourcesExpense.update({ where: { id: current.expenseId }, data: { deleted: true } });
    }
  }
  await invalidateHumanResourcesCache();
}
