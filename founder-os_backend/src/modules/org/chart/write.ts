// modules/org/chart/write.ts — owner-only chart edits with cycle/seat guards.
import { prisma } from "../../../shared/prisma";
import { HrError } from "../../../automations/human-resources/errors";
import { cleanChartCreate, cleanChartPatch, wouldCycle } from "./parse";
import { ensureOrgChartSeeded, getChartRow, listChartRows } from "./store";

const model = () => (prisma as any).orgChartPosition;

function topId(rows: Array<{ id: string; isTop: boolean }>): string | null {
  return rows.find((r) => r.isTop)?.id ?? null;
}

async function activeSeatCount(title: string): Promise<number> {
  return Number(await (prisma as any).humanResourcesMember.count({
    where: { designation: title, deleted: false, active: true },
  }));
}

export async function createChartPosition(
  input: Record<string, any>,
  actor: string | null,
  roleTitles: Set<string>,
) {
  await ensureOrgChartSeeded();
  const data = cleanChartCreate(input);
  const rows = await listChartRows();
  const key = data.title.trim().toLowerCase();
  if (rows.some((r) => String(r.titleKey) === key)) throw new HrError("a position with that title already exists", 409);
  const top = topId(rows);
  if (!top) throw new HrError("chart has no top position", 500);
  const reportsToId = data.reportsToId ?? top;
  if (!rows.some((r) => String(r.id) === String(reportsToId))) throw new HrError("reports-to position not found", 404);
  if (data.isHead && String(reportsToId) !== String(top)) {
    throw new HrError("a department head must report to the top position");
  }
  if (roleTitles.has(data.title)) throw new HrError("a role already uses that chart title", 409);
  const order = rows.reduce((m, r) => Math.max(m, Number(r.order ?? 0)), 0) + 1;
  return model().create({
    data: {
      title: data.title,
      titleKey: key,
      department: data.department ?? null,
      wing: data.wing,
      reportsToId,
      isTop: false,
      isHead: !!data.isHead,
      loginPosition: data.loginPosition ?? null,
      order,
      active: true,
    },
  });
}

export async function updateChartPosition(
  id: string,
  input: Record<string, any>,
  actor: string | null,
  roleTitles: Set<string>,
) {
  await ensureOrgChartSeeded();
  const current = await getChartRow(id);
  if (!current) throw new HrError("position not found", 404);
  const patch = cleanChartPatch(input);
  if (current.isTop && patch.title !== undefined && String(patch.title) !== String(current.title)) {
    throw new HrError("the top position cannot be renamed");
  }
  const rows = await listChartRows();
  const nextTitle = String(patch.title ?? current.title);
  const titleChanged = nextTitle !== String(current.title);
  if (titleChanged) {
    if (roleTitles.has(String(current.title))) throw new HrError("a role still uses this chart title; re-map the role first", 409);
    if (roleTitles.has(nextTitle)) throw new HrError("a role already uses that chart title", 409);
    if (await activeSeatCount(String(current.title))) throw new HrError("active employees still hold this position; move them first", 409);
    const key = nextTitle.trim().toLowerCase();
    if (rows.some((r) => String(r.id) !== String(id) && String(r.titleKey) === key)) {
      throw new HrError("a position with that title already exists", 409);
    }
    (patch as any).titleKey = key;
  }
  const nextParent = patch.reportsToId !== undefined ? patch.reportsToId : current.reportsToId;
  if (current.isTop) {
    if (patch.reportsToId !== undefined && patch.reportsToId !== null) throw new HrError("the top position cannot report to another position");
    if (patch.isHead) throw new HrError("the top position cannot be a department head");
  } else {
    const top = topId(rows);
    if (!nextParent) throw new HrError("reports-to position is required");
    if (!rows.some((r) => String(r.id) === String(nextParent))) throw new HrError("reports-to position not found", 404);
    if (wouldCycle(rows.map((r) => ({ id: String(r.id), reportsToId: r.reportsToId ? String(r.reportsToId) : null })), String(id), String(nextParent))) {
      throw new HrError("a position cannot report to itself or one of its reports", 400);
    }
    const nextHead = patch.isHead !== undefined ? !!patch.isHead : !!current.isHead;
    if (nextHead && String(nextParent) !== String(top)) throw new HrError("a department head must report to the top position");
  }
  return model().update({
    where: { id: String(id) },
    data: patch,
  });
}

export async function deleteChartPosition(id: string, roleTitles: Set<string>) {
  await ensureOrgChartSeeded();
  const current = await getChartRow(id);
  if (!current) throw new HrError("position not found", 404);
  if (current.isTop) throw new HrError("the top position cannot be deleted");
  const children = Number(await model().count({ where: { reportsToId: String(id) } }));
  if (children) throw new HrError("move the reporting positions first", 409);
  if (await activeSeatCount(String(current.title))) throw new HrError("active employees still hold this position; move them first", 409);
  const standards = Number(await (prisma as any).humanResourcesPositionAsset.count({ where: { orgPositionId: String(id) } }));
  if (standards) throw new HrError("remove this position's asset standards first", 409);
  if (roleTitles.has(String(current.title))) throw new HrError("a role still uses this chart title; re-map the role first", 409);
  await model().delete({ where: { id: String(id) } });
  return { ok: true };
}
