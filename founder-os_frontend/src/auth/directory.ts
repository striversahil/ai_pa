// Unified employee directory — frontend mirror + fetchers.
// Mirror: founder-os_backend/src/modules/auth/directory.ts
// (row shape, email-exact sources) — change both together, never drift.
// Backend: founder-os_backend/src/modules/auth/routes-parts/directory.ts.
// Position is HR-owned (PUT /api/org/people/:id) — this directory carries
// identity + roster links only, no position.

export interface DirectorySource {
  id: string;
  kind: "telecaller" | "accountant" | "marketer" | "hr-member";
  label: string;
}

export interface DirectoryRow {
  id: string;
  email: string;
  name: string;
  sources: DirectorySource[];
}

export interface DirectoryResponse {
  directory: DirectoryRow[];
  canManage: boolean;
}

/** Display name: manager-set override wins, else the Google-provided name. */
export function displayNameOf(user: { name: string; displayName?: string | null }): string {
  return (user.displayName ?? "").trim() || user.name;
}

// Fetchers live in the domain api module (ratchet fe.raw_fetch_api):
// ./api.ts (fetchDirectory).
export { fetchDirectory } from "./api";
