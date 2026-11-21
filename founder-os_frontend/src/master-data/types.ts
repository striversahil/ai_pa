// types.ts — Customer master shapes served by the worker.
//
// MIRROR: founder-os_backend/src/modules/master-data/types.ts (same field names;
// the backend is the source of truth — change both together).

export interface MasterRegion {
  region: string;
  zone: string;
  coverage: string;
  salesPerson: string;
  allottedName: string;
}

export type DuplicateReview = "open" | "keep-master" | "ignored";

export interface MasterCustomer {
  id: string;
  zohoCustomerId: string;
  name: string;
  company: string;
  customerType: string;
  typeBase: string;
  typeTag: string;
  status: string;
  contact: string;
  designation: string;
  region: string;
  zone: string;
  subArea: string;
  state: string;
  /** District within the state (founder file 2026-11-14). '' = unplaced. */
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

/** Region-scoped KPI tiles — COUNT/SUM over the whole region, never a page.
 *  mirror: founder-os_backend/src/modules/master-data/types.ts MasterRowSummary */
export interface RowSummary {
  total: number;
  active: number;
  inactive: number;
  neverTouched: number;
  withOrders: number;
  duplicateGroups: number;
  duplicateOpenGroups: number;
  noPhone: number;
  noEmail: number;
  noGstin: number;
  noPincode: number;
}

export interface FilterOptions {
  types: string[];
  states: string[];
  districts: string[];
  subAreas: string[];
  owners: string[];
  pipelines: string[];
}

/** GET /api/master-data/summary — header + region tabs (whole book), tiles +
 *  filter options (one region). Customers page via /api/master-data/customers.
 *  mirror: backend MasterSummary */
export interface MasterSummary {
  updatedAt: string;
  regions: MasterRegion[];
  total: number;
  byRegion: Record<string, number>;
  regionIds: string[];
  summary: RowSummary;
  options: FilterOptions;
}

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

/** One sales-head-allowed client-type base with its segment + book count. */
export interface TypeBaseEntry {
  base: string;
  segment: string;
  count: number;
}

export interface EditorEntry {
  userId: string;
  name: string;
  email: string;
  picture: string | null;
  isRoot: boolean;
  canEdit: boolean;
  implicit: boolean;
  appointedBy: string;
  appointedAt: string;
}

export interface MasterImportResult {
  received: number;
  inserted: number;
  updated: number;
  skipped: number;
  regions: number;
  errors: string[];
}

export interface MasterCapabilities {
  canEdit: boolean;
  canAppoint: boolean;
  canImport: boolean;
  canDelete: boolean;
}
