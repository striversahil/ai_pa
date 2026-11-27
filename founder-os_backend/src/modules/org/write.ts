// modules/org/write.ts — the single person save.
//
// The employee row IS the sales row (mig 0177): seating someone on a chart
// sales seat writes salesType + salesRegions + salesTeamLeadId on their
// HumanResourcesMember. There is no second roster to create, mirror or
// backfill — a person without an employee record cannot exist here.
import type { AuthStore } from "../auth/store-parts/types";
import { canManagePerson, rosterTypeFor, isChartTitle } from "./access";
import { getChartTitleLookup, getChartRowByTitle } from "./chart/store";
import { cleanRegions, validateSalesPosting } from "./regions";
import { fail, parseRegionList } from "./types";
import type { AssignInput } from "./types";

/** The single person save: position, sales profile, active. */
export async function assignPerson(opts: {
  prisma: any; store?: AuthStore; me: any;
  employeeId: string; input: AssignInput;
}): Promise<{ ok: true }> {
  const { prisma, me, employeeId, input } = opts;
  if (!me) fail(401, "Authentication required");
  const current: any = await prisma.humanResourcesMember.findUnique({ where: { id: employeeId } }).catch(() => null);
  if (!current || current.deleted) fail(404, "employee not found");

  const title = input.position !== undefined ? String(input.position).trim() : String(current.designation ?? "");
  if (!title) fail(400, "position required");
  // The chart is the only source of positions — free-text designations are
  // refused (same rule the HR employee form enforces client-side).
  const chartLookup = await getChartTitleLookup().catch(() => null);
  const chartHasTitle = chartLookup ? chartLookup.has(title) : isChartTitle(title);
  if (!chartHasTitle) fail(400, "pick the organization position from the chart");
  const dept = String(current.department ?? "");
  if (!canManagePerson(
    { isRoot: me?.isRoot, isAdmin: me?.isAdmin, scopes: me?.scopes, roles: me?.roles },
    { title, department: dept || null },
  )) fail(403, "Not your department — ask HR or root");

  const rosterType = rosterTypeFor(title, chartLookup?.get(title));
  const chartRow = rosterType ? await getChartRowByTitle(title) : null;
  const hadProfile = !!String(current.salesType ?? "");

  // ── Employee master (designation + office phone + active) ──
  const empPatch: Record<string, unknown> = {};
  if (input.position !== undefined) empPatch.designation = title;
  if (input.officePhone !== undefined) empPatch.phone = input.officePhone ? String(input.officePhone) : null;
  if (input.active !== undefined) empPatch.active = !!input.active;
  if (Object.keys(empPatch).length > 0) {
    const { updateEmployee } = await import("../../automations/human-resources/employees");
    await updateEmployee(employeeId, empPatch);
  }

  const profile: Record<string, unknown> = {};
  if (rosterType) {
    // Regions: a full list wins; the legacy region/region2 pair is merged so
    // old clients keep working. Any number (0..N) is legal.
    const existingRegions = parseRegionList(current.salesRegions);
    let regions = existingRegions;
    if (input.regions !== undefined) regions = cleanRegions(input.regions);
    else if (input.region !== undefined || input.region2 !== undefined) {
      regions = cleanRegions([
        input.region !== undefined ? input.region : existingRegions[0] ?? "",
        input.region2 !== undefined ? input.region2 : existingRegions[1] ?? "",
      ]);
    }
    const postingErr = await validateSalesPosting(prisma, {
      regions,
      positionId: chartRow?.id ? String(chartRow.id) : null,
    });
    if (postingErr) fail(400, postingErr);

    let teamLeadId = input.teamLeadId !== undefined
      ? (input.teamLeadId ? String(input.teamLeadId) : null)
      : ((current.salesTeamLeadId as string | null) ?? null);
    if (rosterType === "team_lead") teamLeadId = null;
    if (teamLeadId) {
      if (teamLeadId === employeeId) fail(400, "a person cannot report to themselves");
      const lead: any = await prisma.humanResourcesMember.findUnique({ where: { id: teamLeadId } }).catch(() => null);
      if (!lead || lead.deleted) fail(400, "team lead not found");
      if (String(lead.salesType ?? "") !== "team_lead" || lead.active === false) {
        fail(400, "pick an active team lead from the sales chart");
      }
    }

    profile.salesType = rosterType;
    profile.salesRegions = JSON.stringify(regions);
    profile.salesTeamLeadId = teamLeadId;
    if (input.whatsapp !== undefined) profile.whatsapp = input.whatsapp ? String(input.whatsapp) : null;
    if (input.neodoveUserId !== undefined) profile.neodoveUserId = input.neodoveUserId || null;
    if (input.neodoveUserName !== undefined) profile.neodoveUserName = input.neodoveUserName || null;
    if (input.assignEstimateFollowUps !== undefined) {
      profile.salesAssignFollowUps = !!input.assignEstimateFollowUps;
    }
  } else if (hadProfile) {
    // Left the sales chart (promotion, transfer, deactivation): drop the
    // profile so the board no longer counts them. History keeps their employee
    // id, so estimates/visits/credits stay attributed to the same person.
    profile.salesType = "";
    profile.salesRegions = "[]";
    profile.salesTeamLeadId = null;
    profile.salesAssignFollowUps = false;
    profile.salesAbsentSince = null;
  }
  if (input.active === false && hadProfile) {
    profile.salesType = "";
    profile.salesRegions = "[]";
    profile.salesTeamLeadId = null;
    profile.salesAssignFollowUps = false;
  }

  if (Object.keys(profile).length > 0) {
    await prisma.humanResourcesMember.update({ where: { id: employeeId }, data: profile });
    // A Team Lead who leaves the seat must not leave staff pointing at them.
    const wasLead = String(current.salesType ?? "") === "team_lead";
    if (wasLead && profile.salesType !== "team_lead") {
      try {
        await prisma.humanResourcesMember.updateMany({
          where: { salesTeamLeadId: employeeId },
          data: { salesTeamLeadId: null },
        });
      } catch { /* staff stay linked until the next save; never block the person save */ }
    }
    try { await bustSalesCaches(); } catch { /* non-fatal */ }
  }

  return { ok: true };
}

async function bustSalesCaches(): Promise<void> {
  const { invalidateRiskCache } = await import("../../automations/telecalling/risk");
  await invalidateRiskCache();
  try {
    const { invalidateFieldStaffCache } = await import("../../modules/field-visits/service");
    await invalidateFieldStaffCache();
  } catch { /* non-fatal */ }
  try {
    const { bumpRev } = await import("../../shared/cache");
    await bumpRev("est");
  } catch { /* non-fatal */ }
}

