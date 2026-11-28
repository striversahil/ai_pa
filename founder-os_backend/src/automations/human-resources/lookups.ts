// lookups.ts — HR's Controller lists: employee document types, expense
// categories and asset types. All three share one CRUD surface.
import { prisma } from "../../shared/prisma";
import { HrError } from "./errors";
import {
  cleanLookupCreate, cleanLookupPatch, lookupDeletionPlan, type LookupKind,
} from "./lookups-parse";

const models: Record<LookupKind, () => any> = {
  "document-types": () => (prisma as any).humanResourcesDocumentType,
  "expense-categories": () => (prisma as any).humanResourcesExpenseCategory,
  "asset-types": () => (prisma as any).humanResourcesAssetType,
};

export function lookupModel(kind: LookupKind): any {
  return models[kind]();
}

export function lookupJson(kind: LookupKind, row: any, usageCount?: number) {
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    order: Number(row.order ?? 0),
    active: row.active !== false,
    description: kind === "document-types" ? String(row.description ?? "") : undefined,
    required: kind === "document-types" ? !!row.required : undefined,
    // How many live employee files are filed under a document type — the
    // Controller shows it and delete refuses while it is above zero.
    usageCount: kind === "document-types" ? Number(usageCount ?? 0) : undefined,
    defaultSpecs: kind === "asset-types" ? String(row.defaultSpecs ?? "") : undefined,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

export async function listLookups() {
  const [documentTypes, expenseCategories, assetTypes, filedDocs] = await Promise.all([
    models["document-types"]().findMany({ orderBy: { order: "asc" } }),
    models["expense-categories"]().findMany({ orderBy: { order: "asc" } }),
    models["asset-types"]().findMany({ orderBy: { order: "asc" } }),
    (prisma as any).humanResourcesMemberDocument.findMany({ where: { deleted: false } }),
  ]);
  const filed = new Map<string, number>();
  for (const doc of filedDocs ?? []) {
    const key = String(doc.documentTypeId);
    filed.set(key, (filed.get(key) ?? 0) + 1);
  }
  return {
    documentTypes: (documentTypes ?? []).map((r: any) => lookupJson("document-types", r, filed.get(String(r.id)) ?? 0)),
    expenseCategories: (expenseCategories ?? []).map((r: any) => lookupJson("expense-categories", r)),
    assetTypes: (assetTypes ?? []).map((r: any) => lookupJson("asset-types", r)),
  };
}

export async function createLookup(kind: LookupKind, input: Record<string, any>, actor: string | null) {
  const data = cleanLookupCreate(kind, input);
  const model = models[kind]();
  const existing = await model.findFirst({ where: { nameKey: data.nameKey } });
  if (existing) throw new HrError("that name already exists", 409);
  const row = await model.create({
    data: { ...data, createdBy: actor, updatedBy: actor },
  });
  return lookupJson(kind, row);
}

export async function updateLookup(kind: LookupKind, id: string, input: Record<string, any>, actor: string | null) {
  const model = models[kind]();
  const current = await model.findUnique({ where: { id: String(id) } });
  if (!current) throw new HrError("item not found", 404);
  const patch = cleanLookupPatch(kind, input);
  if (patch.nameKey && patch.nameKey !== current.nameKey) {
    const duplicate = await model.findFirst({ where: { nameKey: patch.nameKey, id: { not: String(id) } } });
    if (duplicate) throw new HrError("that name already exists", 409);
  }
  const row = await model.update({ where: { id: String(id) }, data: { ...patch, updatedBy: actor } });
  if (kind === "expense-categories" && patch.name) {
    await (prisma as any).humanResourcesExpense.updateMany({
      where: { categoryId: String(id) },
      data: { category: patch.name },
    });
  }
  return lookupJson(kind, row);
}

async function filedDocumentCount(documentTypeId: string): Promise<number> {
  return Number(await (prisma as any).humanResourcesMemberDocument.count({
    where: { documentTypeId: String(documentTypeId), deleted: false },
  }));
}

/**
 * DELETE one controller list item.
 * A document requirement is DELETED for real — HR should not have to keep a
 * retired checklist item around — but only while no employee file is filed
 * under it (the founder's rule). Files removed earlier already lost their KV
 * bytes, so their tombstones go with the type in the same breath.
 * Expense categories and asset types keep archiving: expenses and issued
 * assets still point at them as history.
 */
export async function deleteLookup(kind: LookupKind, id: string, actor: string | null) {
  const model = models[kind]();
  const current = await model.findUnique({ where: { id: String(id) } });
  if (!current) throw new HrError("item not found", 404);
  const filed = kind === "document-types" ? await filedDocumentCount(id) : 0;
  const plan = lookupDeletionPlan(kind, filed);
  if (plan.archival) return { ...(await archiveLookup(kind, id, actor)), archival: true };
  await (prisma as any).humanResourcesMemberDocument.deleteMany({
    where: { documentTypeId: String(id), deleted: true },
  });
  await model.delete({ where: { id: String(id) } });
  return { id: String(id), deleted: true, archival: false, usageCount: 0 };
}

export async function archiveLookup(kind: LookupKind, id: string, actor: string | null) {
  const model = models[kind]();
  const current = await model.findUnique({ where: { id: String(id) } });
  if (!current) throw new HrError("item not found", 404);
  if (kind === "asset-types") {
    const used = Number(await (prisma as any).humanResourcesPositionAsset.count({ where: { assetTypeId: String(id) } }));
    if (used) throw new HrError("remove this asset type from position standards first", 409);
  }
  const row = await model.update({ where: { id: String(id) }, data: { active: false, updatedBy: actor } });
  return lookupJson(kind, row);
}

export async function resolveExpenseCategory(
  data: { categoryId?: string | null; category?: string | null },
  opts: { allowArchived?: boolean } = {},
) {
  if (data.categoryId) {
    const hit = await findExpenseCategoryById(String(data.categoryId));
    if (!hit || (hit.active === false && !opts.allowArchived)) throw new HrError('expense category not found', 404);
    data.categoryId = String(hit.id);
    data.category = String(hit.name);
    return;
  }
  if (data.category) {
    const hit = await findExpenseCategoryByName(String(data.category));
    if (hit) {
      data.categoryId = String(hit.id);
      data.category = String(hit.name);
    }
  }
}

export async function findExpenseCategoryById(id: string): Promise<any | null> {
  return (prisma as any).humanResourcesExpenseCategory.findUnique({ where: { id: String(id) } });
}

export async function findExpenseCategoryByName(name: string): Promise<any | null> {
  return (prisma as any).humanResourcesExpenseCategory.findFirst({
    where: { nameKey: String(name ?? "").trim().toLowerCase() },
  });
}