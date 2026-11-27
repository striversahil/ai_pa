// format.ts — small display helpers shared by the integrations panel.
import type { AuthKind, CatalogEntry } from "./types";

export const KIND_LABEL: Record<string, string> = {
  lead: "Lead",
  enquiry: "Enquiry",
  visit: "Visit",
  expense: "Expense",
  order: "Order",
  message: "Message",
  raw: "Raw",
};

export const AUTH_LABEL: Record<AuthKind, string> = {
  webhook: "Webhook",
  hmac: "Signed webhook",
  oauth2: "OAuth",
  "api-key": "API key",
  none: "None",
};

// Shared formatters (house rule: never re-implement inr/relative time — the
// dup-audit ratchet counts local copies).
export { inr, relAgo as relTime, fmtIstDateTime as fmtWhen } from "@/lib/format";

/** Copy helper that survives an insecure origin (no clipboard API). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

/** Built-ins first, then the founder's custom services, both alphabetical. */
export function groupCatalog(catalog: CatalogEntry[]): Array<{ category: string; entries: CatalogEntry[] }> {
  const groups = new Map<string, CatalogEntry[]>();
  for (const entry of catalog) {
    const key = entry.category || "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }
  return [...groups.entries()]
    .map(([category, entries]) => ({ category, entries: entries.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => (a.category === "Custom" ? 1 : b.category === "Custom" ? -1 : a.category.localeCompare(b.category)));
}