// api/auth-roles.ts — role admin writes (domain api module; components never
// fetch these paths directly — ratchet fe.raw_fetch_api).
// Backend mirror: founder-os_backend/src/worker/routes/auth.ts.
import { api } from "./client";

export interface RoleSaveInput {
  key: string;
  label: string;
  description: string | null;
  scopeKeys: string[];
  position: string | null;
}

/** Root-only: create a role (key + label + scopes + ONE chart position). */
export function createRole(input: RoleSaveInput): Promise<unknown> {
  return api.post("/api/auth/roles", input);
}

/** Root-only: update a role's label/description/scopes/position. */
export function updateRole(key: string, patch: Omit<RoleSaveInput, "key">): Promise<unknown> {
  return api.put(`/api/auth/roles/${encodeURIComponent(key)}`, patch);
}
