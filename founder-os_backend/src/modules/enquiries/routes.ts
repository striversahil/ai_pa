import { Enquiry, EnquiryStore } from "./store";
import type { MeResponse } from "../auth/types";
import { LiveEvent } from "../../live";

export interface EnquiryResult {
  status: number;
  body: any;
  live?: { type: string; extra: Record<string, unknown> };
}

const json = (status: number, body: any): EnquiryResult => ({ status, body });
const err = (message: string, status = 403): EnquiryResult => json(status, { error: message });

function pick(data: any): Partial<Enquiry> | null {
  const map: any = {
    estNumber: "estNumber", clientCompany: "clientCompany", contactName: "contactName",
    contactEmail: "contactEmail", contactPhone: "contactPhone",
    title: "title", description: "description",
    priority: "priority", status: "status", assignedAgentId: "assignedAgentId",
    imageUrls: "imageUrls", activities: "activities",
  };
  const out: any = {};
  for (const [k, v] of Object.entries(map)) {
    if (data[k] !== undefined) out[k] = data[k];
  }
  if (data.additionalRequirements !== undefined) {
    out.additionalRequirements = (Array.isArray(data.additionalRequirements) ? data.additionalRequirements : [])
      .map((r: any) => (typeof r === "string" ? { text: r } : { text: String(r?.text ?? ""), imageUrl: r?.imageUrl || undefined }))
      .filter((r: any) => r.text.trim().length > 0);
  }
  return Object.keys(out).length ? out : null;
}

export async function enquiryList(store: EnquiryStore, me: MeResponse): Promise<EnquiryResult> {
  const [enquiries, comments] = await Promise.all([store.listEnquiries(), store.listAllComments()]);
  return json(200, { enquiries, comments });
}

export async function enquiryCreate(store: EnquiryStore, me: MeResponse, body: any): Promise<EnquiryResult> {
  // Only EST No. is mandatory — everything else is LLM-auto-filled from the
  // description (extract.ts), so structured fields are optional on input.
  if (!body?.estNumber || String(body.estNumber).trim() === "") return json(400, { error: "estNumber required" });
  const enquiry = await store.createEnquiry({
    estNumber: String(body.estNumber).trim(),
    clientCompany: body.clientCompany,
    contactName: body.contactName,
    contactEmail: body.contactEmail || "",
    contactPhone: body.contactPhone || "",
    title: body.title,
    description: body.description,
    priority: body.priority || "medium",
    status: body.status || "new",
    assignedAgentId: String(body.assignedAgentId || ""),
    imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls : [],
    activities: Array.isArray(body.activities) ? body.activities : [],
    additionalRequirements: (Array.isArray(body.additionalRequirements) ? body.additionalRequirements : [])
      .map((r: any) => (typeof r === "string" ? { text: r } : { text: String(r?.text ?? ""), imageUrl: r?.imageUrl || undefined }))
      .filter((r: any) => r.text.trim().length > 0),
  });
  return {
    status: 201,
    body: enquiry,
    live: { type: LiveEvent.Enquiries, extra: { action: "created", enquiry } },
  };
}

export async function enquiryAddRequirement(store: EnquiryStore, me: MeResponse, id: string, body: any): Promise<EnquiryResult> {
  const text = String(body?.text || "").trim();
  if (!text) return json(400, { error: "text required" });
  const imageUrl = body?.imageUrl ? String(body.imageUrl) : undefined;
  const existing = await store.getEnquiry(id);
  if (!existing) return json(404, { error: "not found" });
  const requirements = [...(existing.additionalRequirements || []), { text, imageUrl }];
  const enquiry = await store.updateEnquiry(id, { additionalRequirements: requirements });
  if (!enquiry) return json(404, { error: "not found" });
  return {
    status: 201,
    body: { requirement: { text, imageUrl }, enquiry },
    live: { type: LiveEvent.Enquiries, extra: { action: "requirement", id, requirement: { text, imageUrl }, enquiry } },
  };
}

export async function enquiryUpdate(store: EnquiryStore, me: MeResponse, id: string, body: any): Promise<EnquiryResult> {
  const updates = pick(body || {});
  if (!updates) return json(400, { error: "no valid fields" });
  const enquiry = await store.updateEnquiry(id, updates);
  if (!enquiry) return json(404, { error: "not found" });
  return {
    status: 200,
    body: enquiry,
    live: { type: LiveEvent.Enquiries, extra: { action: "updated", enquiry } },
  };
}

export async function enquiryDelete(store: EnquiryStore, me: MeResponse, id: string): Promise<EnquiryResult> {
  await store.deleteEnquiry(id);
  return { status: 200, body: { ok: true }, live: { type: LiveEvent.Enquiries, extra: { action: "deleted", id } } };
}

export async function enquiryComments(store: EnquiryStore, me: MeResponse, enquiryId: string): Promise<EnquiryResult> {
  return json(200, await store.listComments(enquiryId));
}

export async function enquiryAddComment(store: EnquiryStore, me: MeResponse, enquiryId: string, body: any): Promise<EnquiryResult> {
  const content = String(body?.content || "").trim();
  if (!content) return json(400, { error: "content required" });
  const comment = await store.addComment({
    enquiryId,
    agentId: Number(body?.agentId) || 0,
    content,
    parentId: body?.parentId ? String(body.parentId) : null,
    imageUrl: body?.imageUrl ? String(body.imageUrl) : undefined,
  });
  return {
    status: 201,
    body: comment,
    live: { type: LiveEvent.Enquiries, extra: { action: "comment", comment } },
  };
}