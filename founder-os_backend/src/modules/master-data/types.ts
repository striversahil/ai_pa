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
  /** District within the state (India Post mapping, founder file 2026-11-14).
   *  '' = unplaced. Manager-only edit, like state/subArea; imports never write it. */
  district: string;
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

/** Region-scoped KPI tiles (COUNT/SUM over the whole region, never a page). */
export interface MasterRowSummary {
  total: number;
  active: number;
  inactive: number;
  /** 0 estimates and 0 sales orders — never quoted. */
  neverTouched: number;
  withOrders: number;
  duplicateGroups: number;
  duplicateOpenGroups: number;
  noPhone: number;
  noEmail: number;
  noGstin: number;
  noPincode: number;
}

export interface MasterFilterOptions {
  types: string[];
  states: string[];
  /** Only for the selected state (districts belong to a state). */
  districts: string[];
  subAreas: string[];
  owners: string[];
  pipelines: string[];
}

/** GET /api/master-data/summary (+ the workspace data payload, region ''):
 *  header + region tabs over the whole book, tiles/options for one region.
 *  Customer rows page separately via GET /api/master-data/customers. */
export interface MasterSummary {
  /** Last audited write (import / edit / review) — the header stamp. */
  updatedAt: string;
  regions: MasterRegion[];
  /** Whole live book. */
  total: number;
  byRegion: Record<string, number>;
  /** Region ids present in the data, in R1..R4 order. */
  regionIds: string[];
  summary: MasterRowSummary;
  options: MasterFilterOptions;
}

/** Fields an appointed editor may change. Region ownership stays with
 *  sales-head (see EDITOR_FIELDS vs MANAGER_FIELDS in service.ts).
 *  Client type is editor-assignable but value-constrained: the base must be
 *  one of the sales-head's allowed bases (ClientTypeRule); the tag is a free
 *  qualifier. The server normalizes both into customerType/base/tag. */
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
  /** Manager-only geography, like state/subArea. */
  district?: string;
  customerType?: string;
  typeTag?: string;
}

/** Audit log row (insert-only) — who changed what, when. */
export interface MasterDataAuditEntry {
  actorId: string;
  actorName: string;
  action: 'editor-grant' | 'editor-revoke' | 'customer-edit' | 'customer-delete' | 'duplicate-review' | 'import';
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
  /** Rows that actually carried each contact column — a 0 means the FILE was
   *  empty there, not that the parser dropped it. */
  fields?: { contactPerson: number; phones: number; emails: number; gstin: number; city: number };
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
  /** Lead requirement text (conveyor/trader imports). Seeded on insert only —
   *  the upsert keeps hand-written notes (see store.prepareUpsert). */
  notes: string;
}
