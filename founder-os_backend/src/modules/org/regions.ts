// modules/org/regions.ts — the sales posting rule (region catalog + chart-seat
// allotment) behind the single person save.
//
// Founder decision 2026-11-27: the sales roster is not a second master. An
// employee is a telecaller / team lead / field staff by their chart position,
// and the region(s) they may hold come from HR: the region catalog (name,
// TL tier, states) plus an optional per-position allotment. Chart seats with no
// allotment rows may hold any active region, so old positions keep working.
//
// DB failure (migration not applied yet) falls back to the bundled taxonomy —
// reads never break, writes still validate against the fallback.
import { REGIONS as DEFAULT_REGIONS, type RegionDef } from "../../automations/telecalling/regions";

export interface SalesRegionRow {
  id: string; code: string; name: string; tlLevel: "TL1" | "TL2";
  states: string[]; order: number; active: boolean;
}

function parseStates(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s)).filter(Boolean);
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v.map((s) => String(s)).filter(Boolean) : [];
  } catch { return []; }
}

export function regionRowJson(row: any): SalesRegionRow {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name ?? ""),
    tlLevel: String(row.tlLevel ?? "TL1") === "TL2" ? "TL2" : "TL1",
    states: parseStates(row.states),
    order: Number(row.order ?? 0),
    active: row.active !== false,
  };
}

/** DB catalog, or the bundled taxonomy when the table is unavailable. */
export async function loadSalesRegions(prisma: any): Promise<SalesRegionRow[]> {
  try {
    const rows = await prisma.humanResourcesRegion.findMany({ orderBy: { order: "asc" } });
    if (rows?.length) return rows.map(regionRowJson);
  } catch { /* fall through to the seed taxonomy */ }
  return DEFAULT_REGIONS.map((r, i) => ({
    id: `seed_${r.id}`, code: r.id, name: r.name, tlLevel: r.tl,
    states: r.states, order: i + 1, active: true,
  }));
}

/** Display taxonomy (the leaderboard shape) from the same rows. */
export function regionDefs(rows: SalesRegionRow[]): RegionDef[] {
  return rows.map((r) => ({
    id: r.code as RegionDef["id"], name: r.name, tl: r.tlLevel, states: r.states,
  }));
}

/** Allotment codes for one chart position; null = no restriction. */
export async function loadPositionAllotment(prisma: any, positionId: string | null): Promise<string[] | null> {
  if (!positionId) return null;
  try {
    const rows = await prisma.humanResourcesPositionRegion.findMany({ where: { orgPositionId: String(positionId) } });
    return rows?.length ? rows.map((r: any) => String(r.regionCode)) : null;
  } catch { return null; }
}

/** All allotment rows grouped by chart position (the HR Controller matrix). */
export async function loadAllotment(prisma: any): Promise<Record<string, string[]>> {
  try {
    const rows = await prisma.humanResourcesPositionRegion.findMany({});
    const out: Record<string, string[]> = {};
    for (const r of rows ?? []) {
      const key = String(r.orgPositionId);
      (out[key] ??= []).push(String(r.regionCode));
    }
    return out;
  } catch { return {}; }
}

export interface PostingInput {
  rosterType: "telecaller" | "field_staff" | "team_lead";
  region: string; region2: string; tlLevel: string;
  positionId: string | null;
}

/** Validate one employee posting. Returns an operator-facing error or null. */
export async function validateSalesPosting(prisma: any, input: PostingInput): Promise<string | null> {
  const [regions, allowed] = await Promise.all([
    loadSalesRegions(prisma),
    loadPositionAllotment(prisma, input.positionId),
  ]);
  const active = new Map(regions.filter((r) => r.active).map((r) => [r.code, r]));
  const region = String(input.region ?? "").trim();
  const region2 = String(input.rosterType === "team_lead" ? (input.region2 ?? "") : "").trim();
  const level = String(input.tlLevel ?? "").trim();
  const want = input.rosterType === "team_lead" ? 2 : 1;
  const picked = [region, region2].filter(Boolean);
  if (picked.length !== want) {
    return input.rosterType === "team_lead"
      ? "a Team Lead needs exactly two different regions"
      : "region required for sales staff";
  }
  if (new Set(picked).size !== picked.length) return "pick two DIFFERENT regions";
  for (const code of picked) {
    if (!active.has(code)) return `region ${code} is not active in the HR region list`;
    if (allowed && !allowed.includes(code)) return `this position is not allotted to region ${code}`;
  }
  if (input.rosterType === "team_lead") {
    if (level && level !== "TL1" && level !== "TL2") return "tlLevel must be TL1 or TL2";
    if (!level) {
      const tiers = new Set(picked.map((c) => active.get(c)?.tlLevel));
      if (tiers.size !== 1) return "the two regions report to different TL tiers — pick the TL level";
    }
  } else if (level) {
    return "TL level is Team-Lead-only";
  }
  return null;
}

/** TL level a team lead inherits from their (single-tier) region pair. */
export async function impliedTlLevel(prisma: any, region: string, region2: string): Promise<string> {
  const rows = await loadSalesRegions(prisma);
  const tiers = new Set([region, region2]
    .map((code) => rows.find((r) => r.code === code)?.tlLevel)
    .filter(Boolean));
  return tiers.size === 1 ? [...tiers][0]! : "";
}