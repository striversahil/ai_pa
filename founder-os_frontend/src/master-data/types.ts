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

export interface MasterDataTotals {
  total: number;
  active: number;
  inactive: number;
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
  regionIds: string[];
}

export interface MasterDataPayload {
  generatedAt: string;
  updatedAt: string;
  regions: MasterRegion[];
  rows: MasterCustomer[];
  totals: MasterDataTotals;
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
}
