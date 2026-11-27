// routes/sales-regions.ts — the Sales Controller owns the region catalog.
// Codes stay R1–R4 (historical rows store them); the sales head edits the label,
// the team-lead tier, the states list and active. Which regions a PERSON holds is
// picked on that person from the Sales team chart (mig 0177/0179 — the old
// position-wise allotment table is gone). The employee save enforces the result.
//
// GET   /api/org/regions                      — catalog (any login)
// GET   /api/sales/regions                    — catalog + usage (sales head)
// PATCH /api/sales/regions/:code              — name/tlLevel/states/order/active
import type { Hono } from "hono";
import { deps, notifyLive, LiveEvent, type Bindings } from "../context";
import { getViewerMe } from "../viewer";
import { readBody } from "../http";
import { actorLabel, errorResponse } from "./hr-route-shared";
import { requireSalesManager } from "./sales-access";
import { loadSalesRegions, regionRowJson } from "../../modules/org/regions";
import { parseRegionList } from "../../modules/org/types";
import { HrError } from "../../automations/human-resources/errors";
import { bumpRev } from "../../shared/cache";
import { employeeDisplayName } from "../../shared/employee-name";

const CODES = ["R1", "R2", "R3", "R4"];
const TIERS = ["TL1", "TL2"];

function cleanStates(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "").split(",");
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))].slice(0, 60);
}

interface RegionStaff { teamLeads: Array<{ id: string; name: string }>; members: Array<{ id: string; name: string; type: string }> }

/** Active sales staff per region — counted from the employee profile (0..N
 *  regions each), so a person shows under EVERY region they hold. */
async function usageCounts(prisma: any): Promise<{ counts: Record<string, number>; staff: Record<string, RegionStaff> }> {
  const rows = await prisma.humanResourcesMember.findMany({ where: { deleted: false, active: true } }).catch(() => []);
  const counts: Record<string, number> = {};
  const staff: Record<string, RegionStaff> = {};
  for (const m of (rows as any[])) {
    const type = String(m.salesType ?? "");
    if (!type) continue;
    for (const code of parseRegionList(m.salesRegions)) {
      counts[code] = (counts[code] ?? 0) + 1;
      const bucket = (staff[code] ??= { teamLeads: [], members: [] });
      const rec = { id: String(m.id), name: employeeDisplayName(m) };
      if (type === "team_lead") bucket.teamLeads.push(rec);
      else bucket.members.push({ ...rec, type });
    }
  }
  return { counts, staff };
}

export function registerSalesRegionRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get("/api/org/regions", async (c) => {
    const me = await getViewerMe(c).catch(() => null);
    if (!me) return c.json({ error: "Authentication required" }, 401);
    const prisma = deps().prisma;
    return c.json({ regions: await loadSalesRegions(prisma) });
  });

  app.get("/api/sales/regions", async (c) => {
    if (!(await requireSalesManager(c))) return c.json({ error: "sales-head or root only" }, 403);
    const prisma = deps().prisma;
    try {
      const [regions, usage] = await Promise.all([
        loadSalesRegions(prisma),
        usageCounts(prisma),
      ]);
      return c.json({
        regions: regions.map((r) => ({ ...r, seats: usage.counts[r.code] ?? 0, staff: usage.staff[r.code] ?? { teamLeads: [], members: [] } })),
      });
    } catch (e) { return errorResponse(c, e); }
  });

  app.patch("/api/sales/regions/:code", async (c) => {
    if (!(await requireSalesManager(c))) return c.json({ error: "sales-head or root only" }, 403);
    const code = String(c.req.param("code") ?? "").trim().toUpperCase();
    if (!CODES.includes(code)) return c.json({ error: "unknown region" }, 404);
    const body: any = (await readBody(c)) ?? {};
    const me = await getViewerMe(c).catch(() => null);
    const patch: Record<string, unknown> = { updatedBy: actorLabel(me) };
    try {
      if (body.name !== undefined) {
        const name = String(body.name ?? "").trim();
        if (!name) throw new HrError("name cannot be empty");
        patch.name = name.slice(0, 90);
      }
      if (body.tlLevel !== undefined) {
        const tier = String(body.tlLevel ?? "").trim().toUpperCase();
        if (!TIERS.includes(tier)) throw new HrError("tlLevel must be TL1 or TL2");
        patch.tlLevel = tier;
      }
      if (body.states !== undefined) patch.states = JSON.stringify(cleanStates(body.states));
      if (body.order !== undefined) patch.order = Math.max(0, Math.trunc(Number(body.order) || 0));
      if (body.active !== undefined) patch.active = !!body.active;
      if (Object.keys(patch).length <= 1) throw new HrError("nothing to update");
      const prisma = deps().prisma;
      const current = await prisma.humanResourcesRegion.findUnique({ where: { code } });
      if (!current) throw new HrError("region not found", 404);
      const row = await prisma.humanResourcesRegion.update({ where: { code }, data: patch });
      // The board payload embeds region names/tiers and is KV-cached on the
      // est/neo revs — a rename must reach the next compute, not a TTL.
      await bumpRev("est").catch(() => { /* cache is best-effort */ });
      notifyLive(c, { type: LiveEvent.HumanResources });
      notifyLive(c, { type: LiveEvent.Telecalling });
      return c.json(regionRowJson(row));
    } catch (e) { return errorResponse(c, e); }
  });
}