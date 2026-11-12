// Extracted verbatim from CustomerDrawer.tsx by scripts/refactor/split-module.mjs.
// CustomerDrawer.tsx re-exports everything public here, so existing imports keep working.


export interface Draft {
  displayName: string;
  companyName: string;
  customerType: string;
  typeTag: string;
  contactPerson: string;
  designation: string;
  phones: string;
  emails: string;
  gstin: string;
  pincode: string;
  cityVerified: string;
  billingAddress: string;
  status: string;
  notes: string;
  region: string;
  subArea: string;
  state: string;
}
