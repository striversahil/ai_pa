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
//
// Mirror: founder-os_backend/src/modules/auth/implied.ts#IMPLIED_SCOPES — the
// backend OWNS the bundle (viewer expansion + workspace filtering); this is a
// display-only copy for instant gating until the server list arrives.
// Guard scripts/guards/org-access.test.mjs asserts the two stay in sync.
export const IMPLIED_SCOPES: Record<string, string[]> = {
  sales: ["enquiry-tracker"],
  // Sales-head bundle: mirrors DEFAULT_ROLES['sales-head'].scopeKeys (and
  // POSITION_SUGGESTED_SCOPES['sales-head']) minus itself. A login holding
  // only `sales-head` still opens the Sales tabs — without this, the
  // Leaderboard / Analyzer / Enquiries pills vanish for a direct-scope grant
  // while role-holders keep them (role scopes merge in getMe).
  "sales-head": ["telecalling", "enquiry-tracker", "zoho", "debtors-tracker"],
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
  user: { id: string; email: string; name: string; picture: string | null; isRoot: boolean; displayName?: string | null };
  scopes: string[];
  roles: string[];
  isRoot: boolean;
  isAdmin: boolean;
  /** Present only while root is impersonating: the REAL root identity. `user`
   *  and `scopes` above are already the TARGET's. Mirror of the backend
   *  MeResponse.actingAs (founder-os_backend/src/modules/auth/types.ts). */
  actingAs?: { id: string; email: string; name: string };
}

export function canView(me: AuthUserMe | null, viewOrSlug: string): boolean {
  if (!me) return false;
  if (viewOrSlug === "session") {
    // Dashboard tile grid (/session): every approved member. The grid lists
    // only the workspaces the server grants (GET /api/session/workspaces).
    return me.scopes.length > 0 || me.roles.length > 0;
  }
  // Position builder (phase 1): root-only creation surface. Staff keep their
  // automation sheets; even admins don't see drafts until the rollout phase.
  if (viewOrSlug === "workspace") return me.isRoot;
  // Founder email service: ROOT ONLY — not even admins. The backend
  // /api/email/* endpoints enforce the same check independently.
  if (viewOrSlug === "email") return me.isRoot;
  // Runtime application settings (AI provider priority + model selection):
  // ROOT ONLY — same contract as email. The backend /api/settings endpoints
  // enforce the same check independently.
  if (viewOrSlug === "settings") return me.isRoot;
  // Ingestion hub: ROOT ONLY. It can create/rotate public webhook credentials
  // and read every portal's data, so it is never a delegable scope. The
  // backend /api/integrations/* endpoints enforce isRoot independently.
  if (viewOrSlug === "integrations") return me.isRoot;
  // Notification engine dashboard (rules, deliveries, palette, AI authoring):
  // root/admin only — the backend endpoints enforce the same gate. Everyone else
  // gets their own notifications through the bell, not this console.
  if (viewOrSlug === "notifications") return me.isRoot || me.isAdmin;
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
  if (viewOrSlug === "leave") {
    // Personal leave applications (full day / half day / short): every approved
    // member, same rule as Delegation. The backend pins the caller's own roster
    // member; HR decisions stay behind the `human-resources` scope.
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