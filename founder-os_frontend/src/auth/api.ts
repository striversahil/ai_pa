// Auth domain API module (fetch lives here — never in components).
// Directory endpoint mirror: founder-os_backend/src/modules/auth/routes-parts/directory.ts.
import type { DirectoryResponse } from "./directory";
import type { CoreAssignmentsResponse } from "./core";

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

/** Core assignments read: per-login primary designation + department catalog. */
export async function fetchCoreAssignments(): Promise<CoreAssignmentsResponse> {
  const res = await fetch("/api/auth/core-assignments", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
