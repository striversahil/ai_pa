// modules/auth/implied.ts — canonical implied-scope bundle (single source).
//
// Backend owns it; frontend `auth/permissions.ts#IMPLIED_SCOPES` is a
// display-only mirror for instant gating (guard org-access asserts parity).
// Framework-free: Worker + Express safe.
export const IMPLIED_SCOPES: Record<string, string[]> = {
  sales: ["enquiry-tracker"],
  // Sales-head bundle mirrors DEFAULT_ROLES['sales-head'].scopeKeys (minus itself).
  "sales-head": ["telecalling", "enquiry-tracker", "zoho", "debtors-tracker"],
  dispatch: ["crm"],
  accounts: ["debtors-tracker"],
};

/** All scopes a login effectively holds: granted + implied (transitive). */
export function expandScopes(granted: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const s of granted) out.add(String(s ?? "").toLowerCase());
  for (const s of [...out]) {
    for (const implied of IMPLIED_SCOPES[s] ?? []) out.add(String(implied).toLowerCase());
  }
  return out;
}
