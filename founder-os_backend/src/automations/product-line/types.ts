// types.ts — product-line shapes (mirror: frontend ProductLineDashboard types).
export interface ProductRow {
  id: string;
  category: string;
  name: string;
  aliases: string[];
  active: boolean;
  guideCount: number;
  rateCount: number;
}

export interface GuideRow {
  id: string;
  productId: string;
  attrKey: string;
  question: string;
  guideNote: string | null;
  sortOrder: number;
  isRequired: boolean;
  condition: Record<string, unknown> | null;
  active: boolean;
}

export interface VendorRow {
  id: string;
  name: string;
  contactPerson: string | null;
  contactPhone1: string | null;
  contactPhone2: string | null;
  location: string | null;
  address: string | null;
  yearEstablished: number | null;
  vendorType: string;
  active: boolean;
  rateCount: number;
}

export interface RateRow {
  id: string;
  vendorId: string;
  vendorName: string | null;
  vendorType: string | null;
  productId: string | null;
  productName: string | null;
  attrKey: string;
  attrValues: Record<string, string>;
  pricePerUnit: number | null;
  unit: string;
  discountPercent: number | null;
  baseRate: number | null;
  weightPerUnit: number | null;
  packageQty: string | null;
  packageDims: string | null;
  moq: string | null;
  deliveryDays: number | null;
  imageUrl: string | null;
  videoUrl: string | null;
  quotedAt: string;
  enquiryRef: string | null;
  active: boolean;
}

export interface ProductLineData {
  products: ProductRow[];
  guide: Record<string, GuideRow[]>;
  vendors: VendorRow[];
  rates: RateRow[];
}

export interface ProductDetail {
  product: ProductRow & { createdAt: string };
  guide: GuideRow[];
  rates: RateRow[];
}
