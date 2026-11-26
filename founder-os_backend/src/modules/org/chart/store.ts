// modules/org/chart/store.ts — D1 read + lazy seed for the editable chart.
import { prisma } from "../../../shared/prisma";
import type { OrgChartDepartment, OrgChartPosition, OrgChartResponse, OrgChartRow } from "./types";
import { ORG_CHART_SEED } from "./seed";

const model = () => (prisma as any).orgChartPosition;

async function seedChunk(rows: typeof ORG_CHART_SEED): Promise<void> {
  // D1 caps bound parameters per statement; 5 rows × 11 columns stays well below it.
  for (let i = 0; i < rows.length; i += 5) {
    await model().createMany({ data: rows.slice(i, i + 5), skipDuplicates: true });
  }
}

export async function ensureOrgChartSeeded(): Promise<void> {
  const count = await model().count();
  if (Number(count) > 0) return;
  await seedChunk(ORG_CHART_SEED.filter((r) => r.isTop));
  await seedChunk(ORG_CHART_SEED.filter((r) => !r.isTop));
}

export async function listChartRows(): Promise<OrgChartRow[]> {
  await ensureOrgChartSeeded();
  const rows: any[] = await model().findMany({ orderBy: { order: "asc" } });
  return rows.map((r) => ({ ...r, isTop: !!r.isTop, isHead: !!r.isHead, active: r.active !== false }));
}

function titleKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function buildChartResponse(
  rows: OrgChartRow[],
  canManage: boolean,
  source: "db" | "seed",
): OrgChartResponse {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const positions: OrgChartPosition[] = rows
    .filter((r) => r.active !== false)
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || String(a.title).localeCompare(String(b.title)))
    .map((r) => ({
      id: String(r.id),
      title: String(r.title),
      titleKey: String(r.titleKey ?? titleKey(r.title)),
      department: r.department ? String(r.department) : null,
      wing: (["Sales", "Marketing", "Operations"].includes(String(r.wing)) ? r.wing : "Operations") as any,
      reportsToId: r.reportsToId ? String(r.reportsToId) : null,
      reportsTo: r.reportsToId ? String(byId.get(String(r.reportsToId))?.title ?? "") || null : null,
      isTop: !!r.isTop,
      isHead: !!r.isHead,
      loginPosition: r.loginPosition ? String(r.loginPosition) : null,
      order: Number(r.order ?? 0),
    }));
  const deptMap = new Map<string, OrgChartDepartment>();
  for (const p of positions) {
    if (!p.department) continue;
    const d = deptMap.get(p.department) ?? { name: p.department, headTitle: null, count: 0 };
    d.count += 1;
    if (p.isHead) d.headTitle = p.title;
    deptMap.set(p.department, d);
  }
  return {
    positions,
    top: positions.find((p) => p.isTop)?.title ?? null,
    departments: [...deptMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    canManage,
    source,
  };
}

export async function getOrgChart(canManage: boolean): Promise<OrgChartResponse> {
  try {
    const rows = await listChartRows();
    if (rows.length) return buildChartResponse(rows, canManage, "db");
  } catch { /* migration not applied yet — seed is the read-only fallback */ }
  return buildChartResponse(ORG_CHART_SEED, false, "seed");
}

/** Title -> login position (null means a real chart title with no dashboard). */
export async function getChartTitleLookup(): Promise<Map<string, string | null> | null> {
  try {
    const rows = await listChartRows();
    if (!rows.length) return null;
    const out = new Map<string, string | null>();
    for (const r of rows) {
      if (r.active !== false) out.set(String(r.title).trim(), r.loginPosition ? String(r.loginPosition) : null);
    }
    return out;
  } catch {
    return null;
  }
}

/** Active chart row for an exact title (null when the chart has no such seat). */
export async function getChartRowByTitle(title: string): Promise<OrgChartRow | null> {
  try {
    const rows = await listChartRows();
    const key = String(title ?? "").trim();
    return (rows.find((r) => r.active !== false && String(r.title).trim() === key) as OrgChartRow) ?? null;
  } catch { return null; }
}

export async function getChartRow(id: string): Promise<OrgChartRow | null> {
  const row = await model().findUnique({ where: { id: String(id) } }) as any;
  return row ? { ...row, isTop: !!row.isTop, isHead: !!row.isHead, active: row.active !== false } : null;
}

export async function listChartPositions(): Promise<OrgChartPosition[]> {
  return (await getOrgChart(false)).positions;
}
