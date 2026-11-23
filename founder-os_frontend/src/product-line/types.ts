// types.ts — Product Line shapes (mirror: founder-os_backend/src/automations/
// product-line/{types.ts,catalog-live.ts,service-parts/rates-page.ts}).

export type SpecType = "string" | "number" | "integer" | "boolean" | "array";

export interface KypSpec {
  type: SpecType;
  label: string;
  enum?: string[];
  min?: number;
  max?: number;
  gt?: number;
  minLen?: number;
  /** Value a new quote starts with (enum member / number / boolean). */
  default?: string | number | boolean;
}

export interface KypRule {
  whenKey: string;
  whenValue: string;
  key: string;
  min?: number;
  max?: number;
}

/** One catalogue product as the dashboard edits it (GET /api/product-line/catalog). */
export interface KypProduct {
  id: string;
  key: string;
  label: string;
  category: string;
  categories: string[];
  aliases: string[];
  ask: string[];
  props: Record<string, KypSpec>;
  required: string[];
  rules: KypRule[];
  active: boolean;
}

export interface LiveCatalog {
  categories: string[];
  products: KypProduct[];
}

export interface ProductRow {
  id: string;
  category: string;
  name: string;
  aliases: string[];
  active: boolean;
  guideCount: number;
  rateCount: number;
  bestPrice: number | null;
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
  type?: string | null;
  enumJson?: string | null;
  minNum?: number | null;
  maxNum?: number | null;
  defaultValue?: string | null;
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
  category?: string | null;
  attrKey: string;
  attrValues: Record<string, string | number | boolean | string[]>;
  pricePerUnit: number | null;
  unit: string;
  discountPercent: number | null;
  baseRate: number | null;
  weightPerUnit: number | null;
  packageQty: string | null;
  packageDims: string | null;
  moq: string | null;
  deliveryDays: number | null;
  deliveryMaxDays?: number | null;
  quotedAt: string;
  enquiryRef: string | null;
  notes?: string | null;
  missingSpecs: string[] | null;
  /** Server-computed: every required field this quote still misses. */
  missingFields?: string[];
  imageUrl: string | null;
  videoUrl: string | null;
  active: boolean;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** GET /api/product-line/rates/:id — the drawer payload. */
export interface RateDetail {
  rate: RateRow & {
    vendor: {
      id: string;
      name: string;
      vendorType: string;
      contactPerson: string | null;
      contactPhone1: string | null;
      contactPhone2: string | null;
      location: string | null;
    } | null;
  };
  product: {
    id: string;
    key: string;
    label: string;
    category: string;
    props: Record<string, KypSpec>;
    required: string[];
  } | null;
}

/** Workspace payload (GET /api/session/workspaces/product-line/data). */
export interface Payload {
  products: ProductRow[];
  guide: Record<string, GuideRow[]>;
  vendors: VendorRow[];
  rateTotal: number;
}

/** GET /api/product-line/prompt — the rate-intake prompt and its saved state. */
export interface PromptPayload {
  template: string;
  defaultTemplate: string;
  rendered: string;
  isDefault: boolean;
  vendorCount: number;
}

/** POST /api/product-line/rates/import — one paste's outcome. */
export interface ImportResult {
  /** The batch every imported quote is stamped with (see the batch log). */
  batchId: string;
  created: number;
  failed: { row: number; product?: string; vendor?: string; error: string }[];
  vendorsCreated: string[];
  total: number;
}

/** One bulk paste (GET /api/product-line/batches). */
export interface RateBatchRow {
  id: string;
  source: string;
  actorId: string | null;
  actorName: string | null;
  label: string | null;
  rowCount: number;
  createdCount: number;
  failedCount: number;
  vendorNames: string[];
  failures: { row: number; product?: string; vendor?: string; error: string }[];
  status: string;
  createdAt: string;
  liveCount?: number;
}

export interface BatchDetail {
  batch: RateBatchRow;
  rates: { id: string; productName: string | null; vendorName: string | null; pricePerUnit: number | null; baseRate: number | null; unit: string }[];
}

/** One row as the preview resolved it (nothing written yet). */
export interface ImportRowAnalysis {
  index: number;
  productKey: string | null;
  productLabel: string | null;
  vendor: string;
  isNewVendor: boolean;
  vendorId: string | null;
  price: number | null;
  unit: string;
  ok: boolean;
  error?: string;
}

/** A vendor the paste would create — editable before it lands. */
export interface NewVendorCandidate {
  name: string;
  location: string;
  contactPerson: string;
  contactPhone1: string;
  contactPhone2: string;
  address: string;
  yearEstablished: number | null;
  vendorType: string;
  rows: number;
  isNewVendor: boolean;
}

export interface ImportPreview {
  total: number;
  rows: ImportRowAnalysis[];
  newVendors: NewVendorCandidate[];
  matchedVendors: { name: string; vendorId: string; rows: number }[];
  okCount: number;
  errorCount: number;
}

export interface VendorDecision {
  name: string;
  action: "create" | "map" | "skip";
  vendorId?: string;
  location?: string;
  contactPerson?: string;
  contactPhone1?: string;
  contactPhone2?: string;
  address?: string;
  yearEstablished?: number | null;
  vendorType?: string;
}
