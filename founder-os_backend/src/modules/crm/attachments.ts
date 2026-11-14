// ── CRM sales-order attachments: persistence (D1 through the prisma shim) ───
//
// SoAttachment rows (keyed by SO number) + file bytes in CHAT_FILES KV.
// Mirrors modules/crm/store.ts: mapping + writes live here; HTTP, authz and
// byte-serving stay in worker/routes/crm-attachments.ts.
export interface SoAttachmentInput {
  soNumber: string;
  kind: string;
  fileName: string;
  mime: string;
  size: number;
  kvKey: string;
  uploadedBy: string;
}

export function toSoAttachmentJson(row: any) {
  return {
    id: String(row?.id ?? ''),
    soNumber: String(row?.soNumber ?? ''),
    kind: String(row?.kind ?? 'other'),
    fileName: String(row?.fileName ?? ''),
    mime: String(row?.mime ?? 'application/octet-stream'),
    size: Number(row?.size ?? 0),
    uploadedBy: String(row?.uploadedBy ?? ''),
    createdAt: row?.createdAt instanceof Date ? row.createdAt.toISOString() : String(row?.createdAt ?? ''),
    url: `/api/crm/files/${String(row?.id ?? '')}`,
  };
}

export async function createSoAttachment(prisma: any, input: SoAttachmentInput): Promise<any> {
  return prisma.soAttachment.create({
    data: {
      id: crypto.randomUUID(),
      soNumber: input.soNumber,
      kind: input.kind,
      fileName: input.fileName.slice(0, 200),
      mime: input.mime,
      size: input.size,
      kvKey: input.kvKey,
      uploadedBy: String(input.uploadedBy).slice(0, 200),
      createdAt: new Date(),
    },
  });
}

export async function listSoAttachments(prisma: any, soNumber: string): Promise<any[]> {
  const rows = await prisma.soAttachment.findMany({
    where: { soNumber },
    orderBy: { createdAt: 'desc' },
  }).catch(() => []);
  return (rows as any[]) ?? [];
}

export async function findSoAttachment(prisma: any, id: string): Promise<any | null> {
  return prisma.soAttachment.findUnique({ where: { id: id ?? '' } }).catch(() => null);
}

export async function deleteSoAttachment(prisma: any, id: string): Promise<void> {
  await prisma.soAttachment.delete({ where: { id: String(id) } }).catch(() => {});
}
