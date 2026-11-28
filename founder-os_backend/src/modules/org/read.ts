// modules/org/read.ts — the one org read.
//
// Employees + login + last login + sales profile, joined email-exact (never
// name-guessed). Viewer-scoped server-side: root/admin/HR see all, sales-head
// sees Sales, dept scopes see their own.
//
// Since mig 0177 the sales profile lives ON the employee (salesType /
// salesRegions / salesTeamLeadId): there is no separate roster row to join.
import type { AuthStore } from "../auth/store-parts/types";
import { canManagePerson, positionScopes, chartTitleToPosition } from "./access";
import { getChartTitleLookup } from "./chart/store";
import { fail, normEmail, isPrivileged, heldScopes, parseRegionList } from "./types";
import { employeeDisplayName } from '../../shared/employee-name';
import type { OrgPerson, OrgPeople } from "./types";

/** Departments this viewer may READ people in (null = all). Procurement maps
 *  to the chart's "Operations & Support" (no data migration) — same rule as
 *  access.ts#isHomeDepartment. */
function visibleDepartments(me: any): string[] | null {
  if (!me) return [];
  if (isPrivileged(me)) return null;
  const held = heldScopes(me);
  if (held.has("admin") || held.has("human-resources") || held.has("user-admin")) return null;
  const out: string[] = [];
  if (held.has("sales-head")) out.push("Sales");
  if (held.has("accounts")) out.push("Accounts");
  if (held.has("digital-marketing")) out.push("Digital Marketing");
  if (held.has("procurement")) out.push("Procurement", "Operations & Support");
  return out;
}

async function loadLastLogins(db: any): Promise<Record<string, string | null>> {
  try {
    if (!db || typeof db.prepare !== "function") return {};
    const res = await db.prepare(
      "SELECT userId, MAX(createdAt) AS lastLoginAt FROM auth_session GROUP BY userId",
    ).all();
    const out: Record<string, string | null> = {};
    for (const r of ((res as any)?.results ?? []) as any[]) {
      if (r?.userId) out[String(r.userId)] = r.lastLoginAt ? String(r.lastLoginAt) : null;
    }
    return out;
  } catch { return {}; }
}

export async function getOrgPeople(opts: {
  prisma: any; store: AuthStore; db?: any; me: any;
  department?: string | null;
}): Promise<OrgPeople> {
  const { prisma, store, me } = opts;
  const depts = visibleDepartments(me);
  if (depts !== null && depts.length === 0) fail(403, "Requires HR, sales-head or department access");
  const deptFilter = opts.department ? String(opts.department) : null;
  if (deptFilter && depts !== null && !depts.includes(deptFilter)) {
    fail(403, `No access to ${deptFilter}`);
  }

  const [employees, users, lastLogins] = await Promise.all([
    prisma.humanResourcesMember.findMany({ where: { deleted: false } }).catch(() => []),
    store.listUsers().catch(() => []),
    loadLastLogins(opts.db),
  ]);

  const chartLookup = await getChartTitleLookup().catch(() => null);
  const allRoles = await store.listRoles().catch(() => [] as any[]);
  const rolePos = new Map<string, string>();
  for (const role of (allRoles as any[])) {
    const pos = String((role as any)?.position ?? "").trim();
    if (pos) rolePos.set(String(role.key), pos);
  }

  const loginByEmail = new Map<string, any>();
  for (const u of (users as any[])) {
    if ((u as any)?.isRoot) continue;
    loginByEmail.set(normEmail((u as any).email), u);
  }

  const people: OrgPerson[] = [];
  const claimedLoginIds = new Set<string>();
  for (const emp of (employees as any[])) {
    const dept = (emp as any).department ?? null;
    if (depts !== null && dept && !depts.includes(dept)) continue;
    if (deptFilter && dept !== deptFilter) continue;
    // loginEmail wins for the login match (alias Gmail logins).
    const loginEmail = normEmail((emp as any).loginEmail);
    const empEmail = normEmail((emp as any).email);
    const emails = [loginEmail, empEmail].filter(Boolean);
    let login: any = null;
    for (const e of emails) {
      const hit = loginByEmail.get(e);
      if (hit) { login = hit; break; }
    }
    if (login) claimedLoginIds.add(String((login as any).id));
    const title = String((emp as any).designation ?? "");
    const loginKey = (chartLookup ? chartLookup.get(title) : chartTitleToPosition(title)) ?? "";
    const suggested = loginKey ? positionScopes(loginKey) : [];
    let loginScopes: string[] = [];
    let loginRoles: string[] = [];
    if (login) {
      loginScopes = [...(((login as any).scopes ?? []) as string[])];
      loginRoles = [...(((login as any).roles ?? []) as string[])];
      try {
        const snap = await store.getAuthSnapshot((login as any).id);
        for (const rs of Object.values(snap.roleScopes ?? {})) {
          for (const s of rs as string[]) if (!loginScopes.includes(s)) loginScopes.push(s);
        }
        if (Array.isArray((snap as any).roles)) {
          loginRoles = [...new Set([...loginRoles, ...((snap as any).roles as string[])])];
        }
      } catch { /* best-effort */ }
    }
    const salesType = String((emp as any).salesType ?? "");
    people.push({
      employee: {
        id: String((emp as any).id),
        name: String((emp as any).name ?? ""),
        displayName: employeeDisplayName(emp),
        email: (emp as any).email ?? null,
        loginEmail: (emp as any).loginEmail ?? null,
        phone: (emp as any).phone ?? null,
        designation: (emp as any).designation ?? null,
        department: dept,
        active: (emp as any).active !== false,
      },
      login: login ? {
        id: String((login as any).id),
        email: String((login as any).email ?? ""),
        name: String((login as any).displayName || (login as any).name || ""),
        scopes: loginScopes,
        roles: loginRoles,
        positions: [...new Set(loginRoles.map((k) => rolePos.get(String(k))).filter(Boolean))] as string[],
        lastLoginAt: lastLogins[String((login as any).id)] ?? null,
      } : null,
      roster: salesType ? {
        id: String((emp as any).id),
        type: salesType,
        regions: parseRegionList((emp as any).salesRegions),
        teamLeadId: (emp as any).salesTeamLeadId ? String((emp as any).salesTeamLeadId) : null,
        whatsapp: (emp as any).whatsapp ?? null,
        phone: (emp as any).phone ?? null,
        assignEstimateFollowUps: (emp as any).salesAssignFollowUps !== false,
        absentSince: (emp as any).salesAbsentSince ?? null,
      } : null,
      suggestedScopes: suggested,
      loginPosition: loginKey || null,
      canManage: canManagePerson(
        { isRoot: me?.isRoot, isAdmin: me?.isAdmin, scopes: me?.scopes, roles: me?.roles },
        { title, department: dept },
      ),
      emailMismatch: !!(loginEmail && empEmail && loginEmail !== empEmail),
    });
  }

  const employeeEmails = new Set<string>();
  for (const emp of (employees as any[])) {
    for (const e of [normEmail((emp as any).email), normEmail((emp as any).loginEmail)]) {
      if (e) employeeEmails.add(e);
    }
  }
  const unlinkedLogins = ((users as any[]) as any[])
    .filter((u) => !(u as any)?.isRoot && !claimedLoginIds.has(String((u as any).id)) && !employeeEmails.has(normEmail((u as any).email)))
    .map((u) => ({ id: String((u as any).id), email: String((u as any).email ?? ""), name: String((u as any).name ?? "") }));

  return { people, unlinkedLogins };
}
