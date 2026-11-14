// Extracted as its own routes-part (same pattern as io.ts): Worker route
// handlers stay thin orchestrators; all logic lives here. Re-exported via
// ../routes.ts so existing imports keep working.
import { requireUser, listUsers } from "../service";
import { AuthStore } from "../store";
import { AuthError } from "../types";
import { resolveOrgPosition, POSITION_SUGGESTED_SCOPES } from "../positions";
import type { RosterSnapshot } from "../positions";
import {
  DIRECTORY_WIDE_SCOPES,
  directorySources, hasAnyScope,
} from "../directory";
import type { DirectoryRosters } from "../directory";
import type { AuthResult } from "./types";
import { json, isTargetRoot } from "./pure";

/**
 * Unified employee directory (view-first): one entry per non-root login with
 * org position (roster-first, same resolver as the Users portal) + roster
 * source links (ids only). HR holders (`human-resources` scope) get read-only
 * width (`canManage: false`) — they cannot edit users/roles through any other
 * endpoint (unchanged gates).
 */
export async function authDirectory(
  store: AuthStore,
  cookieHeader: string | null,
  loadRosters: () => Promise<RosterSnapshot & DirectoryRosters>,
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
    const rosters = await loadRosters();
    const users = (await listUsers(store)).filter((u: any) => !isTargetRoot(u));
    const rows: Array<{
      id: string; email: string; name: string; position: string; department: string;
      via: string; auto: string; override: string | null; suggestedScopes: string[];
      sources: Array<{ id: string; kind: "telecaller" | "accountant" | "marketer" | "hr-member"; label: string }>;
    }> = [];
    for (const u of users as any[]) {
      const email = String(u.email ?? "");
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
      });
    }
    return json(200, { directory: rows, canManage });
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}

/** Core assignment catalog + per-login primary designation (read-only).
 *  Reads locked core tables (departments, positions, user links, primary
 *  emp_position/emp_dept rows) — never writes. Same gate as the directory:
 *  managers + HR holders read, HR read-only. Assignment WRITES need a human
 *  (locked core) — see
 *  docs/core-change-requests/2026-11-12-core-assignment-write.md. */
export interface CoreCatalogPosition {
  id: string;
  code: string;
  name: string;
  rank: number;
}

export interface CoreCatalogDepartment {
  id: string;
  code: string;
  name: string;
  positions: CoreCatalogPosition[];
}

export interface CoreAssignmentRow {
  departmentId: string;
  departmentCode: string;
  department: string;
  positionId: string;
  positionCode: string;
  designation: string;
}

export async function authCoreAssignments(
  store: AuthStore,
  cookieHeader: string | null,
  loadCore: () => Promise<{
    departments: any[];
    positions: any[];
    links: any[];
    empPositions: any[];
    empDepts: any[];
  } | null>,
): Promise<AuthResult> {
  try {
    const me = await requireUser(store, cookieHeader);
    const root = (me as any).isRoot === true;
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
    const core = await loadCore().catch(() => null);
    if (!core) return json(200, { assignments: {}, catalog: { departments: [] }, canManage, coreUnavailable: true });
    const posById = new Map((core.positions as any[]).map((p) => [String(p.id), p]));
    const deptById = new Map((core.departments as any[]).map((d) => [String(d.id), d]));
    const empByUser = new Map((core.links as any[]).map((l) => [String(l.authUserId), String(l.employeeId)]));
    const primaryPos = new Map<string, any>();
    for (const ap of core.empPositions as any[]) {
      if (ap?.validTo || ap?.isPrimary === false) continue;
      if (!primaryPos.has(String(ap.employeeId))) primaryPos.set(String(ap.employeeId), ap);
    }
    const primaryDept = new Map<string, any>();
    for (const ad of core.empDepts as any[]) {
      if (ad?.validTo || ad?.isPrimary === false) continue;
      if (!primaryDept.has(String(ad.employeeId))) primaryDept.set(String(ad.employeeId), ad);
    }
    const users = (await listUsers(store)).filter((u: any) => !isTargetRoot(u));
    const assignments: Record<string, CoreAssignmentRow> = {};
    for (const u of users as any[]) {
      const empId = empByUser.get(String(u.id));
      if (!empId) continue;
      const ap = primaryPos.get(empId);
      if (!ap) continue;
      const pos = posById.get(String(ap.positionId));
      if (!pos) continue;
      const ad = primaryDept.get(empId);
      const dept = ad ? deptById.get(String(ad.departmentId)) : null;
      const deptFromPos = !dept && (pos as any).departmentId ? deptById.get(String((pos as any).departmentId)) : null;
      const d = dept ?? deptFromPos;
      assignments[String(u.id)] = {
        departmentId: d ? String(d.id) : "",
        departmentCode: d ? String(d.code ?? "") : "",
        department: d ? String(d.name ?? "") : "",
        positionId: String(pos.id),
        positionCode: String(pos.code ?? ""),
        designation: String(pos.name ?? ""),
      };
    }
    const catalog: CoreCatalogDepartment[] = (core.departments as any[])
      .filter((d) => d?.active !== false)
      .map((d) => ({
        id: String(d.id),
        code: String(d.code ?? ""),
        name: String(d.name ?? ""),
        positions: (core.positions as any[])
          .filter((p) => p?.active !== false && String(p.departmentId ?? "") === String(d.id))
          .map((p) => ({ id: String(p.id), code: String(p.code ?? ""), name: String(p.name ?? ""), rank: Number(p.rank ?? 100) || 100 }))
          .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return json(200, { assignments, catalog: { departments: catalog }, canManage });
  } catch (e: any) {
    const err = e instanceof AuthError ? e : new AuthError("FORBIDDEN", e?.message);
    return json(err.status, { error: err.message });
  }
}
