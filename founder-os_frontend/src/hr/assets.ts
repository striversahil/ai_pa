// Employee assets + role-position standards.
export interface HrAssetType {
  id: string;
  name: string;
  order: number;
  active: boolean;
  defaultSpecs?: string;
}

export interface HrAsset {
  id: string;
  memberId: string;
  memberName: string;
  memberDesignation: string | null;
  assetTypeId: string;
  assetTypeName: string;
  label: string;
  identifier: string;
  specs: string;
  status: "assigned" | "in_repair" | "returned" | "lost";
  assignedOn: string;
  returnedOn: string | null;
  notes: string;
}

export interface HrPositionAsset {
  id: string;
  orgPositionId: string;
  assetTypeId: string;
  assetTypeName: string;
  quantity: number;
  specNote: string;
  required: boolean;
}

export interface HrAssetPosition {
  id: string;
  title: string;
  department: string | null;
  loginPosition: string | null;
  standards: HrPositionAsset[];
}

export interface HrAssetsData {
  assets: HrAsset[];
  assetTypes: HrAssetType[];
  positions: HrAssetPosition[];
}
