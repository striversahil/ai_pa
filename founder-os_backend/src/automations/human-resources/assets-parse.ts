// Validation for employee assets and per-position asset standards.
import { HrError } from "./errors";
import { isValidDate, istDateStr } from "./parse";

export const ASSET_STATUSES = ["assigned", "in_repair", "returned", "lost"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function optionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  return text(value, max) || null;
}

function date(value: unknown, fallback: string | null): string | null {
  if (value === null || value === undefined || value === "") return fallback;
  const s = String(value).slice(0, 10);
  if (!isValidDate(s)) throw new HrError("date must be YYYY-MM-DD");
  return s;
}

function status(value: unknown): AssetStatus {
  const s = String(value ?? "assigned").trim();
  if (!ASSET_STATUSES.includes(s as AssetStatus)) throw new HrError("status must be assigned|in_repair|returned|lost");
  return s as AssetStatus;
}

function quantity(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 100) throw new HrError("quantity must be between 1 and 100");
  return Math.round(n);
}

export interface AssetCreate {
  memberId: string;
  assetTypeId: string;
  label: string;
  identifier: string | null;
  specs: string | null;
  status: AssetStatus;
  assignedOn: string;
  returnedOn: string | null;
  notes: string | null;
}

export function cleanAssetCreate(input: Record<string, any>): AssetCreate {
  const memberId = text(input.memberId, 100);
  const assetTypeId = text(input.assetTypeId, 100);
  if (!memberId) throw new HrError("employee is required");
  if (!assetTypeId) throw new HrError("asset type is required");
  const today = istDateStr();
  return {
    memberId,
    assetTypeId,
    label: text(input.label, 120),
    identifier: optionalText(input.identifier, 120),
    specs: optionalText(input.specs, 500),
    status: status(input.status),
    assignedOn: date(input.assignedOn, today) as string,
    returnedOn: date(input.returnedOn, null),
    notes: optionalText(input.notes, 1000),
  };
}

export function cleanAssetPatch(input: Record<string, any>): Partial<AssetCreate> {
  const out: Partial<AssetCreate> = {};
  if (input.memberId !== undefined) {
    const memberId = text(input.memberId, 100);
    if (!memberId) throw new HrError("employee is required");
    out.memberId = memberId;
  }
  if (input.assetTypeId !== undefined) {
    const assetTypeId = text(input.assetTypeId, 100);
    if (!assetTypeId) throw new HrError("asset type is required");
    out.assetTypeId = assetTypeId;
  }
  if (input.label !== undefined) out.label = text(input.label, 120);
  if (input.identifier !== undefined) out.identifier = optionalText(input.identifier, 120);
  if (input.specs !== undefined) out.specs = optionalText(input.specs, 500);
  if (input.status !== undefined) out.status = status(input.status);
  if (input.assignedOn !== undefined) out.assignedOn = date(input.assignedOn, null) as string;
  if (input.returnedOn !== undefined) out.returnedOn = date(input.returnedOn, null);
  if (input.notes !== undefined) out.notes = optionalText(input.notes, 1000);
  if (Object.keys(out).length === 0) throw new HrError("nothing to update");
  return out;
}

export interface PositionAssetCreate {
  orgPositionId: string;
  assetTypeId: string;
  quantity: number;
  specNote: string | null;
  required: boolean;
}

export function cleanPositionAssetCreate(input: Record<string, any>): PositionAssetCreate {
  const orgPositionId = text(input.orgPositionId, 100);
  const assetTypeId = text(input.assetTypeId, 100);
  if (!orgPositionId) throw new HrError("position is required");
  if (!assetTypeId) throw new HrError("asset type is required");
  return {
    orgPositionId,
    assetTypeId,
    quantity: quantity(input.quantity ?? 1),
    specNote: optionalText(input.specNote, 300),
    required: input.required === undefined ? true : input.required === true || input.required === "true" || input.required === 1,
  };
}
