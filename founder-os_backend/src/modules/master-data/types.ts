// types.ts — Customer master data shapes (D1 rows ↔ dashboard payload).
//
// The master table is the Zoho customer book: one row per Zoho customer, keyed
// by `zohoCustomerId` so re-imports upsert instead of duplicating. Region/zone
// come from the master extract (R1–R4) and match the live sales roster; the
// telecalling board's region copy is a separate concern.
//
// Layout mirrors src/modules/enquiries/: pure shapes here, parsers in parse.ts,
// persistence in store.ts, read/write lifecycles in service.ts.

/** One R1–R4 row from the master extract's `summary`. */
export interface MasterRegion {
  region: string;
  zone: string;
  coverage: string;
  salesPerson: string;
  allottedName: string;
}

/** A customer row as served to the dashboard (compact — table + search). */
export interface MasterCustomer {
  id: string;
  zohoCustomerId: string;
  name: string;
  company: string;
  customerType: string;
  /** Normalized family ("Flour Mill") — the value the type filter uses. */
  typeBase: string;
  /** State/country qualifier carried by the raw type ("MP", "Nepal"). */
  typeTag: string;
  status: string;
  contact: string;
  designation: string;
  region: string;
  zone: string;
  subArea: string;
  state: string;
  city: string;
  pincode: string;
  phones: string[];
  emails: string[];
  gstin: string;
  owner: string;
  pipeline: string;
  estCount: number;
  lastEstimateDate: string;
  soCount: number;
  lastSalesOrderDate: string;
  duplicateGroup: string;
  duplicateConfidence: string;
  duplicateAction: string;
  duplicateReview: DuplicateReview;
  hasNote: boolean;
}

/** Full record for the drawer (list rows stay lean; addresses are heavy). */
export interface MasterCustomerDetail extends MasterCustomer {
  cityZoho: string;
  cityVerified: string;
  citySource: string;
  locationBasis: string;
  billingAddress: string;
  notes: string;
  reviewedBy: string;
  reviewedAt: string;
  updatedAt: string;
}

export type DuplicateReview = 'open' | 'keep-master' | 'ignored';

export const DUPLICATE_REVIEWS: DuplicateReview[] = ['open', 'keep-master', 'ignored'];

export function isDuplicateReview(v: unknown): v is DuplicateReview {
  return typeof v === 'string' && (DUPLICATE_REVIEWS as string[]).includes(v);
}

/** Aggregate tiles + region counts. Computed once per cache window. */
export interface MasterDataTotals {
  total: number;
  active: number;
  inactive: number;
  /** 0 estimates and 0 sales orders — never quoted. */
  neverTouched: number;
  estimateOnly: number;
  salesOrderOnly: number;
  estimateAndOrder: number;
  duplicateRows: number;
  duplicateGroups: number;
  duplicateHigh: number;
  duplicateMedium: number;
  duplicateReview: number;
  duplicateReviewed: number;
  noPhone: number;
  noEmail: number;
  noGstin: number;
  noPincode: number;
  byRegion: Record<string, number>;
  /** Region ids present in the data, in R1..R4 order. */
  regionIds: string[];
}

export interface MasterDataPayload {
  generatedAt: string;
  /** Last audited write (import / edit / review) — the header stamp. */
  updatedAt: string;
  regions: MasterRegion[];
  rows: MasterCustomer[];
  totals: MasterDataTotals;
}

/** Fields an appointed editor may change. Region ownership stays with
 *  sales-head/MIS (see EDITOR_FIELDS vs MANAGER_FIELDS in service.ts). */
export interface CustomerPatch {
  displayName?: string;
  companyName?: string;
  contactPerson?: string;
  designation?: string;
  phones?: string[];
  emails?: string[];
  gstin?: string;
  pincode?: string;
  cityVerified?: string;
  billingAddress?: string;
  status?: string;
  notes?: string;
  region?: string;
  subArea?: string;
  state?: string;
}

/** Audit log row (insert-only) — who changed what, when. */
export interface MasterDataAuditEntry {
  actorId: string;
  actorName: string;
  action: 'editor-grant' | 'editor-revoke' | 'customer-edit' | 'duplicate-review' | 'import';
  entityId: string;
  detail?: Record<string, unknown>;
}

/** Incremental result of a JSON import. */
export interface MasterImportResult {
  received: number;
  inserted: number;
  updated: number;
  skipped: number;
  regions: number;
  errors: string[];
}

/** Canonical row produced by parse.toImportCustomer() — the only shape the
 *  store's upsert accepts. Mirrors the master extract with normalized values
 *  (phones/emails arrays, YYYY-MM-DD dates, derived type family/tag). */
export interface ImportCustomer {
  id: string;
  zohoCustomerId: string;
  region: string;
  zone: string;
  subArea: string;
  state: string;
  pincode: string;
  displayName: string;
  companyName: string;
  customerType: string;
  typeBase: string;
  typeTag: string;
  status: 'Active' | 'Inactive';
  contactPerson: string;
  designation: string;
  phones: string[];
  emails: string[];
  billingAddress: string;
  gstin: string;
  owner: string;
  pipelineStage: string;
  estimateCount: number;
  lastEstimateDate: string;
  salesOrderCount: number;
  lastSalesOrderDate: string;
  cityZoho: string;
  cityVerified: string;
  citySource: string;
  locationBasis: string;
  duplicateGroup: string;
  duplicateConfidence: string;
  suggestedAction: string;
}
