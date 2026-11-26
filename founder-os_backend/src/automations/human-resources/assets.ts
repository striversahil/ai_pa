// assets.ts — employee-held assets (laptop/phone/SIM...) plus role standards.
import { prisma } from "../../shared/prisma";
import { HrError } from "./errors";
import { lookupJson } from "./lookups";
import { listChartPositions } from "../../modules/org/chart/store";
import { cleanAssetCreate, cleanAssetPatch, cleanPositionAssetCreate } from "./assets-parse";

export function assetJson(row: any, member?: any, type?: any) {
  if (!row) return null;
  return {
    id: String(row.id),
    memberId: String(row.memberId),
    memberName: member ? String(member.name ?? "") : "",
    memberDesignation: member?.designation ? String(member.designation) : null,
    assetTypeId: String(row.assetTypeId),
    assetTypeName: type ? String(type.name ?? "") : "",
    label: String(row.label ?? ""),
    identifier: row.identifier ? String(row.identifier) : "",
    specs: row.specs ? String(row.specs) : "",
    status: String(row.status ?? "assigned"),
    assignedOn: String(row.assignedOn ?? ""),
    returnedOn: row.returnedOn ? String(row.returnedOn) : null,
    notes: row.notes ? String(row.notes) : "",
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

function positionAssetJson(row: any, type?: any) {
  return {
    id: String(row.id),
    orgPositionId: String(row.orgPositionId),
    assetTypeId: String(row.assetTypeId),
    assetTypeName: type ? String(type.name ?? "") : "",
    quantity: Number(row.quantity ?? 1),
    specNote: row.specNote ? String(row.specNote) : "",
    required: row.required !== false,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

export async function listAssets() {
  const [rows, members, types, positions, standards] = await Promise.all([
    (prisma as any).humanResourcesAsset.findMany({ where: { deleted: false }, orderBy: { createdAt: "desc" } }),
    (prisma as any).humanResourcesMember.findMany({ where: { deleted: false } }),
    (prisma as any).humanResourcesAssetType.findMany({ orderBy: { order: "asc" } }),
    listChartPositions(),
    (prisma as any).humanResourcesPositionAsset.findMany(),
  ]);
  const memberById = new Map((members ?? []).map((m: any) => [String(m.id), m]));
  const typeById = new Map((types ?? []).map((t: any) => [String(t.id), t]));
  const standardsByPosition = new Map<string, any[]>();
  for (const row of standards ?? []) {
    const id = String(row.orgPositionId);
    standardsByPosition.set(id, [...(standardsByPosition.get(id) ?? []), positionAssetJson(row, typeById.get(String(row.assetTypeId)))]);
  }
  return {
    assets: (rows ?? []).map((r: any) => assetJson(r, memberById.get(String(r.memberId)), typeById.get(String(r.assetTypeId)))),
    assetTypes: (types ?? []).map((t: any) => lookupJson("asset-types", t)),
    positions: positions.map((p) => ({
      id: p.id,
      title: p.title,
      department: p.department,
      loginPosition: p.loginPosition,
      standards: standardsByPosition.get(p.id) ?? [],
    })),
  };
}

async function assertMember(id: string) {
  const row: any = await (prisma as any).humanResourcesMember.findUnique({ where: { id: String(id) } });
  if (!row || row.deleted) throw new HrError("employee not found", 404);
  return row;
}

async function assertType(id: string) {
  const row: any = await (prisma as any).humanResourcesAssetType.findUnique({ where: { id: String(id) } });
  if (!row || row.active === false) throw new HrError("asset type not found", 404);
  return row;
}

export async function createAsset(input: Record<string, any>, actor: string | null) {
  const data = cleanAssetCreate(input);
  await assertMember(data.memberId);
  await assertType(data.assetTypeId);
  const row = await (prisma as any).humanResourcesAsset.create({
    data: { ...data, deleted: false, createdBy: actor, updatedBy: actor },
  });
  return assetJson(row);
}

export async function updateAsset(id: string, input: Record<string, any>, actor: string | null) {
  const current: any = await (prisma as any).humanResourcesAsset.findUnique({ where: { id: String(id) } });
  if (!current || current.deleted) throw new HrError("asset not found", 404);
  const patch = cleanAssetPatch(input);
  if (patch.memberId) await assertMember(patch.memberId);
  if (patch.assetTypeId && String(patch.assetTypeId) !== String(current.assetTypeId)) await assertType(patch.assetTypeId);
  const row = await (prisma as any).humanResourcesAsset.update({
    where: { id: String(id) },
    data: { ...patch, updatedBy: actor },
  });
  return assetJson(row);
}

export async function deleteAsset(id: string, actor: string | null) {
  const current: any = await (prisma as any).humanResourcesAsset.findUnique({ where: { id: String(id) } });
  if (!current || current.deleted) throw new HrError("asset not found", 404);
  await (prisma as any).humanResourcesAsset.update({
    where: { id: String(id) },
    data: { deleted: true, updatedBy: actor },
  });
  return { ok: true };
}

export async function createPositionAsset(input: Record<string, any>) {
  const data = cleanPositionAssetCreate(input);
  const position: any = await (prisma as any).orgChartPosition.findUnique({ where: { id: data.orgPositionId } });
  if (!position) throw new HrError("position not found", 404);
  await assertType(data.assetTypeId);
  const existing = await (prisma as any).humanResourcesPositionAsset.findFirst({
    where: { orgPositionId: data.orgPositionId, assetTypeId: data.assetTypeId },
  });
  if (existing) throw new HrError("that asset is already a standard for this position", 409);
  const row = await (prisma as any).humanResourcesPositionAsset.create({ data });
  return positionAssetJson(row);
}

export async function updatePositionAsset(id: string, input: Record<string, any>) {
  const current: any = await (prisma as any).humanResourcesPositionAsset.findUnique({ where: { id: String(id) } });
  if (!current) throw new HrError("position asset not found", 404);
  const data: any = {};
  if (input.quantity !== undefined) {
    const n = Number(input.quantity);
    if (!Number.isFinite(n) || n < 1 || n > 100) throw new HrError("quantity must be between 1 and 100");
    data.quantity = Math.round(n);
  }
  if (input.specNote !== undefined) data.specNote = String(input.specNote ?? "").trim().slice(0, 300) || null;
  if (input.required !== undefined) data.required = input.required === true || input.required === "true" || input.required === 1;
  if (!Object.keys(data).length) throw new HrError("nothing to update");
  const row = await (prisma as any).humanResourcesPositionAsset.update({ where: { id: String(id) }, data });
  return positionAssetJson(row);
}

export async function deletePositionAsset(id: string) {
  const current: any = await (prisma as any).humanResourcesPositionAsset.findUnique({ where: { id: String(id) } });
  if (!current) throw new HrError("position asset not found", 404);
  await (prisma as any).humanResourcesPositionAsset.delete({ where: { id: String(id) } });
  return { ok: true };
}
