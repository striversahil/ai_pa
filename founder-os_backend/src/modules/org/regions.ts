// modules/org/regions.ts — the sales posting rule (region catalog) behind the
// single person save.
//
// Founder decision 2026-11-27: the sales roster is not a second master. An
// employee is a telecaller / team lead / field staff by their chart position,
// and the regions they may hold are picked on that person from the region
// catalog (name, TL tier, states).
//
// Founder decision 2026-11-28: the per-position allotment table is GONE — the
// chart is the one place a seat's regions are assigned (on the person), so any
// active region may be picked for any seat. Mig 0179 drops the table.
//
// Founder decision 2026-11-28 (this file): the count is FREE. A region may have
// any number of team leads; a team lead / telecaller / field staff may hold any
// number of regions (0..N) — the Sales Head decides, nothing here caps it and
// nothing here demands a TL1/TL2 tier on a person. The tier lives on the region
// catalog only (it drives the reseller target ledger).
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

/** Dedupe + trim a client region list (order kept; first = primary region). */
export function cleanRegions(list: unknown): string[] {
  const raw = Array.isArray(list) ? list : [list];
  const out: string[] = [];
  for (const v of raw) {
    const code = String(v ?? "").trim().toUpperCase();
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

export interface PostingInput {
  /** Any number of region codes, 0..N (order kept; first = primary). */
  regions: string[];
}

/** Validate one employee posting. Returns an operator-facing error or null. */
export async function validateSalesPosting(prisma: any, input: PostingInput): Promise<string | null> {
  const picked = cleanRegions(input.regions);
  if (picked.length === 0) return null; // valid: unmapped staff (the board's Unmapped bucket)
  const regions = await loadSalesRegions(prisma);
  const active = new Set(regions.filter((r) => r.active).map((r) => r.code));
  for (const code of picked) {
    if (!active.has(code)) return `region ${code} is not active in the HR region list`;
  }
  return null;
}
