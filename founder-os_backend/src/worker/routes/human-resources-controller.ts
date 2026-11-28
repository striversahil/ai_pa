// routes/human-resources-controller.ts — HR owns the lists that used to be
// free text: employee document types, expense categories, asset types.
// Worker-only.
import type { Hono } from "hono";
import { notifyLive, LiveEvent, type Bindings } from "../context";
import { access, actorLabel, errorResponse } from "./hr-route-shared";
import { readBody } from "../http";
import { createLookup, deleteLookup, listLookups, updateLookup } from "../../automations/human-resources/lookups";
import { isLookupKind } from "../../automations/human-resources/lookups-parse";

export function registerHumanResourcesControllerRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get("/api/human-resources/controller", async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      return c.json(await listLookups());
    } catch (e) { return errorResponse(c, e); }
  });

  app.post("/api/human-resources/controller/:kind", async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: "Only HR/root users can edit the controller" }, 403);
    const kind = c.req.param("kind") ?? "";
    if (!isLookupKind(kind)) return c.json({ error: "unknown controller list" }, 404);
    const body = await readBody(c);
    try {
      const row = await createLookup(kind, body || {}, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row, 201);
    } catch (e) { return errorResponse(c, e); }
  });

  app.patch("/api/human-resources/controller/:kind/:id", async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: "Only HR/root users can edit the controller" }, 403);
    const kind = c.req.param("kind") ?? "";
    if (!isLookupKind(kind)) return c.json({ error: "unknown controller list" }, 404);
    const body = await readBody(c);
    try {
      const row = await updateLookup(kind, c.req.param("id") ?? "", body || {}, actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });

  app.delete("/api/human-resources/controller/:kind/:id", async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: "Only HR/root users can edit the controller" }, 403);
    const kind = c.req.param("kind") ?? "";
    if (!isLookupKind(kind)) return c.json({ error: "unknown controller list" }, 404);
    try {
      // Document requirements are deleted for real; the other lists archive.
      const row = await deleteLookup(kind, c.req.param("id") ?? "", actorLabel(a.me));
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json(row);
    } catch (e) { return errorResponse(c, e); }
  });
}
