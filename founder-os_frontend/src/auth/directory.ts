// Unified employee directory — frontend mirror + fetchers.
// Mirror: founder-os_backend/src/modules/auth/directory.ts (DIRECTORY_HIDDEN_KEY,
// row shape, email-exact sources) — change both together, never drift.
// Backend: founder-os_backend/src/modules/auth/routes-parts/directory.ts.

/** Setting key (root-only) holding hidden-login emails. Never displayed to non-root. */
export const DIRECTORY_HIDDEN_KEY = "hr:hiddenLoginEmails";

export interface DirectorySource {
  id: string;
  kind: "telecaller" | "accountant" | "marketer" | "hr-member";
  label: string;
}

export interface DirectoryRow {
  id: string;
  email: string;
  name: string;
  position: string;
  department: string;
  via: string;
  auto: string;
  override: string | null;
  suggestedScopes: string[];
  sources: DirectorySource[];
  hidden?: boolean;
}

export interface DirectoryResponse {
  directory: DirectoryRow[];
  canManage: boolean;
  hiddenCount?: number;
}

// Fetchers live in the domain api module (ratchet fe.raw_fetch_api):
// ./api.ts (fetchDirectory, fetchHiddenLogins, saveHiddenLogins).
export { fetchDirectory, fetchHiddenLogins, saveHiddenLogins } from "./api";
