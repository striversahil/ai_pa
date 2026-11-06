// queues.ts — pure stock predicates (mirror: frontend/src/stock/queue.ts).
export type StockStatus = 'out' | 'low' | 'ok';

export function stockStatus(available: number, reorderLevel: number): StockStatus {
  if (available <= 0) return 'out';
  if (available <= reorderLevel) return 'low';
  return 'ok';
}

export function isLowStock(available: number, reorderLevel: number): boolean {
  return stockStatus(available, reorderLevel) === 'low';
}

export function isOutOfStock(available: number): boolean {
  return available <= 0;
}

export function needsReorder(available: number, reorderLevel: number): boolean {
  return available <= reorderLevel;
}

/** Suggested PO qty: fill to max (or 2x reorder when max unset). */
export function suggestedOrder(available: number, maxLevel: number, reorderLevel: number): number {
  const target = maxLevel > 0 ? maxLevel : reorderLevel * 2;
  return Math.max(0, Math.ceil(target - available));
}

export function isDeadStock(deadDays: number, threshold = 90): boolean {
  return deadDays >= threshold;
}
