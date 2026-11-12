// Org-position taxonomy for the User & Permission Management portal.
// Framework-free (no imports) so both the Worker and Express can use it.
// Mirror: founder-os_frontend/src/auth/org-positions.ts (labels, order,
// suggested scopes) — change both together, never drift.

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
  | "unmapped";

export interface PositionMeta {
  position: OrgPosition;
  department: OrgDepartment;
  label: string;
}

/** Display order inside the Users portal (Sales first, then Operations). */
export const POSITION_ORDER: OrgPosition[] = [
  "sales-head",
  "team-lead",
  "telecaller",
  "field-staff",
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
  "accountant": { department: "operations", label: "Accountant" },
  "dm-senior": { department: "operations", label: "Digital Marketing · Senior" },
  "dm-junior": { department: "operations", label: "Digital Marketing · Junior" },
  "procurement": { department: "operations", label: "Procurement" },
  "hr": { department: "operations", label: "HR" },
  "unmapped": { department: "unmapped", label: "Unmapped" },
};

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

/** Minimal roster shapes the resolver needs (emails only — no PII beyond). */
export interface RosterSnapshot {
  telecallers: Array<{ email?: string | null; name?: string | null; type?: string | null }>;
  accountants: Array<{ email?: string | null; name?: string | null; role?: string | null }>;
  marketers: Array<{ email?: string | null; name?: string | null; role?: string | null }>;
  hrMembers: Array<{ email?: string | null; loginEmail?: string | null; name?: string | null }>;
}

export interface PositionInput {
  email: string;
  scopes: string[];
  /** Manager-set override (Users portal). When a valid position, it wins and
   *  the auto-resolved value is reported alongside for transparency. */
  override?: string | null;
}

export interface ResolvedPosition {
  position: OrgPosition;
  department: OrgDepartment;
  /** Human-readable provenance, e.g. "Telecaller roster" / "holds sales-head scope". */
  via: string;
  /** The roster/scope-derived value (always computed, even when overridden). */
  auto: OrgPosition;
}

const normEmail = (v: unknown): string => String(v ?? "").trim().toLowerCase();
const hasScope = (scopes: string[], key: string): boolean =>
  scopes.some((s) => String(s ?? "").toLowerCase() === key);

function findByEmail<T>(rows: T[], getEmail: (r: T) => unknown, email: string): T | null {
  if (!email) return null;
  for (const r of rows) {
    if (normEmail(getEmail(r)) === email) return r;
  }
  return null;
}

/**
 * Resolve one login to its org position. A valid manager override wins (the
 * auto value is still reported); otherwise precedence is deliberate and
 * documented: manager scopes first (sales-head), then the Sales roster
 * type, then Operations rosters, then scope-derived buckets (procurement),
 * then HR. Email-exact matching only — no name fallback (the Users portal is
 * the access surface, so a wrong guess is worse than Unmapped; fix the roster
 * email instead).
 */
export function resolveOrgPosition(input: PositionInput, rosters: RosterSnapshot): ResolvedPosition {
  const auto = resolveAutoPosition(input, rosters);
  const ov = String(input.override ?? "").trim().toLowerCase();
  if (ov && (POSITION_ORDER as string[]).includes(ov) && ov !== "unmapped") {
    const position = ov as OrgPosition;
    return {
      position,
      department: POSITION_META[position].department,
      via: `manual override (auto: ${POSITION_META[auto.position].label})`,
      auto: auto.position,
    };
  }
  return { ...auto, auto: auto.position };
}

function resolveAutoPosition(
  input: PositionInput,
  rosters: RosterSnapshot,
): { position: OrgPosition; department: OrgDepartment; via: string } {
  const email = normEmail(input.email);
  const scopes = input.scopes ?? [];

  if (hasScope(scopes, "sales-head")) {
    return { position: "sales-head", department: "sales", via: "holds sales-head scope" };
  }

  const tc = findByEmail(rosters.telecallers ?? [], (r) => r.email, email);
  if (tc) {
    const t = String(tc.type ?? "telecaller");
    if (t === "team_lead") {
      return { position: "team-lead", department: "sales", via: "Telecaller roster · team_lead" };
    }
    if (t === "field_staff") {
      return { position: "field-staff", department: "sales", via: "Telecaller roster · field_staff" };
    }
    return { position: "telecaller", department: "sales", via: "Telecaller roster" };
  }

  const acct = findByEmail(rosters.accountants ?? [], (r) => r.email, email);
  if (acct) {
    return { position: "accountant", department: "operations", via: "Accounts roster" };
  }

  const mk = findByEmail(rosters.marketers ?? [], (r) => r.email, email);
  if (mk) {
    const role = String(mk.role ?? "").toLowerCase();
    // Legacy "manager" rows predate the Senior/Junior split — read as Senior.
    if (role === "junior") {
      return { position: "dm-junior", department: "operations", via: "Digital Marketing roster · Junior" };
    }
    return { position: "dm-senior", department: "operations", via: "Digital Marketing roster · Senior" };
  }

  if (hasScope(scopes, "procurement")) {
    return { position: "procurement", department: "operations", via: "holds procurement scope" };
  }

  for (const h of rosters.hrMembers ?? []) {
    if (normEmail(h.email) === email || (h.loginEmail && normEmail(h.loginEmail) === email)) {
      return { position: "hr", department: "operations", via: "HR member record" };
    }
  }

  return { position: "unmapped", department: "unmapped", via: "no roster match — fix roster email" };
}
