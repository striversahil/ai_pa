// View → required permission category (scope). Root (or anyone holding the
// `admin` scope) can access everything. New categories are created by root in
// the admin panel and assigned per user.

export const VIEW_SCOPE: Record<string, string> = {
  dashboard: "dashboard",
  enquiries: "enquiries",
  detail: "enquiries",
  briefing: "founder-ai",
  whatsapp: "whatsapp",
  automations: "automations",
  admin: "admin",
  // Automation dashboard slugs:
  "zoho-sent-analyzer": "zoho",
  "neodove-telecaller-report": "neodove",
  "dpp-prices-dashboard": "dpp",
  "enterprise-operations-analytics": "enterprise-ops",
  "wa-engine-monitor": "wa-engine",
  "whatsapp-marketing": "whatsapp-marketing",
  "sheet-analysis": "sheet-analysis",
  "telecalling": "automations",
};

export interface AuthUserMe {
  user: { id: string; email: string; name: string; picture: string | null; isRoot: boolean };
  scopes: string[];
  isRoot: boolean;
  isAdmin: boolean;
}

export function canView(me: AuthUserMe | null, viewOrSlug: string): boolean {
  if (!me) return false;
  if (me.isAdmin) return true;
  const scope = VIEW_SCOPE[viewOrSlug];
  if (!scope) return true; // unrecognized view defaults to open
  return me.scopes.includes(scope);
}
