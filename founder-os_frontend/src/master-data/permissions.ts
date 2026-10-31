// permissions.ts — client-side mirror of the master-data access rules.
//
// MIRROR: founder-os_backend/src/modules/master-data/editors.ts
// The server is the enforcement point; this only hides controls the server
// would reject (never grants anything).
import { grantedScopes, type AuthUserMe } from "@/auth/permissions";

export interface MasterCapabilitiesClient {
  canView: boolean;
  canEdit: boolean;
  canAppoint: boolean;
  canImport: boolean;
}

export function masterCapabilities(me: AuthUserMe | null): MasterCapabilitiesClient {
  const scopes = grantedScopes(me);
  const isManager = masterIsManager(me);
  return {
    canView: isManager || scopes.has("master-data") || scopes.has("enquiry-tracker"),
    canEdit: isManager || scopes.has("master-data-edit"),
    canAppoint: isManager,
    canImport: isManager,
  };
}

/** Sales-head / MIS / root — also the only people who may reassign region,
 *  sub-area and state on a record. */
export function masterIsManager(me: AuthUserMe | null): boolean {
  if (!me) return false;
  if (me.isAdmin) return true;
  const scopes = grantedScopes(me);
  return scopes.has("mis") || scopes.has("sales-head");
}
