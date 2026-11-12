// Extracted verbatim from ProductLineDashboard.tsx by scripts/refactor/split-module.mjs.
// ProductLineDashboard.tsx re-exports everything public here, so existing imports keep working.


// Mirror: founder-os_backend/src/automations/product-line/types.ts
export interface ProductRow { id: string; category: string; name: string; aliases: string[]; active: boolean; guideCount: number; rateCount: number; }

export interface GuideRow { id: string; productId: string; attrKey: string; question: string; guideNote: string | null; sortOrder: number; isRequired: boolean; condition: Record<string, unknown> | null; active: boolean; }

export interface VendorRow { id: string; name: string; contactPerson: string | null; contactPhone1: string | null; contactPhone2: string | null; location: string | null; address: string | null; yearEstablished: number | null; vendorType: string; active: boolean; rateCount: number; }

export interface RateRow {
  id: string; vendorId: string; vendorName: string | null; vendorType: string | null;
  productId: string | null; productName: string | null; attrKey: string; attrValues: Record<string, string>;
  pricePerUnit: number | null; unit: string; discountPercent: number | null; baseRate: number | null;
  weightPerUnit: number | null; packageQty: string | null; packageDims: string | null;
  moq: string | null; deliveryDays: number | null; quotedAt: string; enquiryRef: string | null; notes?: string | null; missingSpecs: string[] | null; active: boolean;
  imageUrl: string | null; videoUrl: string | null;
}

export interface Payload { products: ProductRow[]; guide: Record<string, GuideRow[]>; vendors: VendorRow[]; rates: RateRow[]; }

export interface Detail { product: ProductRow & { createdAt: string }; guide: GuideRow[]; rates: RateRow[]; }
