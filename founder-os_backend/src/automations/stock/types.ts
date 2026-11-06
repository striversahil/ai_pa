// types.ts — stock automation shapes (mirror: frontend/src/stock/queue.ts).
export interface StockItemRow {
  id: string;
  sku: string;
  productName: string;
  category: string;
  brand: string;
  barcode: string;
  unit: string;
  unitPurchase: string;
  unitFactor: number;
  purchaseRate: number;
  saleRate: number;
  supplier: string;
  reorderLevel: number;
  minLevel: number;
  maxLevel: number;
  imageUrl: string;
  active: boolean;
}

export type MovementKind = 'opening' | 'purchase-in' | 'sales-out' | 'transfer' | 'adjustment' | 'reserve-release';

export interface StockMovementRow {
  id: string;
  itemId: string;
  day: string;
  kind: MovementKind;
  qty: number;
  locationId: string;
  toLocationId: string;
  rate: number;
  status: 'approved' | 'pending';
  refType: string;
  refId: string;
  note: string;
  createdBy: string;
}

export interface StockLine extends StockItemRow {
  onHand: number;
  reserved: number;
  available: number;
  avgRate: number;
  stockValue: number;
  status: 'out' | 'low' | 'ok';
  abc: 'A' | 'B' | 'C';
  lastMoveDay: string;
  deadDays: number;
}

export interface StockLocationRow { id: string; name: string; active: boolean }

export interface StockPayload {
  meta: { analysis: 'stock'; generatedAt: string; day: string; days: string[]; locations: StockLocationRow[] };
  items: StockLine[];
  closings: Record<string, Record<string, number>>;
  totals: { skus: number; units: number; available: number; value: number; low: number; out: number; dead: number; pendingAdjust: number };
  movements: StockMovementRow[];
}
