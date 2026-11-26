// routes/org-chart.ts — editable organization chart (Worker-only).
// GET is open to any signed-in viewer; writes are HR/root/admin only.
import type { Hono } from "hono";
import { authStore, notifyLive, LiveEvent, type Bindings } from "../context";
import { getViewerMe } from "../viewer";
import { readBody } from "../http";
import { ScopeKeys } from "../../modules/auth/types";
import { getOrgChart } from "../../modules/org/chart/store";
import {
  createChartPosition, deleteChartPosition, updateChartPosition,
} from "../../modules/org/chart/write";

function canManageChart(me: any): boolean {
  if (!me) return false;
  if (me.isRoot || me.isAdmin) return true;
  return ((me.scopes ?? []) as string[]).includes(ScopeKeys.HumanResources);
}

async function roleTitles(c: any): Promise<Set<string>> {
  try {
    const roles = await authStore(c).listRoles();
    return new Set((roles ?? []).map((r: any) => String(r.position ?? "").trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function chartError(c: any, e: any) {
  return c.json({ error: e?.message ?? "chart request failed" }, e?.status ?? 400);
}

export function registerOrgChartRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get("/api/org/chart", async (c) => {
    const me = await getViewerMe(c);
    if (!me) return c.json({ error: "Authentication required" }, 401);
    try {
      return c.json(await getOrgChart(canManageChart(me)));
    } catch (e) { return chartError(c, e); }
  });

  app.post("/api/org/chart/positions", async (c) => {
    const me = await getViewerMe(c);
    if (!me) return c.json({ error: "Authentication required" }, 401);
    if (!canManageChart(me)) return c.json({ error: "Requires 'human-resources' permission" }, 403);
    const body = await readBody(c);
    try {
      const row = await createChartPosition(body || {}, me.user?.name ?? me.user?.email ?? null, await roleTitles(c));
      try { notifyLive(c, { type: LiveEvent.HumanResources }); } catch { /* non-fatal */ }
      try { notifyLive(c, { type: LiveEvent.Automation }); } catch { /* non-fatal */ }
      return c.json(row, 201);
    } catch (e) { return chartError(c, e); }
  });

  app.patch("/api/org/chart/positions/:id", async (c) => {
    const me = await getViewerMe(c);
    if (!me) return c.json({ error: "Authentication required" }, 401);
    if (!canManageChart(me)) return c.json({ error: "Requires 'human-resources' permission" }, 403);
    const body = await readBody(c);
    try {
      const row = await updateChartPosition(
        c.req.param("id") ?? "", body || {}, me.user?.name ?? me.user?.email ?? null, await roleTitles(c),
      );
      try { notifyLive(c, { type: LiveEvent.HumanResources }); } catch { /* non-fatal */ }
      try { notifyLive(c, { type: LiveEvent.Automation }); } catch { /* non-fatal */ }
      return c.json(row);
    } catch (e) { return chartError(c, e); }
  });

  app.delete("/api/org/chart/positions/:id", async (c) => {
    const me = await getViewerMe(c);
    if (!me) return c.json({ error: "Authentication required" }, 401);
    if (!canManageChart(me)) return c.json({ error: "Requires 'human-resources' permission" }, 403);
    try {
      const out = await deleteChartPosition(c.req.param("id") ?? "", await roleTitles(c));
      try { notifyLive(c, { type: LiveEvent.HumanResources }); } catch { /* non-fatal */ }
      try { notifyLive(c, { type: LiveEvent.Automation }); } catch { /* non-fatal */ }
      return c.json(out);
    } catch (e) { return chartError(c, e); }
  });
}
