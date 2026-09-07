// View → required permission category (scope). Root (or anyone holding the
// `admin` scope) can access everything. New categories are created by root in
// the admin panel and assigned per user.
//
// Main-platform views are declared here; automation dashboard scopes come from
// the AUTO-GENERATED automation manifest (see automation-manifest.generated.ts),
// so adding a new automation directory + rule.json `scope` needs no hand-sync.

import {
  DASHBOARD_SCOPE_MAP,
  AUTOMATION_DASHBOARDS,
} from "@/automation-manifest.generated";

export const VIEW_SCOPE: Record<string, string> = {
  briefing: "founder-ai",
  whatsapp: "whatsapp",
  automations: "automations",
  admin: "admin",
  ...DASHBOARD_SCOPE_MAP,
};

// Scopes a ROLE may grant — limited to automation dashboard views. Derived from
// the same generated manifest, so a new dashboard is automatically grantable.
export const DASHBOARD_SCOPES = [...new Set(AUTOMATION_DASHBOARDS.map((slug) => DASHBOARD_SCOPE_MAP[slug]))];

export interface AuthUserMe {
  user: { id: string; email: string; name: string; picture: string | null; isRoot: boolean };
  scopes: string[];
  roles: string[];
  isRoot: boolean;
  isAdmin: boolean;
}

export function canView(me: AuthUserMe | null, viewOrSlug: string): boolean {
  if (!me) return false;
  if (me.isAdmin) return true;
  if (viewOrSlug === "chat") {
    // Team chat: available to every approved member (any granted scope/role).
    return me.scopes.length > 0 || me.roles.length > 0;
  }
  const scope = VIEW_SCOPE[viewOrSlug];
  if (!scope) return false; // unrecognized view defaults to denied (fail-closed)
  return me.scopes.includes(scope);
}
