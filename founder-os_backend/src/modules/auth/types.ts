// Auth domain types.

export const ROOT_EMAIL = "striversahil@gmail.com";

/**
 * Canonical scope keys (single home for the string literals scattered across
 * worker/routes/*). Values must stay in sync with DEFAULT_SCOPES in
 * modules/auth/service.ts — that table owns labels/descriptions, this object
 * owns the spellings route guards compare against.
 */
export const ScopeKeys = {
  Admin: "admin",
  Accounts: "accounts",
  DebtorsTracker: "debtors-tracker",
  PaymentTracker: "payment-tracker",
  Crm: "crm",
  Dispatch: "dispatch",
  Telecalling: "telecalling",
  SalesHead: "sales-head",
  MasterData: "master-data",
  MasterDataEdit: "master-data-edit",
  HumanResources: "human-resources",
  DigitalMarketing: "digital-marketing",
  ProductLine: "product-line",
  Sales: "sales",
  UserAdmin: "user-admin",
} as const;

export type ScopeKey = (typeof ScopeKeys)[keyof typeof ScopeKeys];

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  isRoot: boolean;
  createdAt: string;
  /** Manager-set display name (Users portal). Shown instead of the Google
   *  name; Google sign-in never overwrites it. Null = use `name`. */
  displayName?: string | null;
  /** Manager-set position override (Users portal). Null/empty = auto-resolve
   *  from rosters + scopes. Display/grouping only — never grants access. */
  positionOverride?: string | null;
}

export interface AuthScope {
  key: string; // e.g. "admin", "automation", "zoho"
  label: string;
  description: string | null;
}

export interface AuthRole {
  key: string; // e.g. "telecalling", "operations"
  label: string;
  description: string | null;
  /** Automation-dashboard scope keys granted by this role. Roles may ONLY
   *  contain dashboard scopes — never main-platform views. */
  scopeKeys: string[];
}

export interface Session {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface MeResponse {
  user: AuthUser;
  scopes: string[]; // resolved scope keys (direct scopes + role scopes)
  roles: string[]; // role keys the user holds
  isRoot: boolean;
  /** Convenience: true if user holds `admin` scope or is root. */
  isAdmin: boolean;
}

export class AuthError extends Error {
  constructor(
    public code: "BAD_CODE" | "NO_PROFILE" | "OAUTH_FAILED" | "FORBIDDEN" | "UNAUTHENTICATED",
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}
