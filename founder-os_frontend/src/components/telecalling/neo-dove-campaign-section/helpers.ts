// Extracted verbatim from NeoDoveCampaignSection.tsx by scripts/refactor/split-module.mjs.
// NeoDoveCampaignSection.tsx re-exports everything public here, so existing imports keep working.


export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error || `Request failed (${res.status})`);
  return body as T;
}
