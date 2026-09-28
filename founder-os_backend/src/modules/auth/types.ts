// Auth domain types.

export const ROOT_EMAIL = "striversahil@gmail.com";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  isRoot: boolean;
  createdAt: string;
}

export interface AuthScope {
  key: string; // e.g. "admin", "automation", "zoho"
  label: string;
  description: string | null;
}

export interface AuthRole {
  key: string; // e.g. "mis", "operations"
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
