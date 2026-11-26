// member-documents.ts — employee document metadata (D1) + KV keys for bytes.
import { prisma } from "../../shared/prisma";
import { HrError } from "./errors";
import { lookupJson } from "./lookups";

export function memberDocumentJson(row: any) {
  if (!row) return null;
  return {
    id: String(row.id),
    memberId: String(row.memberId),
    documentTypeId: String(row.documentTypeId),
    title: String(row.title ?? ""),
    fileName: String(row.fileName ?? ""),
    mime: String(row.mime ?? "application/pdf"),
    size: Number(row.size) || 0,
    uploadedBy: String(row.uploadedBy ?? ""),
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    url: "/api/human-resources/member-docs/" + String(row.id) + "/file",
  };
}

async function memberRow(id: string) {
  const member: any = await (prisma as any).humanResourcesMember.findUnique({ where: { id: String(id) } });
  if (!member || member.deleted) throw new HrError("employee not found", 404);
  return member;
}

export async function listMemberDocuments(memberId: string) {
  const member = await memberRow(memberId);
  const [types, docs] = await Promise.all([
    (prisma as any).humanResourcesDocumentType.findMany({ orderBy: { order: "asc" } }),
    (prisma as any).humanResourcesMemberDocument.findMany({
      where: { memberId: String(memberId), deleted: false },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const rows = (docs ?? []).map((r: any) => memberDocumentJson(r));
  const byType = new Map<string, any[]>();
  for (const doc of rows) byType.set(doc.documentTypeId, [...(byType.get(doc.documentTypeId) ?? []), doc]);
  const documentTypes = (types ?? [])
    .filter((t: any) => t.active !== false || (byType.get(String(t.id))?.length ?? 0) > 0)
    .map((t: any) => ({
      ...lookupJson("document-types", t),
      documents: byType.get(String(t.id)) ?? [],
      uploaded: (byType.get(String(t.id)) ?? []).length,
    }));
  const required = documentTypes.filter((t: any) => t.required && t.active !== false);
  const uploadedRequired = required.filter((t: any) => t.uploaded > 0).length;
  return {
    member: {
      id: String(member.id),
      name: String(member.name ?? ""),
      designation: member.designation ? String(member.designation) : null,
      department: member.department ? String(member.department) : null,
    },
    documentTypes,
    documents: rows,
    completeness: { required: required.length, uploaded: uploadedRequired },
  };
}

export async function createMemberDocument(input: {
  memberId: string;
  documentTypeId: string;
  title?: string;
  fileName: string;
  mime: string;
  size: number;
  kvKey: string;
  uploadedBy?: string;
}) {
  await memberRow(input.memberId);
  const type: any = await (prisma as any).humanResourcesDocumentType.findUnique({ where: { id: String(input.documentTypeId) } });
  if (!type || type.active === false) throw new HrError("document type not found", 404);
  const row = await (prisma as any).humanResourcesMemberDocument.create({
    data: {
      memberId: String(input.memberId),
      documentTypeId: String(input.documentTypeId),
      title: String(input.title ?? "").trim().slice(0, 120) || String(type.name ?? ""),
      fileName: String(input.fileName ?? "").slice(0, 200),
      mime: String(input.mime ?? "application/pdf"),
      size: Number(input.size) || 0,
      kvKey: String(input.kvKey),
      uploadedBy: String(input.uploadedBy ?? ""),
      deleted: false,
    },
  });
  return memberDocumentJson(row);
}

export async function getMemberDocument(id: string) {
  return (prisma as any).humanResourcesMemberDocument.findUnique({ where: { id: String(id) } });
}

export async function deleteMemberDocument(id: string) {
  const row: any = await getMemberDocument(id);
  if (!row || row.deleted) throw new HrError("document not found", 404);
  await (prisma as any).humanResourcesMemberDocument.update({ where: { id: String(id) }, data: { deleted: true } });
  return { kvKey: String(row.kvKey ?? "") };
}
