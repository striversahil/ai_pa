// Mirror of founder-os_backend/src/automations/stock/queues.ts
// (same names + semantics — change both together, never drift).
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

export function suggestedOrder(available: number, maxLevel: number, reorderLevel: number): number {
  const target = maxLevel > 0 ? maxLevel : reorderLevel * 2;
  return Math.max(0, Math.ceil(target - available));
}

export function isDeadStock(deadDays: number, threshold = 90): boolean {
  return deadDays >= threshold;
}
