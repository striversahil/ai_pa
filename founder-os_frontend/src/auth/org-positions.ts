// Org-position taxonomy mirror for the Users portal.
// Mirror: founder-os_backend/src/modules/auth/positions.ts (POSITION_ORDER,
// POSITION_META, POSITION_SUGGESTED_SCOPES) — change both together, never drift.

export type OrgDepartment = "sales" | "operations" | "unmapped";

export type OrgPosition =
  | "sales-head"
  | "team-lead"
  | "telecaller"
  | "field-staff"
  | "accountant"
  | "procurement"
  | "dm-senior"
  | "dm-junior"
  | "hr"
  | "mis"
  | "unmapped";

export interface PositionInfo {
  position: OrgPosition;
  department: OrgDepartment;
  via: string;
  suggestedScopes: string[];
  /** Roster/scope-derived value (differs when a manual override is set). */
  auto: OrgPosition;
  /** Manager-set override or null. */
  override: string | null;
}

export const POSITION_ORDER: OrgPosition[] = [
  "sales-head",
  "team-lead",
  "telecaller",
  "field-staff",
  "mis",
  "accountant",
  "dm-senior",
  "dm-junior",
  "procurement",
  "hr",
  "unmapped",
];

export const POSITION_META: Record<OrgPosition, { department: OrgDepartment; label: string }> = {
  "sales-head": { department: "sales", label: "Sales Head" },
  "team-lead": { department: "sales", label: "Team Lead" },
  "telecaller": { department: "sales", label: "Telecaller" },
  "field-staff": { department: "sales", label: "Field Staff" },
  "mis": { department: "operations", label: "MIS" },
  "accountant": { department: "operations", label: "Accountant" },
  "dm-senior": { department: "operations", label: "Digital Marketing · Senior" },
  "dm-junior": { department: "operations", label: "Digital Marketing · Junior" },
  "procurement": { department: "operations", label: "Procurement" },
  "hr": { department: "operations", label: "HR" },
  "unmapped": { department: "unmapped", label: "Unmapped" },
};

export const DEPARTMENT_LABEL: Record<OrgDepartment, string> = {
  sales: "Sales",
  operations: "Operations",
  unmapped: "Unmapped",
};

export function positionOf(map: Record<string, PositionInfo> | null, userId: string): PositionInfo {
  return (
    map?.[userId] ?? { position: "unmapped", department: "unmapped", via: "", suggestedScopes: [], auto: "unmapped", override: null }
  );
}

/** Display name: manager-set override wins, else the Google-provided name. */
export function displayNameOf(user: { name: string; displayName?: string | null }): string {
  return (user.displayName ?? "").trim() || user.name;
}
