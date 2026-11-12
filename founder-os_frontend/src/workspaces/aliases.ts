// workspaces/aliases.ts — legacy workspace slugs → canonical slug.
//
// MIRROR of founder-os_backend/src/modules/workspaces/catalog.ts#aliasTable().
// Change both together; scripts/guards/workspace-catalog.test.mjs fails on drift.
//   kind "data": the server resolves it too (old bookmarks, old clients).
//   kind "nav":  only the URL redirects; the slug's data endpoint is its own
//                headless provider (e.g. `telecalling` feeds the Sales board).

export const ALIASES: Record<string, { to: string; kind: "data" | "nav" }> = {
  "payment-tracker": { to: "debtors-tracker", kind: "data" },
  telecalling: { to: "sales", kind: "nav" },
  "enquiry-tracker": { to: "sales", kind: "nav" },
  "master-data": { to: "sales", kind: "nav" },
};

/** The workspace a URL slug should show (legacy slugs land on their successor). */
export function canonicalNavSlug(slug: string): string {
  return ALIASES[slug]?.to ?? slug;
}
