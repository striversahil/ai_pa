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

/**
 * Mirror of backend isHomeDepartment: a person row in "Operations & Support"
 * is home for procurement holders (chart groups Procurement + HR there).
 * Display-only — the server enforces the real rule.
 */
export function isHomeDepartment(viewerScope: string, personDept: string | null): boolean {
  const dept = String(personDept ?? "");
  const scope = String(viewerScope ?? "").trim().toLowerCase();
  if (scope === "sales-head" && dept === "Sales") return true;
  if (scope === "accounts" && dept === "Accounts") return true;
  if (scope === "digital-marketing" && dept === "Digital Marketing") return true;
  if (scope === "procurement" && (dept === "Procurement" || dept === "Operations & Support")) return true;
  return false;
}
