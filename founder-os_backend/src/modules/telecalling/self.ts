// ── Telecaller identity: which roster row is the signed-in user? ────────────
//
// Shared by the telecalling dashboard and the unified Sales → Dispatch view.
// Pure: callers load the roster + session, this module only matches.
//
// Matching order (unchanged from the original route helper):
//   1. Exact email match (roster.email === signed-in email).
//   2. Exact normalized name ("muskan" → "Muskan").
//   3. Unique prefix — the signed-in name prefixes a roster name.
//   4. Unique short form — a roster name prefixes the signed-in name.
// Ambiguity at any step resolves to null (never guess a stranger's data).
export interface RosterLike {
  id?: unknown;
  name?: unknown;
  email?: unknown;
  [key: string]: unknown;
}

export function normalizeRosterName(v: unknown): string {
  return String(v ?? '').toLowerCase().replace(/\s+/g, '');
}

/** The roster row for this signed-in user, or null. */
export function resolveRosterMatch<T extends RosterLike>(roster: T[], me: any): T | null {
  if (!Array.isArray(roster) || roster.length === 0) return null;
  const meEmail = me?.user?.email ? String(me.user.email).toLowerCase().trim() : '';
  const meName = me?.user?.name ? normalizeRosterName(me.user.name) : '';

  // 1. Exact email match.
  if (meEmail) {
    const byEmail = roster.find((t) => t.email && String(t.email).toLowerCase().trim() === meEmail);
    if (byEmail) return byEmail;
  }

  // 2. Name matching (exact → unique prefix → unique short form).
  if (meName) {
    const candidates = roster.map((t) => ({ row: t, name: normalizeRosterName(t.name) }));
    const exact = candidates.find((c) => c.name === meName);
    if (exact) return exact.row;
    const prefix = candidates.filter((c) => c.name.startsWith(meName) && meName.length >= 3);
    if (prefix.length === 1) return prefix[0].row;
    const short = candidates.filter((c) => meName.startsWith(c.name) && c.name.length >= 3);
    if (short.length === 1) return short[0].row;
  }

  return null;
}
