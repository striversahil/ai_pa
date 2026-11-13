// modules/org/write.ts — the single person save + the roster backfill.
//
// Writes employee + roster + login access through the existing services
// (never raw SQL here). All rules live in ./access.ts (pure).
import { setUserScopes } from "../auth/service";
import type { AuthStore } from "../auth/store-parts/types";
import { canManagePerson, rosterTypeFor, isChartTitle } from "./access";
import { fail, normEmail, isPrivileged, heldScopes } from "./types";
import type { AssignInput } from "./types";
import { isValidRegion, isValidTlLevel, tlPairError } from "../../automations/telecalling/service";
import { normalizeAgentPhone } from "../../automations/telecalling/util";

/** The single person save: position, sales fields, access, active. */
export async function assignPerson(opts: {
  prisma: any; store: AuthStore; me: any;
  employeeId: string; input: AssignInput;
}): Promise<{ ok: true }> {
  const { prisma, store, me, employeeId, input } = opts;
  if (!me) fail(401, "Authentication required");
  const current: any = await prisma.humanResourcesMember.findUnique({ where: { id: employeeId } }).catch(() => null);
  if (!current || current.deleted) fail(404, "employee not found");

  const title = input.position !== undefined ? String(input.position).trim() : String(current.designation ?? "");
  if (!title) fail(400, "position required");
  // The chart is the only source of positions — free-text designations are
  // refused (same rule the HR employee form enforces client-side).
  if (!isChartTitle(title)) fail(400, "pick the organization position from the chart");
  const dept = String(current.department ?? "");
  if (!canManagePerson(
    { isRoot: me?.isRoot, isAdmin: me?.isAdmin, scopes: me?.scopes, roles: me?.roles },
    { title, department: dept || null },
  )) fail(403, "Not your department — ask HR or root");

  const rosterType = rosterTypeFor(title);
  let region = input.region !== undefined ? String(input.region ?? "") : undefined;
  let region2 = input.region2 !== undefined ? String(input.region2 ?? "") : undefined;
  let tlLevel = input.tlLevel !== undefined ? String(input.tlLevel ?? "") : undefined;
  if (rosterType) {
    if (region !== undefined && region !== "" && !isValidRegion(region)) fail(400, "region must be R1–R4");
    if (region2 !== undefined && region2 !== "" && !isValidRegion(region2)) fail(400, "region2 must be R1–R4");
    if (rosterType !== "team_lead" && region2) fail(400, "second region is Team-Lead-only");
    if (tlLevel !== undefined && tlLevel !== "" && !isValidTlLevel(tlLevel)) fail(400, "tlLevel must be TL1 or TL2 (or unset)");
    const pairErr = tlPairError(tlLevel ?? "", region ?? "", rosterType === "team_lead" ? (region2 ?? "") : "");
    if (pairErr) fail(400, pairErr);
  }

  // ── Scopes: reject-loud beyond power, force-keep beyond-power currents ──
  const users = await store.listUsers().catch(() => [] as any[]);
  const empEmails = [normEmail(current.email), normEmail(current.loginEmail)].filter(Boolean);
  const login = (users as any[]).find((u) =>
    !(u as any)?.isRoot && empEmails.includes(normEmail((u as any).email)),
  ) as any;
  if (input.scopes !== undefined && login) {
    if (!Array.isArray(input.scopes)) fail(400, "scopes must be an array");
    const known = new Set((await store.listScopes().catch(() => [] as any[])).map((s: any) => String(s.key).toLowerCase()));
    const wanted = [...new Set((input.scopes as string[]).map((s) => String(s)))].filter((s) => known.has(s.toLowerCase()));
    const held = heldScopes(me);
    if (!isPrivileged(me) && !held.has("admin")) {
      for (const s of wanted) {
        if (!held.has(s.toLowerCase())) fail(403, `grants '${s}' which you don't hold — ask root to grant it to you first`);
      }
    }
    const direct = await store.getUserScopeKeys(login.id);
    const locked = direct.filter((s) => !isPrivileged(me) && !held.has("admin") && !held.has(String(s).toLowerCase()));
    await setUserScopes(store, login.id, [...new Set([...wanted, ...locked])]);
    try {
      const { invalidateAllSessionCaches } = await import("../auth/service");
      invalidateAllSessionCaches();
    } catch { /* best-effort */ }
  }

  // ── Employee master (office phone lives here) ──
  const empPatch: Record<string, unknown> = {};
  if (input.position !== undefined) empPatch.designation = title;
  if (input.officePhone !== undefined) empPatch.phone = input.officePhone ? String(input.officePhone) : null;
  if (input.active !== undefined) empPatch.active = !!input.active;
  if (Object.keys(empPatch).length > 0) {
    const { updateEmployee } = await import("../../automations/human-resources/employees");
    await updateEmployee(employeeId, empPatch);
  }

  // ── Sales fields (roster row mirrors the employee by email) ──
  const rosterEmail = empEmails[0] || null;
  const existing = rosterEmail
    ? await prisma.telecaller.findMany({}).then((rows: any[]) =>
      (rows as any[]).find((t) => !(t as any).deleted && empEmails.includes(normEmail((t as any).email))),
    ).catch(() => null)
    : null;
  if (rosterType) {
    if (region === undefined && existing) region = String((existing as any).region ?? "");
    if (region2 === undefined && existing) region2 = String((existing as any).region2 ?? "");
    if (tlLevel === undefined && existing) tlLevel = String((existing as any).tlLevel ?? "");
    if (!region) fail(400, "region required for sales staff (R1–R4)");
    const phone = input.officePhone !== undefined
      ? (input.officePhone ? normalizeAgentPhone(input.officePhone) || null : null)
      : ((existing as any)?.phone ?? null);
    const data: Record<string, unknown> = {
      name: String(current.name ?? ""),
      email: rosterEmail,
      phone,
      whatsapp: input.whatsapp !== undefined ? (input.whatsapp ? String(input.whatsapp) : null) : ((existing as any)?.whatsapp ?? null),
      tlLevel: tlLevel ?? "",
      region,
      region2: rosterType === "team_lead" ? (region2 ?? "") : "",
      type: rosterType,
      assignEstimateFollowUps: rosterType === "field_staff" ? false : ((existing as any)?.assignEstimateFollowUps ?? true),
      neodoveUserId: input.neodoveUserId !== undefined ? (input.neodoveUserId || null) : ((existing as any)?.neodoveUserId ?? null),
      neodoveUserName: input.neodoveUserName !== undefined ? (input.neodoveUserName || null) : ((existing as any)?.neodoveUserName ?? null),
      deleted: false,
    };
    // Re-validate the final pair (partial updates re-check the whole TL1 pair).
    const finalErr = tlPairError(
      String(data.tlLevel ?? ""), String(data.region ?? ""),
      rosterType === "team_lead" ? String(data.region2 ?? "") : "",
    );
    if (finalErr) fail(400, finalErr);
    let rowId: string;
    if (existing) {
      const updated: any = await prisma.telecaller.update({ where: { id: (existing as any).id }, data });
      rowId = String(updated.id);
    } else {
      const created: any = await prisma.telecaller.create({ data });
      rowId = String(created.id);
    }
    try { await bustRosterCaches(); } catch { /* non-fatal */ }
    try { const { mirrorRosterRow } = await import("../core/sync"); await mirrorRosterRow("telecaller", rowId); } catch { /* non-fatal */ }
  } else if (existing) {
    // Left Sales: retire the roster row so the leaderboard drops them.
    await retireRosterRow(prisma, (existing as any).id);
  }
  if (input.active === false && existing) {
    await retireRosterRow(prisma, (existing as any).id);
  }

  return { ok: true };
}

