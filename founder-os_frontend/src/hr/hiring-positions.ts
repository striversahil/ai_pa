// Frontend mirror of founder-os_backend/src/automations/human-resources/
// hiring-positions-parse.ts — keep slot rules, name identity and filter
// semantics identical on both sides.
import type { HiringDocKind, HrHiringPosition, HrPositionDoc } from "./types";

export type HiringFilter = "all" | "missing-jd" | "missing-sop" | "complete";

export const HIRING_FILTERS: { key: HiringFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "missing-jd", label: "Missing JD" },
  { key: "missing-sop", label: "Missing SOP" },
  { key: "complete", label: "Complete" },
];

export function docsFor(position: HrHiringPosition, kind: HiringDocKind): HrPositionDoc[] {
  const list = position.docs?.[kind];
  return Array.isArray(list) ? list : [];
}

/** Kinds with no uploaded document at all (a role may hold several later). */
export function missingDocs(position: HrHiringPosition): HiringDocKind[] {
  const out: HiringDocKind[] = [];
  if (docsFor(position, "jd").length === 0) out.push("jd");
  if (docsFor(position, "sop").length === 0) out.push("sop");
  return out;
}

function matchesQuery(position: HrHiringPosition, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (position.name.toLowerCase().includes(q)) return true;
  return [...docsFor(position, "jd"), ...docsFor(position, "sop")].some((doc) =>
    [doc.title, doc.fileName].some((value) => String(value ?? "").toLowerCase().includes(q)),
  );
}

export function filterHiringPositions(
  positions: HrHiringPosition[],
  query: string,
  filter: HiringFilter,
): HrHiringPosition[] {
  return (positions ?? []).filter((position) => {
    if (filter === "missing-jd" && docsFor(position, "jd").length > 0) return false;
    if (filter === "missing-sop" && docsFor(position, "sop").length > 0) return false;
    if (filter === "complete" && missingDocs(position).length > 0) return false;
    return matchesQuery(position, query);
  });
}

/** Same identity rule as the backend (punctuation/case/space-insensitive). */
export function positionNameKey(value: string): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Position picker suggestions: employee designations + existing positions. */
export function hiringPositionSuggestions(
  designations: (string | null | undefined)[],
  positions: HrHiringPosition[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...(designations ?? []), ...(positions ?? []).map((p) => p.name)]) {
    const name = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const key = positionNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function hiringStats(positions: HrHiringPosition[]) {
  let complete = 0;
  let missingJd = 0;
  let missingSop = 0;
  for (const position of positions ?? []) {
    const missing = missingDocs(position);
    if (missing.length === 0) complete += 1;
    if (missing.includes("jd")) missingJd += 1;
    if (missing.includes("sop")) missingSop += 1;
  }
  return { total: (positions ?? []).length, complete, missingJd, missingSop };
}
