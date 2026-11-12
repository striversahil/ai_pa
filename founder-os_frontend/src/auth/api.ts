// Auth domain API module (fetch lives here — never in components).
// Directory endpoint mirror: founder-os_backend/src/modules/auth/routes-parts/directory.ts.
import type { DirectoryResponse } from "./directory";

async function readError(res: Response): Promise<string> {
  try {
    const j: { error?: unknown } = await res.json();
    return String(j?.error ?? `request failed (${res.status})`);
  } catch {
    return `request failed (${res.status})`;
  }
}

/** Wide read: root sees all (hidden flagged); managers + HR holders see all-minus-hidden. */
export async function fetchDirectory(): Promise<DirectoryResponse> {
  const res = await fetch("/api/auth/directory", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** Root-only: hidden-login email list. */
export async function fetchHiddenLogins(): Promise<string[]> {
  const res = await fetch("/api/auth/hidden-logins", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  const j = await res.json();
  return (j.hidden ?? []) as string[];
}

/** Root-only: replace the hidden-login email list. */
export async function saveHiddenLogins(hidden: string[]): Promise<string[]> {
  const res = await fetch("/api/auth/hidden-logins", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hidden }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()).hidden ?? []) as string[];
}