async function retireRosterRow(prisma: any, id: string): Promise<void> {
  await prisma.telecaller.update({
    where: { id },
    data: { deleted: true, assignEstimateFollowUps: false },
  }).catch(() => null);
  try { await bustRosterCaches(); } catch { /* non-fatal */ }
}

async function bustRosterCaches(): Promise<void> {
  const { invalidateRiskCache } = await import("../../automations/telecalling/service");
  await invalidateRiskCache();
  try {
    const { invalidateFieldStaffCache } = await import("../../modules/field-visits/service");
    await invalidateFieldStaffCache();
  } catch { /* non-fatal */ }
}

/** Root-only one-time migration: roster rows without an employee record get
 *  one (email-exact join key). Idempotent — existing matches are skipped. */
export async function backfillEmployees(opts: { prisma: any }): Promise<{ created: number; skipped: number }> {
  const { prisma } = opts;
  const [employees, telecallers] = await Promise.all([
    prisma.humanResourcesMember.findMany({ where: { deleted: false } }).catch(() => []),
    prisma.telecaller.findMany({ where: { deleted: false } }).catch(() => []),
  ]);
  const have = new Set<string>();
  for (const e of (employees as any[])) {
    for (const x of [normEmail((e as any).email), normEmail((e as any).loginEmail)]) if (x) have.add(x);
  }
  const { createEmployee } = await import("../../automations/human-resources/employees");
  let created = 0, skipped = 0;
  const titleFor = (t: string): string =>
    t === "field_staff" ? "Field Staff" : t === "team_lead" ? "Team Lead" : "Telecaller";
  for (const t of (telecallers as any[])) {
    const email = normEmail((t as any).email);
    if (!email || have.has(email)) { skipped++; continue; }
    try {
      await createEmployee({
        name: String((t as any).name ?? email),
        email,
        phone: (t as any).phone ?? null,
        designation: titleFor(String((t as any).type ?? "telecaller")),
        department: "Sales",
        active: true,
      });
      have.add(email);
      created++;
    } catch { skipped++; }
  }
  return { created, skipped };
}
