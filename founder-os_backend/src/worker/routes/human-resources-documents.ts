// routes/human-resources-documents.ts — per-employee document uploads.
// Metadata in D1, bytes in CHAT_FILES under hrdocs/emp/<uuid>.<ext>.
import type { Hono } from "hono";
import { notifyLive, LiveEvent, type Bindings } from "../context";
import { access, actorLabel, errorResponse } from "./hr-route-shared";
import {
  checkMemberDocSize, isMemberDocMime, MAX_MEMBER_DOC_BYTES, memberDocExt,
} from "../../automations/human-resources/member-documents-parse";
import {
  createMemberDocument, deleteMemberDocument, getMemberDocument, listMemberDocuments,
} from "../../automations/human-resources/member-documents";

export function registerHumanResourcesDocumentRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get("/api/human-resources/members/:id/documents", async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    try {
      return c.json(await listMemberDocuments(c.req.param("id") ?? ""));
    } catch (e) { return errorResponse(c, e); }
  });

  app.post("/api/human-resources/members/:id/documents", async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: "Only HR/root users can upload employee documents" }, 403);
    if (!c.env.CHAT_FILES) return c.json({ error: "File storage is not configured" }, 501);
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: "Expected multipart/form-data" }, 400);
    }
    const documentTypeId = String(form.get("documentTypeId") || "").trim();
    if (!documentTypeId) return c.json({ error: "documentTypeId is required" }, 400);
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "file field required" }, 400);
    if (!isMemberDocMime(file.type)) return c.json({ error: "Only PDF, JPEG, PNG or WebP files are accepted" }, 400);
    if (file.size > MAX_MEMBER_DOC_BYTES) return c.json({ error: "File too large (max 20MB)" }, 413);
    try {
      checkMemberDocSize(file.size);
    } catch (e) { return errorResponse(c, e); }
    const title = String(form.get("title") || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const key = "hrdocs/emp/" + crypto.randomUUID() + "." + memberDocExt(file.type);
    try {
      await c.env.CHAT_FILES.put(key, await file.arrayBuffer(), {
        metadata: { name: file.name, type: file.type },
      });
    } catch {
      return c.json({ error: "Could not store the document — please retry" }, 502);
    }
    try {
      const doc = await createMemberDocument({
        memberId: c.req.param("id") ?? "",
        documentTypeId,
        title,
        fileName: file.name.slice(0, 200),
        mime: file.type,
        size: file.size,
        kvKey: key,
        uploadedBy: String(actorLabel(a.me) ?? "").slice(0, 200),
      });
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true, doc }, 201);
    } catch (e) {
      try { await c.env.CHAT_FILES.delete(key); } catch { /* orphan bytes best-effort */ }
      return errorResponse(c, e);
    }
  });

  app.delete("/api/human-resources/member-docs/:id", async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!a.canManage) return c.json({ error: "Only HR/root users can remove employee documents" }, 403);
    try {
      const { kvKey } = await deleteMemberDocument(c.req.param("id") ?? "");
      if (kvKey && c.env.CHAT_FILES) {
        try { await c.env.CHAT_FILES.delete(kvKey); } catch { /* best-effort */ }
      }
      notifyLive(c, { type: LiveEvent.HumanResources });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  app.get("/api/human-resources/member-docs/:id/file", async (c) => {
    const a = await access(c);
    if (a.error) return a.error;
    if (!c.env.CHAT_FILES) return c.json({ error: "File storage is not configured" }, 501);
    const row = await getMemberDocument(c.req.param("id") ?? "").catch(() => null);
    if (!row?.kvKey || row.deleted) return c.json({ error: "Document not found" }, 404);
    const obj = await c.env.CHAT_FILES.getWithMetadata(String(row.kvKey), "arrayBuffer");
    if (obj.value === null) return c.json({ error: "Document file is missing" }, 404);
    const headers = new Headers();
    headers.set("Content-Type", String(row.mime || "application/pdf"));
    const safeName = String(row.fileName || "document")
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "") || "document";
    headers.set("Content-Disposition", 'inline; filename="' + safeName + '"');
    headers.set("Cache-Control", "private, max-age=300");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(obj.value, { headers });
  });
}
