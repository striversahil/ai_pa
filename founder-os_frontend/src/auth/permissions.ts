// View → required permission category (scope). Root (or anyone holding the
// `admin` scope) can access everything. New categories are created by root in
// the admin panel and assigned per user.
//
// Explicit overrides live here; anything NOT listed falls back to using the
// view/slug itself as the scope (the backend's AUTOMATION_SCOPES contract also
// defaults a dashboard's scope to its slug). So a newly added dashboard
// automation is grantable with zero frontend edits — root just assigns the
// auto-seeded scope in the admin panel.

export const VIEW_SCOPE: Record<string, string> = {
  briefing: "founder-ai",
  whatsapp: "whatsapp",
  automations: "automations",
  admin: "admin",
  // Automation dashboard slugs whose scope differs from the slug:
  "zoho-sent-analyzer": "zoho",
  "neodove-telecaller-report": "neodove",
  "dpp-prices-dashboard": "dpp",
  "enterprise-operations-analytics": "enterprise-ops",
  "wa-engine-monitor": "wa-engine",
  "whatsapp-marketing": "whatsapp-marketing",
  "sheet-analysis": "sheet-analysis",
  "telecalling": "telecalling",
  "whatsapp-autopilot": "autopilot",
  "enquiry-tracker": "enquiry-tracker",
  "enquiry-procurement": "procurement",
  "enquiry-management": "mis",
  "telecalling-agent-analysis": "sheet-analysis",
  "crm": "crm",
};

// Scope that grants the Admin panel without root access (e.g. MIS). Holders
// can assign roles, but never touch the root user nor grant `admin`.
export const USER_ADMIN_SCOPE = "user-admin";

// A held scope can imply dashboard scopes. The Sales Enquiries dashboard is
// gated on `enquiry-tracker`, but a `sales`-scope holder is entitled to it
// (the dashboard's own guard already admits sales) — without this, granting
// someone "sales access" shows them an empty sidebar with no way in.
export const IMPLIED_SCOPES: Record<string, string[]> = {
  sales: ["enquiry-tracker"],
};

/** All scopes a user effectively holds: granted + implied. */
export function grantedScopes(me: AuthUserMe | null): Set<string> {
  const out = new Set(me?.scopes ?? []);
  for (const s of [...out]) for (const implied of IMPLIED_SCOPES[s] ?? []) out.add(implied);
  return out;
}

// Scopes a ROLE may grant. New dashboard scopes are auto-seeded by the backend
// (ensureScopesSeeded covers AUTOMATION_SCOPES) and appear in the admin panel
// without editing this list — it is kept for reference only.
export const DASHBOARD_SCOPES = [
  "zoho",
  "neodove",
  "dpp",
  "enterprise-ops",
  "wa-engine",
  "whatsapp-marketing",
  "sheet-analysis",
  "autopilot",
  "telecalling",
  "enquiry-tracker",
  "crm",
  "sales",
  "procurement",
];

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
  // The Automations REGISTRY page is root/admin-only. Non-root users reach
  // their dashboards individually (useDashboardNav) — never the full registry.
  if (viewOrSlug === "automations") return false;
  if (viewOrSlug === "chat") {
    // Team chat: available to every approved member (any granted scope/role).
    return me.scopes.length > 0 || me.roles.length > 0;
  }
  if (viewOrSlug === "admin") {
    // Admin panel: full admins plus user-managers (e.g. MIS holders of the
    // user-admin scope). Root-only powers inside are gated separately.
    return me.scopes.includes(USER_ADMIN_SCOPE);
  }
  // Main-platform views are fail-closed (unknown view = denied). Dashboard
  // slugs fall back to slug-as-scope so new automations work with zero edits.
  const scope = VIEW_SCOPE[viewOrSlug] ?? viewOrSlug;
  if (!scope) return false; // unrecognized view defaults to denied (fail-closed)
  return grantedScopes(me).has(scope);
}
