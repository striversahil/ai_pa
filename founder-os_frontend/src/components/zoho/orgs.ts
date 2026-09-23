// orgs.ts — Zoho Books multi-org labels (mirror: backend organizations list).
// The payload carries raw org ids; friendly names live here. Add the DPG
// organization_id next to BUI once it is known — unknown orgs fall back to
// an `Org •••<last4>` label so a new org never renders blank.
export const KNOWN_ORG_LABELS: Record<string, string> = {
  "676267428": "BUI",
  "744573214": "DPG",
};

export function orgLabel(orgId: string | null | undefined, organizations: string[] = []): string {
  const id = String(orgId ?? "");
  if (!id) return "";
  if (KNOWN_ORG_LABELS[id]) return KNOWN_ORG_LABELS[id];
  if (organizations.length > 1 && organizations[0] === id) return "Primary";
  return `Org •••${id.slice(-4)}`;
}

export function isMultiOrg(organizations: string[] = []): boolean {
  return organizations.length > 1;
}
