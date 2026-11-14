// Position taxonomy + suggested scopes (single home).
// Framework-free (no imports) so both the Worker and Express can use it.
// Consumers: modules/org/access.ts (positionScopes, chart-title mapping).
// The Users-portal resolver + /api/auth/positions endpoint were removed
// 2026-11-14 (position is HR-owned via PUT /api/org/people/:id).

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
  | "unmapped";

/**
 * Suggested dashboard scopes per position. Display + guidance ONLY — access
 * still flows exclusively through Roles (the manager confirms the grant).
 * Mirrors DEFAULT_ROLES scopeKeys where a default role exists.
 */
export const POSITION_SUGGESTED_SCOPES: Record<OrgPosition, string[]> = {
  "sales-head": ["sales-head", "telecalling", "enquiry-tracker", "zoho", "debtors-tracker"],
  "team-lead": ["telecalling", "enquiry-tracker"],
  "telecaller": ["telecalling"],
  "field-staff": [],
  "accountant": ["accounts", "debtors-tracker"],
  "dm-senior": ["digital-marketing"],
  "dm-junior": ["digital-marketing"],
  "procurement": ["procurement"],
  "hr": ["human-resources"],
  "unmapped": [],
};
