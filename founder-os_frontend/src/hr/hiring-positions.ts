// Frontend mirror of founder-os_backend/src/automations/human-resources/
// hiring-positions-parse.ts — keep slot rules, video URL validation, name
// identity and filter semantics identical on both sides.
import type { HiringDocKind, HrHiringPosition, HrPositionDoc } from "./types";

export type HiringFilter =
  | "all"
  | "missing-jd"
  | "missing-sop"
  | "missing-questionnaire"
  | "missing-video"
  | "complete";

export const HIRING_FILTERS: { key: HiringFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "missing-jd", label: "Missing JD" },
  { key: "missing-sop", label: "Missing SOP" },
  { key: "missing-questionnaire", label: "Missing questionnaire" },
  { key: "missing-video", label: "Missing walkthrough" },
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
  if (docsFor(position, "questionnaire").length === 0) out.push("questionnaire");
  return out;
}

/** A position is complete only with all three PDFs and a walkthrough link. */
export function isComplete(position: HrHiringPosition): boolean {
  return missingDocs(position).length === 0 && !!position.videoUrl;
}

function matchesQuery(position: HrHiringPosition, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (position.name.toLowerCase().includes(q)) return true;
  if (String(position.videoUrl ?? "").toLowerCase().includes(q)) return true;
  return [...docsFor(position, "jd"), ...docsFor(position, "sop"), ...docsFor(position, "questionnaire")].some((doc) =>
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
    if (filter === "missing-questionnaire" && docsFor(position, "questionnaire").length > 0) return false;
    if (filter === "missing-video" && position.videoUrl) return false;
    if (filter === "complete" && !isComplete(position)) return false;
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
  let missingDocPositions = 0;
  let missingVideo = 0;
  for (const position of positions ?? []) {
    if (isComplete(position)) complete += 1;
    if (missingDocs(position).length > 0) missingDocPositions += 1;
    if (!position.videoUrl) missingVideo += 1;
  }
  return {
    total: (positions ?? []).length,
    complete,
    missingDocs: missingDocPositions,
    missingVideo,
  };
}

/** mirror: backend hiring-positions-parse.ts#cleanVideoUrl */
export const MAX_VIDEO_URL_LENGTH = 2000;

export function cleanVideoUrl(value: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.length > MAX_VIDEO_URL_LENGTH) {
    throw new Error("Video link is too long (max " + MAX_VIDEO_URL_LENGTH + " characters)");
  }
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Enter a valid video walkthrough link");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Video link must start with http:// or https://");
  }
  return parsed.toString();
}
