// bulk-import/types.ts — staging shapes for vendor price-list imports.
// Mirror: BulkBatch/BulkRow in prisma/schema.prisma (migration 0054).
export type BulkSourceKind = 'paste' | 'csv' | 'xlsx' | 'pdf' | 'image';
export type BulkBatchStatus = 'parsing' | 'review' | 'committed';
export type BulkRowStatus = 'unprocessed' | 'matched' | 'needs-product' | 'needs-specs' | 'ready' | 'duplicate';

export interface BulkBatchRow {
  id: string;
  vendorId: string | null;
  sourceKind: BulkSourceKind;
  sourceName: string;
  sourceFileKey: string | null;
  sourceText: string | null;
  quotedAt: string;
  status: BulkBatchStatus;
  disabled: boolean;
  rowCount: number;
  readyCount: number;
  createdBy: string;
  createdAt: string;
}

export interface BulkRowRec {
  id: string;
  batchId: string;
  rowNo: number;
  rawText: string;
  rawHash: string;
  productId: string | null;
  productName: string | null;
  isNewProduct: boolean;
  newCategory: string | null;
  vendorId: string | null;
  vendorName: string | null;
  price: number | null;
  unit: string | null;
  discount: number | null;
  moq: string | null;
  deliveryDays: number | null;
  weightPerUnit: number | null;
  packageQty: string | null;
  packageDims: string | null;
  quotedAt: string | null;
  specs: Record<string, string>;
  missing: string[];
  matchConfidence: number | null;
  duplicateOf: string | null;
  status: BulkRowStatus;
}

/** Step-0 parsed line: raw text + regex-extracted commercials (zero AI). */
export interface ParsedLine {
  rawText: string;
  rawHash: string;
  price: number | null;
  unit: string | null;
}
