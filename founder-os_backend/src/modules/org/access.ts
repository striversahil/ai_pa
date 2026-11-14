// modules/org/access.ts — one permission rule for the Organization chart.
//
// Pure module: no fetch, no DB, no Worker imports. The org route (worker)
// enforces these; the frontend only renders the server's `canManage` +
// `grantableScopes` per person and never re-derives them.
//
// Mirror (names + semantics): founder-os_frontend/src/org/access.ts —
// change both together, never drift.
import { POSITION_SUGGESTED_SCOPES } from "../auth/positions";

/** Chart titles that hold a sales-roster row. Sales Head has none — nobody
 *  maps onto it. Non-sales titles never map. */
export const ORG_SALES_TITLES: readonly string[] = ["Team Lead", "Telecaller", "Field Staff"];

/** Roster `type` for a chart title (null = not a roster position). */
export function rosterTypeFor(title: string): "telecaller" | "field_staff" | "team_lead" | null {
  switch (String(title ?? "").trim()) {
    case "Telecaller": return "telecaller";
    case "Field Staff": return "field_staff";
    case "Team Lead": return "team_lead";
    default: return null;
  }
}

/** True only for the Sales titles that accept a roster row. */
export function isSalesRosterTitle(title: string): boolean {
  return rosterTypeFor(title) !== null;
}

/** Sales-head anchor rule (pure): the person save must never auto-retire the
 *  roster row of a login holding sales-head power (scope or role). "Sales
 *  Head" maps to no roster type, so an untargeted retire would orphan every
 *  past and future deal instead of dropping someone who left: the whole
 *  attribution chain (enquiries, estimates, leaderboard, NeoDove) keys off
 *  that row, and creator inference + the agents list both skip deleted rows.
 *  A sales-head who genuinely leaves loses the row when their access is
 *  removed, never as a side effect of a card save. */
export function retireRosterOnSave(opts: { rosterType: "telecaller" | "field_staff" | "team_lead" | null; holdsSalesHeadPower: boolean }): boolean {
  if (!opts.rosterType && opts.holdsSalesHeadPower) return false;
  return opts.rosterType === null;
}

/** Region rules for the editor: which sales fields appear per position. */
export function regionRulesFor(title: string): { region: boolean; region2: boolean; whatsapp: boolean; neodove: boolean } {
  const t = rosterTypeFor(title);
  if (!t) return { region: false, region2: false, whatsapp: false, neodove: false };
  // Founder rule: every sales roster row carries region + office-phone
  // mapping (NeoDove) + WhatsApp. TL1 adds the second region.
  return { region: true, region2: t === "team_lead", whatsapp: true, neodove: true };
}

/** Default dashboard scopes a position grants (pre-checked in the editor,
 *  applied on save). Single source for both sides. */
export function positionScopes(loginPosition: string): string[] {
  return [...(POSITION_SUGGESTED_SCOPES[loginPosition as keyof typeof POSITION_SUGGESTED_SCOPES] ?? [])];
}

/**
 * Chart title → login-position key. Mirror: frontend `LOGIN_POSITIONS_BY_TITLE`
 * (hr/organization.ts) — change both together, never drift. Guard:
 * scripts/guards/org-access.test.mjs asserts the entries match.
 */
export const CHART_TITLE_TO_POSITION: Record<string, string> = {
  "Sales Head": "sales-head",
  "Team Lead": "team-lead",
  "Telecaller": "telecaller",
  "Field Staff": "field-staff",
  "Digital Marketing - Senior": "dm-senior",
  "Digital Marketing - Junior": "dm-junior",
  "Senior Accountant": "accountant",
  "Junior Accountant": "accountant",
  "Procurement": "procurement",
  "HR": "hr",
  "MIS": "",
};

export function chartTitleToPosition(title: string): string {
  return CHART_TITLE_TO_POSITION[String(title ?? "").trim()] ?? "";
}

/** True when the title is a real chart position (org saves require it). */
export function isChartTitle(title: string): boolean {
  return Object.prototype.hasOwnProperty.call(CHART_TITLE_TO_POSITION, String(title ?? "").trim());
}

export interface PersonIdentity {
  /** Chart title, e.g. "Telecaller". */
  title: string;
  /** Department from the chart, e.g. "Sales". */
  department: string | null;
}

export interface ViewerIdentity {
  isRoot?: boolean;
  isAdmin?: boolean;
  scopes?: string[] | null;
  roles?: string[] | null;
}

/** Department a login-position key belongs to (mirrors the chart). */
export function departmentOfLoginPosition(position: string): string {
  switch (String(position ?? "")) {
    case "sales-head":
    case "team-lead":
    case "telecaller":
    case "field-staff":
      return "Sales";
    case "dm-senior":
    case "dm-junior":
      return "Digital Marketing";
    case "accountant":
      return "Accounts";
    case "procurement":
      return "Procurement";
    case "hr":
      return "HR";
    default:
      return "";
  }
}

const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();

/**
 * May this viewer edit this person (position, region, WhatsApp, NeoDove,
 * access, active)? One home for the whole org surface — HR graph and the
 * Sales Team & Access mount share it.
 *
 * - root / admin → everyone
 * - human-resources → everyone (position, region, access; payroll stays
 *   locked behind its own route gates)
 * - sales-head → Sales people only (Team Lead, Telecaller, Field Staff)
 * - accounts / digital-marketing / procurement → their own department
 */
export function canManagePerson(me: ViewerIdentity, person: PersonIdentity): boolean {
  if (!me) return false;
  if (me.isRoot === true || me.isAdmin === true) return true;
  const scopes = new Set(((me.scopes ?? []) as string[]).map(norm));
  if (scopes.has("admin")) return true;
  if (scopes.has("human-resources")) return true;
  const dept = String(person.department ?? "");
  if (scopes.has("sales-head") && dept === "Sales") return true;
  if (scopes.has("accounts") && dept === "Accounts") return true;
  if (scopes.has("digital-marketing") && dept === "Digital Marketing") return true;
  if (scopes.has("procurement") && dept === "Procurement") return true;
  return false;
}

/**
 * Scopes this viewer may grant on this person: the intersection of what they
 * hold and what the position suggests. A manager can never grant (or strip)
 * a dashboard they don't hold — admin / user-admin stay root-only because
 * no manager holds them.
 */
export function grantableScopes(me: ViewerIdentity, suggested: string[]): string[] {
  if (me?.isRoot === true || me?.isAdmin === true) return [...suggested];
  const held = new Set(((me?.scopes ?? []) as string[]).map(norm));
  return suggested.filter((s) => held.has(norm(s)));
}
