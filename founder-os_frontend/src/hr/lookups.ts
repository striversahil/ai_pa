// HR Controller lists (document types, expense categories, asset types).
export type LookupKind = "document-types" | "expense-categories" | "asset-types";

export interface HrLookup {
  id: string;
  name: string;
  order: number;
  active: boolean;
  description?: string;
  required?: boolean;
  defaultSpecs?: string;
}

export interface HrControllerData {
  documentTypes: HrLookup[];
  expenseCategories: HrLookup[];
  assetTypes: HrLookup[];
}
