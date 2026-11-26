// routes/human-resources-assets.ts — employee-held assets and role standards.
import type { Hono } from "hono";
import { notifyLive, LiveEvent, type Bindings } from "../context";
import { access, actorLabel, errorResponse } from "./hr-route-shared";
import { readBody } from "../http";
import {
  createAsset, createPositionAsset, deleteAsset, deletePositionAsset,
  listAssets, updateAsset, updatePositionAsset,
} from "../../automations/human-resources/assets";

export function registerHumanResourcesAssetRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get("/api/human-resources/assets", async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      return c.json(await listAssets());
    } catch (e) { return errorResponse(c, e); }
  });

  app.post("/api/human-resources/assets", async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: "Only HR/root users can add assets" }, 403);
    const body = await readBody(c);
    try {
      const row = await createAsset(body || {}, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row, 201);
    } catch (e) { return errorResponse(c, e); }
  });

  app.patch("/api/human-resources/assets/:id", async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: "Only HR/root users can edit assets" }, 403);
    const body = await readBody(c);
    try {
      const row = await updateAsset(c.req.param("id") ?? "", body || {}, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  app.delete("/api/human-resources/assets/:id", async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: "Only HR/root users can remove assets" }, 403);
    try {
      await deleteAsset(c.req.param("id") ?? "", actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  app.post("/api/human-resources/position-assets", async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: "Only HR/root users can edit role standards" }, 403);
    const body = await readBody(c);
    try {
      const row = await createPositionAsset(body || {});
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row, 201);
    } catch (e) { return errorResponse(c, e); }
  });

  app.patch("/api/human-resources/position-assets/:id", async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: "Only HR/root users can edit role standards" }, 403);
    const body = await readBody(c);
    try {
      const row = await updatePositionAsset(c.req.param("id") ?? "", body || {});
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  app.delete("/api/human-resources/position-assets/:id", async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: "Only HR/root users can edit role standards" }, 403);
    try {
      await deletePositionAsset(c.req.param("id") ?? "");
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });
}
