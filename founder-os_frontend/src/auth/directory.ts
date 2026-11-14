// Unified employee directory — frontend mirror + fetchers.
// Mirror: founder-os_backend/src/modules/auth/directory.ts
// (row shape, email-exact sources) — change both together, never drift.
// Backend: founder-os_backend/src/modules/auth/routes-parts/directory.ts.

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
}

export interface DirectoryResponse {
  directory: DirectoryRow[];
  canManage: boolean;
}

// Fetchers live in the domain api module (ratchet fe.raw_fetch_api):
// ./api.ts (fetchDirectory).
export { fetchDirectory } from "./api";
