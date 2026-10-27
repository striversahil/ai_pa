// HR hiring kit persistence: positions (job titles) with at most ONE job
// description and ONE SOP document each. Metadata lives in D1; PDF bytes are
// stored by the route layer in CHAT_FILES KV and referenced by `kvKey`.
// Mirrors the frontend helpers in founder-os_frontend/src/hr/hiring-positions.ts.
import { prisma } from '../../shared/prisma';
import { HrError } from './errors';
import {
  cleanImportNames, cleanPositionName, positionNameKey,
  type HiringDocKind,
} from './hiring-positions-parse';

export function positionDocJson(row: any) {
  if (!row) return null;
  return {
    id: String(row.id),
    kind: row.kind === 'sop' ? 'sop' : 'jd',
    title: String(row.title || row.fileName || ''),
    fileName: String(row.fileName ?? ''),
    mime: String(row.mime ?? 'application/pdf'),
    size: Number(row.size) || 0,
    uploadedBy: String(row.uploadedBy ?? ''),
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    url: `/api/human-resources/position-docs/${String(row.id)}/file`,
  };
}

export function hiringPositionJson(row: any, docs: any[]) {
  const slots: Record<HiringDocKind, any[]> = { jd: [], sop: [] };
  for (const doc of docs ?? []) {
    if (doc?.kind === 'jd' || doc?.kind === 'sop') slots[doc.kind].push(positionDocJson(doc));
  }
  const newestFirst = (a: any, b: any) =>
    String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
    || String(b.id).localeCompare(String(a.id));
  slots.jd.sort(newestFirst);
  slots.sop.sort(newestFirst);
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    docs: slots,
  };
}

async function positionRow(id: string) {
  const row: any = await (prisma as any).humanResourcesHiringPosition.findUnique({ where: { id } });
  if (!row) throw new HrError('position not found', 404);
  return row;
}

async function docsForPositions(positionIds: string[]) {
  if (positionIds.length === 0) return new Map<string, any[]>();
  const rows: any[] = await (prisma as any).humanResourcesPositionDoc.findMany({
    where: { positionId: { in: positionIds } },
  });
  const grouped = new Map<string, any[]>();
  for (const row of rows) {
    const key = String(row.positionId);
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  return grouped;
}

export async function listHiringPositions() {
  const rows: any[] = await (prisma as any).humanResourcesHiringPosition.findMany({
    orderBy: { name: 'asc' },
  });
  const grouped = await docsForPositions(rows.map((row) => String(row.id)));
  return rows.map((row) => hiringPositionJson(row, grouped.get(String(row.id)) ?? []));
}

export async function getHiringPosition(id: string) {
  const row = await positionRow(id);
  const grouped = await docsForPositions([String(row.id)]);
  return hiringPositionJson(row, grouped.get(String(row.id)) ?? []);
}

export async function createHiringPosition(input: Record<string, any>, actor: string | null) {
  const name = cleanPositionName(input?.name);
  const nameKey = positionNameKey(name);
  const existing: any = await (prisma as any).humanResourcesHiringPosition.findFirst({ where: { nameKey } });
  if (existing) throw new HrError('A position with this name already exists', 409);
  const row: any = await (prisma as any).humanResourcesHiringPosition.create({
    data: { name, nameKey, createdBy: actor ?? '' },
  });
  return hiringPositionJson(row, []);
}

/** Seeds positions from the employee roster (one click in the UI). Skips
 *  anything that already exists (case/space/punctuation-insensitive). */
export async function importHiringPositions(values: unknown, actor: string | null) {
  const names = cleanImportNames(values);
  const existing: any[] = await (prisma as any).humanResourcesHiringPosition.findMany({});
  const taken = new Set(existing.map((row) => String(row.nameKey)));
  let created = 0;
  let skipped = 0;
  for (const name of names) {
    const nameKey = positionNameKey(name);
    if (taken.has(nameKey)) { skipped += 1; continue; }
    await (prisma as any).humanResourcesHiringPosition.create({
      data: { name, nameKey, createdBy: actor ?? '' },
    });
    taken.add(nameKey);
    created += 1;
  }
  return { created, skipped, positions: await listHiringPositions() };
}

export async function renameHiringPosition(id: string, input: Record<string, any>) {
  const current = await positionRow(id);
  const name = cleanPositionName(input?.name);
  const nameKey = positionNameKey(name);
  if (nameKey !== current.nameKey) {
    const clash: any = await (prisma as any).humanResourcesHiringPosition.findFirst({ where: { nameKey } });
    if (clash && String(clash.id) !== String(id)) {
      throw new HrError('A position with this name already exists', 409);
    }
  }
  const row: any = await (prisma as any).humanResourcesHiringPosition.update({
    where: { id }, data: { name, nameKey },
  });
  const grouped = await docsForPositions([String(id)]);
  return hiringPositionJson(row, grouped.get(String(id)) ?? []);
}

/** Removes the position and its document rows. Returns the KV keys so the
 *  route can delete the PDF bytes (D1 stays the source of truth). */
export async function deleteHiringPosition(id: string) {
  const row = await positionRow(id);
  const docs: any[] = await (prisma as any).humanResourcesPositionDoc.findMany({
    where: { positionId: String(row.id) },
  });
  await (prisma as any).humanResourcesPositionDoc.deleteMany({ where: { positionId: String(row.id) } });
  await (prisma as any).humanResourcesHiringPosition.delete({ where: { id: String(row.id) } });
  return { kvKeys: docs.map((doc) => String(doc.kvKey ?? '')).filter(Boolean) };
}

export async function getPositionDoc(id: string) {
  return (prisma as any).humanResourcesPositionDoc.findUnique({ where: { id } }) as Promise<any | null>;
}

/** Adds another JD/SOP document to a position (a role can hold many). */
export async function createPositionDoc(input: {
  positionId: string;
  kind: HiringDocKind;
  title: string;
  fileName: string;
  mime: string;
  size: number;
  kvKey: string;
  uploadedBy: string;
}) {
  const position = await positionRow(input.positionId);
  const row: any = await (prisma as any).humanResourcesPositionDoc.create({
    data: {
      positionId: String(position.id),
      kind: input.kind,
      title: input.title,
      fileName: input.fileName,
      mime: input.mime,
      size: input.size,
      kvKey: input.kvKey,
      uploadedBy: input.uploadedBy,
    },
  });
  return positionDocJson(row);
}

/** Removes one document (by id). Returns its KV key so the route can drop the
 *  PDF bytes. */
export async function deletePositionDoc(id: string) {
  const current: any = await getPositionDoc(id);
  if (!current) throw new HrError('document not found', 404);
  await (prisma as any).humanResourcesPositionDoc.delete({ where: { id: String(current.id) } });
  return { kvKey: String(current.kvKey ?? '') || null };
}
