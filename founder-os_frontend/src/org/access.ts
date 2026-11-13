// org/access.ts — frontend mirror of the org permission rule.
// Mirror: founder-os_backend/src/modules/org/access.ts (names + semantics) —
// change both together, never drift. Guard: scripts/guards/org-access.test.mjs.
//
// Display-only: the server re-checks everything on save.

/** Chart titles that hold a sales-roster row. */
export const ORG_SALES_TITLES: readonly string[] = ["Team Lead", "Telecaller", "Field Staff"];

export function rosterTypeFor(title: string): "telecaller" | "field_staff" | "team_lead" | null {
  switch (String(title ?? "").trim()) {
    case "Telecaller": return "telecaller";
    case "Field Staff": return "field_staff";
    case "Team Lead": return "team_lead";
    default: return null;
  }
}

export function isSalesRosterTitle(title: string): boolean {
  return rosterTypeFor(title) !== null;
}

/** Which sales fields the editor shows for this position. */
export function regionRulesFor(title: string): { region: boolean; region2: boolean; whatsapp: boolean; neodove: boolean } {
  const t = rosterTypeFor(title);
  if (!t) return { region: false, region2: false, whatsapp: false, neodove: false };
  return { region: true, region2: t === "team_lead", whatsapp: true, neodove: true };
}
