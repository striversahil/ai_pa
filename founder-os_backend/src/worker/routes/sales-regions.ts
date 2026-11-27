// routes/sales-regions.ts — the Sales Controller owns the region catalog and the
// position-wise allotment. Codes stay R1–R4 (historical rows store them); the
// sales head edits the label, the team-lead tier, the states list and which
// chart seats may hold each region. The employee save enforces the result.
//
// GET   /api/org/regions                      — catalog + allotment (any login)
// GET   /api/sales/regions                    — catalog + usage + chart (sales head)
// PATCH /api/sales/regions/:code              — name/tlLevel/states/order/active
// PUT   /api/sales/position-regions/:positionId — { regions: string[] }
import type { Hono } from "hono";
import { deps, notifyLive, LiveEvent, type Bindings } from "../context";
import { getViewerMe } from "../viewer";
import { readBody } from "../http";
import { actorLabel, errorResponse } from "./hr-route-shared";
import { requireSalesManager } from "./sales-access";
import { listChartRows } from "../../modules/org/chart/store";
import { loadAllotment, loadSalesRegions, regionRowJson } from "../../modules/org/regions";
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
    const [regions, allotment] = await Promise.all([
      loadSalesRegions(prisma),
      loadAllotment(prisma),
    ]);
    return c.json({ regions, allotment });
  });

  app.get("/api/sales/regions", async (c) => {
    if (!(await requireSalesManager(c))) return c.json({ error: "sales-head or root only" }, 403);
    const prisma = deps().prisma;
    try {
      const [regions, allotment, usage, chart] = await Promise.all([
        loadSalesRegions(prisma),
        loadAllotment(prisma),
        usageCounts(prisma),
        listChartRows().catch(() => []),
      ]);
      return c.json({
        regions: regions.map((r) => ({ ...r, seats: usage.counts[r.code] ?? 0, staff: usage.staff[r.code] ?? { teamLeads: [], members: [] } })),
        allotment,
        positions: (chart as any[]).map((p) => ({
          id: String(p.id), title: String(p.title),
          department: p.department ? String(p.department) : null,
          active: p.active !== false,
        })),
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

  app.put("/api/sales/position-regions/:positionId", async (c) => {
    if (!(await requireSalesManager(c))) return c.json({ error: "sales-head or root only" }, 403);
    const positionId = String(c.req.param("positionId") ?? "");
    const body: any = (await readBody(c)) ?? {};
    const wanted = [...new Set(cleanStates(body.regions).map((s) => s.toUpperCase()))];
    const bad = wanted.filter((code) => !CODES.includes(code));
    if (bad.length) return c.json({ error: `unknown region ${bad[0]}` }, 400);
    const prisma = deps().prisma;
    try {
      const position: any = await prisma.orgChartPosition.findUnique({ where: { id: positionId } });
      if (!position) throw new HrError("chart position not found", 404);
      const before = await loadAllotment(prisma);
      const previous = before[positionId] ?? [];
      const removed = previous.filter((code) => !wanted.includes(code));
      if (removed.length) {
        const seated = await prisma.humanResourcesMember.findMany({
          where: { deleted: false, active: true, designation: String(position.title) },
        }).catch(() => []);
        const taken = (seated as any[]).filter((m) =>
          parseRegionList(m.salesRegions).some((code) => removed.includes(code)));
        if (taken.length) {
          throw new HrError(`move ${taken.length} seated employee(s) out of ${removed.join(", ")} first`, 409);
        }
      }
      await prisma.humanResourcesPositionRegion.deleteMany({ where: { orgPositionId: positionId } });
      if (wanted.length) {
        await prisma.humanResourcesPositionRegion.createMany({
          data: wanted.map((code) => ({ orgPositionId: positionId, regionCode: code })),
        });
      }
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true, regions: wanted });
    } catch (e) { return errorResponse(c, e); }
  });
}