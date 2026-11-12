// Extracted as its own routes-part (same pattern as io.ts): Worker route
// handlers stay thin orchestrators; all logic lives here. Re-exported via
// ../routes.ts so existing imports keep working.
import { requireUser, listUsers } from "../service";
import { asRoot } from "./io";
import { AuthStore } from "../store";
import { AuthError } from "../types";
import { resolveOrgPosition, POSITION_SUGGESTED_SCOPES } from "../positions";
import type { RosterSnapshot } from "../positions";
import {
  DIRECTORY_HIDDEN_KEY, DIRECTORY_WIDE_SCOPES,
  normalizeHiddenEmails, directorySources, hasAnyScope,
} from "../directory";
import type { DirectoryRosters } from "../directory";
import type { AuthResult } from "./types";
import { json, isTargetRoot } from "./pure";

/**
 * Unified employee directory (view-first): one entry per non-root login with
 * org position (roster-first, same resolver as the Users portal) + roster
 * source links (ids only). Root + `hr:hiddenLoginEmails` rows are visible to
 * root only (flagged); everyone else gets the list minus hidden. HR holders
 * (`human-resources` scope) get read-only width (`canManage: false`) — they
 * cannot edit users/roles through any other endpoint (unchanged gates).
 */
export async function authDirectory(
  store: AuthStore,
  cookieHeader: string | null,
  loadRosters: () => Promise<RosterSnapshot & DirectoryRosters>,
  loadHidden: () => Promise<unknown>,
): Promise<AuthResult> {
  try {
    const me = await requireUser(store, cookieHeader);
    const root = (me as any).isRoot === true;
    // Effective scopes = direct ∪ role scopes (same union authUserPositions uses).
    const scopes: string[] = [...((me as any).scopes ?? [])];
    try {
      const snap = await store.getAuthSnapshot((me as any).user.id);
      for (const rs of Object.values(snap.roleScopes ?? {})) {
        for (const s of rs as string[]) if (!scopes.includes(s)) scopes.push(s);
      }
    } catch { /* snapshot best-effort */ }
    const wide = root || hasAnyScope(scopes, DIRECTORY_WIDE_SCOPES);
    if (!wide) return json(403, { error: "Requires HR or user-management access" });
    const canManage = root || hasAnyScope(scopes, ["admin", "user-admin"]);
    const [rosters, hiddenRaw] = await Promise.all([loadRosters(), loadHidden().catch(() => [])]);
    const hidden = new Set(normalizeHiddenEmails(hiddenRaw));
    const users = (await listUsers(store)).filter((u: any) => !isTargetRoot(u));
    const rows: Array<{
      id: string; email: string; name: string; position: string; department: string;
      via: string; auto: string; override: string | null; suggestedScopes: string[];
      sources: Array<{ id: string; kind: "telecaller" | "accountant" | "marketer" | "hr-member"; label: string }>;
      hidden?: boolean;
    }> = [];
    for (const u of users as any[]) {
      const email = String(u.email ?? "");
      const isHidden = hidden.has(email.trim().toLowerCase());
      if (isHidden && !root) continue;
      const entryScopes: string[] = [...(u.scopes ?? [])];
      try {
        const snap = await store.getAuthSnapshot(u.id);
        for (const rs of Object.values(snap.roleScopes ?? {})) {
          for (const s of rs as string[]) if (!entryScopes.includes(s)) entryScopes.push(s);
        }
      } catch { /* best-effort */ }
      const r = resolveOrgPosition(
        { email, scopes: entryScopes, override: (u.positionOverride ?? null) as string | null },
        rosters,
      );
      rows.push({
        id: u.id,
        email,
        name: u.displayName || u.name,
        position: r.position,
        department: r.department,
        via: r.via,
        auto: r.auto,
        override: (u.positionOverride ?? null) as string | null,
        suggestedScopes: POSITION_SUGGESTED_SCOPES[r.position] ?? [],
        sources: directorySources(email, rosters as DirectoryRosters),
        ...(isHidden ? { hidden: true } : {}),
      });
    }
    return json(200, { directory: rows, canManage, hiddenCount: root ? hidden.size : undefined });
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}

/** Root-only read of the hidden-login list (HR never sees the list itself). */
export async function authGetHiddenLogins(
  store: AuthStore,
  cookieHeader: string | null,
  loadHidden: () => Promise<unknown>,
): Promise<AuthResult> {
  try {
    await asRoot(store, cookieHeader);
    return json(200, { hidden: normalizeHiddenEmails(await loadHidden()) });
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}

/** Root-only write of the hidden-login list (HR never sees the list itself). */
export async function authSetHiddenLogins(
  store: AuthStore,
  cookieHeader: string | null,
  body: { hidden?: unknown },
  saveHidden: (emails: string[]) => Promise<void>,
): Promise<AuthResult> {
  try {
    await asRoot(store, cookieHeader);
    const clean = normalizeHiddenEmails(body?.hidden);
    await saveHidden(clean);
    return json(200, { ok: true, hidden: clean });
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}

export { DIRECTORY_HIDDEN_KEY };
