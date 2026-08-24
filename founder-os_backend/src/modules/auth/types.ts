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

export interface Session {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface MeResponse {
  user: AuthUser;
  scopes: string[]; // scope keys held by the user
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
