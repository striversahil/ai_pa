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
  "wa-engine-monitor": "wa-engine",
  "whatsapp-marketing": "whatsapp-marketing",
  "sheet-analysis": "sheet-analysis",
  "telecalling": "telecalling",
  // Unified Sales workspace (leaderboard + enquiries + customer master +
  // dispatch). The automation carries the `telecalling` scope — the separate
  // `sales` scope key is the agent-identity grant, not a dashboard grant.
  "sales": "telecalling",
  "debtors-tracker": "debtors-tracker",
  "payment-tracker": "debtors-tracker", // legacy slug alias
  "whatsapp-autopilot": "autopilot",
  "enquiry-tracker": "enquiry-tracker",
  "enquiry-procurement": "procurement",
  // Management Review: its own grantable scope (same pattern as every other
  // dashboard — slug-as-scope, no special cases, no person named in code).
  "enquiry-management": "enquiry-management",
  "telecalling-agent-analysis": "sheet-analysis",
  "crm": "crm",
  "samarth-overview": "samarth",
  "sahil-overview": "sahil",
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
  // The dispatch floor IS the CRM dashboard: a `dispatch` holder schedules and
  // dispatches sales orders, so they must be able to open it. `crm` (read)
  // does not imply `dispatch` — the reverse is what's needed.
  dispatch: ["crm"],
  // Accounts holders keep read access to the Debtors Tracker after it moved to
  // its own scope (accounts remains the write/import authority).
  accounts: ["debtors-tracker"],
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
  "wa-engine",
  "whatsapp-marketing",
  "sheet-analysis",
  "autopilot",
  "telecalling",
  "accounts",
  "debtors-tracker",
  "human-resources",
  "enquiry-tracker",
  "enquiry-management",
  "crm",
  "dispatch",
  "sales",
  "procurement",
  "samarth",
  "sahil",
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
  // DEV-ONLY (2026-11-14): Workspace grid is root-only while under
  // development. Placed before the isAdmin shortcut so even admins hide it.
  // Sidebar dashboard rows + /session/<slug> stay scope-gated as before.
  if (viewOrSlug === "session") return me.isRoot;
  // Founder email service: ROOT ONLY — not even admins. The backend
  // /api/email/* endpoints enforce the same check independently.
  if (viewOrSlug === "email") return me.isRoot;
  // Runtime application settings (AI provider priority + model selection):
  // ROOT ONLY — same contract as email. The backend /api/settings endpoints
  // enforce the same check independently.
  if (viewOrSlug === "settings") return me.isRoot;
  if (me.isAdmin) return true;
  // The Automations REGISTRY page is root/admin-only. Non-root users reach
  // their dashboards individually (useDashboardNav) — never the full registry.
  if (viewOrSlug === "automations") return false;
  if (viewOrSlug === "chat") {
    // Team chat: available to every approved member (any granted scope/role).
    return me.scopes.length > 0 || me.roles.length > 0;
  }
  if (viewOrSlug === "delegation") {
    // The employee delegation board is for EVERY approved member — it is the
    // one place a person sees their own tasks. The backend scopes the payload
    // to the caller's own roster record, so no scope grant is required.
    return me.scopes.length > 0 || me.roles.length > 0;
  }
  if (viewOrSlug === "admin") {
    // Admin panel: full admins plus user-managers (e.g. MIS holders of the
    // user-admin scope) plus HR holders of the human-resources scope (they get
    // the read-only employee directory; manage powers stay gated separately).
    return me.scopes.includes(USER_ADMIN_SCOPE) || me.scopes.includes("human-resources");
  }
  // Main-platform views are fail-closed (unknown view = denied). Dashboard
  // slugs fall back to slug-as-scope so new automations work with zero edits.
  const scope = VIEW_SCOPE[viewOrSlug] ?? viewOrSlug;
  if (!scope) return false; // unrecognized view defaults to denied (fail-closed)
  return grantedScopes(me).has(scope);
}
