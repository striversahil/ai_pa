// agent-match.ts — pure login → employee matching for the enquiry "Lead by".
//
// `scopes.ts#resolveCreatorAgentId` runs this over TWO row sets:
//   1. the sales roster (the `Telecaller` READ-ONLY view over
//      `HumanResourcesMember`), and
//   2. the HR register, because the view exposes `email` ONLY while a chart
//      seat can sign in with a different `loginEmail` (the team-lead account
//      is exactly that) and `email` may hold several comma-separated
//      addresses. A roster-only match left every enquiry that login created
//      unassigned (found 2026-11-27).
//
// Pure (no DB, no fetch) so the rule has a DB-free guard:
// scripts/guards/enquiry-agent-resolve.test.mjs.

export interface CreatorRow {
  id?: string;
  name?: string;
  email?: string;
  loginEmail?: string;
}

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();
const local = (e: string): string => e.split('@')[0].trim();

/** Every address a row can be signed in with (comma lists included). */
export function creatorEmails(row: CreatorRow): string[] {
  return [row?.email, row?.loginEmail]
    .flatMap((v) => norm(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Match a login against candidate rows: email first (a shared inbox only
 * resolves when the login NAME picks one row), then name. `null` = no match,
 * or an ambiguous one — never a guess.
 */
export function pickCreatorRow(rows: CreatorRow[], email: string, name: string): string | null {
  const mail = norm(email);
  const who = norm(name);
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id);
  if (!mail && !who) return null;
  if (mail) {
    const hits = list.filter((r) => creatorEmails(r).some((e) => e === mail || local(e) === local(mail)));
    if (hits.length === 1) return String(hits[0].id);
    if (hits.length > 1) {
      if (!who) return null;
      const named = hits.find((r) => norm(r.name) === who);
      return named ? String(named.id) : null;
    }
  }
  if (who) {
    const hit = list.find((r) => norm(r.name) === who);
    if (hit) return String(hit.id);
  }
  return null;
}
