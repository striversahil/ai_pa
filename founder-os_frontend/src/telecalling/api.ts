// Telecalling roster domain API (fetch lives here — never in components).
// Endpoint mirror: founder-os_backend/src/worker/routes/telecalling.ts
// (POST /api/telecallers/from-directory — validation + field mapping shared
// with POST /api/telecallers via telecallerCreateData, never copied).

async function readError(res: Response): Promise<string> {
  try {
    const j: { error?: unknown } = await res.json();
    return String(j?.error ?? `request failed (${res.status})`);
  } catch {
    return `request failed (${res.status})`;
  }
}

export interface MapRosterInput {
  userId: string;
  region: string;
  type?: "telecaller" | "field-staff" | "team_lead";
  name?: string;
  tlLevel?: string;
  region2?: string;
}

export interface MapRosterConflict {
  linkTo: string;
  name: string;
}

/** Map a directory login onto the sales roster (sales-head/MIS only).
 *  Throws on duplicate email with `linkTo` attached — caller offers Link. */
export async function mapRosterFromDirectory(input: MapRosterInput): Promise<unknown> {
  const res = await fetch("/api/telecallers/from-directory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 409) {
    const j = await res.json();
    const err = new Error(String(j?.error ?? "email already on the roster"));
    (err as Error & { linkTo?: string; linkName?: string }).linkTo = String(j?.linkTo ?? "");
    (err as Error & { linkTo?: string; linkName?: string }).linkName = String(j?.name ?? "");
    throw err;
  }
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** Link an existing roster row to a login email (uses the existing PUT). */
export async function linkRosterEmail(id: string, email: string): Promise<unknown> {
  const res = await fetch(`/api/telecallers/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
