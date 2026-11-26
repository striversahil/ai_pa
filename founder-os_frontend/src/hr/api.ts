import type {
  HrDelegationBoard, HrDelegationTask, HrEmployee, HrHiringPosition, HrLeave,
  HrMyLeave, HrPositionDoc, HrSalaryPreview, HrSalaryTemplate, HrTaskLog, HiringDocKind,
} from "./types";
import type { HrAsset, HrAssetsData, HrAssetType, HrPositionAsset } from "./assets";
import type { HrControllerData, HrLookup, LookupKind } from "./lookups";
import type { MemberDocumentsPayload } from "./member-documents";
import type { HrRegion, HrRegionsData } from "./regions";

export async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch { /* fall through */ }
  return `Request failed (HTTP ${res.status})`;
}

export async function jsonRequest(url: string, method: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
}

export async function listSalaryTemplates(): Promise<HrSalaryTemplate[]> {
  const res = await fetch("/api/human-resources/salary-templates", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  const body = await res.json();
  return Array.isArray(body?.templates) ? body.templates : [];
}

export async function saveSalaryTemplate(payload: Record<string, unknown>, id?: string): Promise<HrSalaryTemplate> {
  const res = await jsonRequest(
    id ? `/api/human-resources/salary-templates/${id}` : "/api/human-resources/salary-templates",
    id ? "PATCH" : "POST",
    payload,
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteSalaryTemplate(id: string): Promise<void> {
  const res = await jsonRequest(`/api/human-resources/salary-templates/${id}`, "DELETE");
  if (!res.ok) throw new Error(await readError(res));
}

export async function setDefaultSalaryTemplate(id: string): Promise<HrSalaryTemplate> {
  const res = await jsonRequest(`/api/human-resources/salary-templates/${id}/default`, "POST", {});
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function previewSalaryPlan(payload: Record<string, unknown>): Promise<HrSalaryPreview> {
  const res = await jsonRequest("/api/human-resources/salary-templates/preview", "POST", payload);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function applySalaryPlan(memberId: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await jsonRequest(`/api/human-resources/members/${memberId}/salary-plan`, "PUT", payload);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function reapplySalaryPlan(memberId: string): Promise<unknown> {
  const res = await jsonRequest(`/api/human-resources/members/${memberId}/salary-plan/reapply`, "POST", {});
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// ── Hiring kit ──────────────────────────────────────────────────────────────

export async function listHiringPositions(): Promise<{ positions: HrHiringPosition[]; canManage: boolean }> {
  const res = await fetch("/api/human-resources/hiring-positions", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  const body = await res.json();
  return {
    positions: Array.isArray(body?.positions) ? body.positions : [],
    canManage: !!body?.canManage,
  };
}

export async function createHiringPosition(name: string): Promise<HrHiringPosition> {
  const res = await jsonRequest("/api/human-resources/hiring-positions", "POST", { name });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function importHiringPositions(names: string[]): Promise<{ created: number; skipped: number; positions: HrHiringPosition[] }> {
  const res = await jsonRequest("/api/human-resources/hiring-positions/import", "POST", { names });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateHiringPosition(
  id: string,
  patch: { name?: string; videoUrl?: string | null },
): Promise<HrHiringPosition> {
  const res = await jsonRequest(`/api/human-resources/hiring-positions/${id}`, "PATCH", patch);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function renameHiringPosition(id: string, name: string): Promise<HrHiringPosition> {
  return updateHiringPosition(id, { name });
}

/** One link per position; null clears it. */
export async function saveHiringVideoUrl(id: string, videoUrl: string | null): Promise<HrHiringPosition> {
  return updateHiringPosition(id, { videoUrl });
}

export async function deleteHiringPosition(id: string): Promise<void> {
  const res = await jsonRequest(`/api/human-resources/hiring-positions/${id}`, "DELETE");
  if (!res.ok) throw new Error(await readError(res));
}

/** Adds a JD/SOP/questionnaire PDF to a position (several of each allowed). */
export async function uploadPositionDoc(positionId: string, kind: HiringDocKind, file: File, title?: string): Promise<HrPositionDoc> {
  const fd = new FormData();
  fd.append("kind", kind);
  if (title && title.trim()) fd.append("title", title.trim());
  fd.append("file", file);
  const res = await fetch(`/api/human-resources/hiring-positions/${positionId}/docs`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = await res.json();
  return body?.doc as HrPositionDoc;
}

export async function deletePositionDoc(id: string): Promise<void> {
  const res = await jsonRequest(`/api/human-resources/position-docs/${id}`, "DELETE");
  if (!res.ok) throw new Error(await readError(res));
}

// ── Delegation board (employee self-service) ────────────────────────────────
// All reads/writes are session-scoped on the server: an employee only ever gets
// their own tasks, HR users get the whole board.

export async function fetchDelegationBoard(date?: string): Promise<HrDelegationBoard> {
  const res = await fetch(`/api/delegation/board${date ? `?date=${encodeURIComponent(date)}` : ""}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function createDelegationTask(payload: Record<string, unknown>): Promise<HrDelegationTask> {
  const res = await jsonRequest("/api/delegation/tasks", "POST", payload);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateDelegationTask(id: string, payload: Record<string, unknown>): Promise<HrDelegationTask> {
  const res = await jsonRequest(`/api/delegation/tasks/${id}`, "PATCH", payload);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteDelegationTask(id: string): Promise<void> {
  const res = await jsonRequest(`/api/delegation/tasks/${id}`, "DELETE");
  if (!res.ok) throw new Error(await readError(res));
}

export async function fetchTaskHistory(id: string): Promise<{ task: HrDelegationTask; logs: HrTaskLog[] }> {
  const res = await fetch(`/api/delegation/tasks/${id}/logs`, { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** HR links (or unlinks) a roster member to a platform login. */
export async function setMemberLoginEmail(memberId: string, loginEmail: string | null): Promise<void> {
  const res = await jsonRequest(`/api/delegation/members/${memberId}/login-email`, "PUT", { loginEmail });
  if (!res.ok) throw new Error(await readError(res));
}

/** Employee master read (active + inactive). One fetcher for every HR surface
 *  that needs seats (Employees tab, Organization tree) — never a raw fetch. */
export async function listMembers(): Promise<HrEmployee[]> {
  const res = await jsonRequest("/api/human-resources/members", "GET");
  if (!res.ok) throw new Error(await readError(res));
  const body = await res.json();
  return (body?.members ?? []) as HrEmployee[];
}

// ── Leave applications (employee self-service + HR decision) ────────────────
// Applying is open to every approved login; the server pins the caller's own
// roster member. Decisions are HR-scope only and live on the same table, so
// attendance and payroll read one source of truth.

export async function fetchMyLeave(): Promise<HrMyLeave> {
  const res = await fetch("/api/leave/mine", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  const body = await res.json();
  return {
    linked: !!body?.linked,
    self: body?.self ?? null,
    requests: Array.isArray(body?.requests) ? body.requests : [],
  };
}

export async function applyLeaveRequest(payload: Record<string, unknown>): Promise<HrLeave> {
  const res = await jsonRequest("/api/leave/requests", "POST", payload);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// ── Controller lists (document types, expense categories, asset types) ───────

export async function fetchController(): Promise<HrControllerData> {
  const res = await fetch("/api/human-resources/controller", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function createLookup(kind: LookupKind, body: Record<string, unknown>): Promise<HrLookup> {
  const res = await jsonRequest("/api/human-resources/controller/" + kind, "POST", body);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateLookup(kind: LookupKind, id: string, body: Record<string, unknown>): Promise<HrLookup> {
  const res = await jsonRequest("/api/human-resources/controller/" + kind + "/" + id, "PATCH", body);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function archiveLookup(kind: LookupKind, id: string): Promise<HrLookup> {
  const res = await fetch("/api/human-resources/controller/" + kind + "/" + id, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchExpenseCategories(includeArchived = false): Promise<HrLookup[]> {
  return (await fetchController()).expenseCategories.filter((c) => includeArchived || c.active);
}

// ── Sales regions + position allotment (HR Controller) ─────────────────────

export async function fetchRegions(): Promise<HrRegionsData> {
  const res = await fetch("/api/human-resources/regions", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateRegion(code: string, body: Record<string, unknown>): Promise<HrRegion> {
  const res = await jsonRequest(`/api/human-resources/regions/${encodeURIComponent(code)}`, "PATCH", body);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function savePositionRegions(positionId: string, regions: string[]): Promise<void> {
  const res = await jsonRequest(`/api/human-resources/position-regions/${encodeURIComponent(positionId)}`, "PUT", { regions });
  if (!res.ok) throw new Error(await readError(res));
}

// ── Employee assets + position standards ────────────────────────────────────

export async function fetchAssets(): Promise<HrAssetsData> {
  const res = await fetch("/api/human-resources/assets", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function saveAsset(body: Record<string, unknown>, id?: string): Promise<HrAsset> {
  const res = await jsonRequest("/api/human-resources/assets" + (id ? "/" + id : ""), id ? "PATCH" : "POST", body);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function removeAsset(id: string): Promise<void> {
  const res = await fetch("/api/human-resources/assets/" + id, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res));
}

export async function savePositionAsset(body: Record<string, unknown>, id?: string): Promise<HrPositionAsset> {
  const res = await jsonRequest("/api/human-resources/position-assets" + (id ? "/" + id : ""), id ? "PATCH" : "POST", body);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function removePositionAsset(id: string): Promise<void> {
  const res = await fetch("/api/human-resources/position-assets/" + id, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res));
}

// ── Employee documents ──────────────────────────────────────────────────────

export async function fetchMemberDocuments(memberId: string): Promise<MemberDocumentsPayload> {
  const res = await fetch("/api/human-resources/members/" + encodeURIComponent(memberId) + "/documents", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function uploadMemberDocument(memberId: string, documentTypeId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append("documentTypeId", documentTypeId);
  form.append("file", file);
  const res = await fetch("/api/human-resources/members/" + encodeURIComponent(memberId) + "/documents", { method: "POST", body: form });
  if (!res.ok) throw new Error(await readError(res));
}

export async function deleteMemberDocument(documentId: string): Promise<void> {
  const res = await fetch("/api/human-resources/member-docs/" + encodeURIComponent(documentId), { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res));
}

export async function cancelLeaveRequest(id: string): Promise<void> {
  const res = await jsonRequest(`/api/leave/requests/${id}/cancel`, "POST");
  if (!res.ok) throw new Error(await readError(res));
}

/** HR queue — month-free, every status, newest first. */
export async function fetchLeaveRequests(status: "all" | "pending" | "approved" | "rejected" = "all"): Promise<HrLeave[]> {
  const res = await fetch(`/api/human-resources/leave-requests?status=${status}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  const body = await res.json();
  return Array.isArray(body?.requests) ? body.requests : [];
}

/** Approve or reject. A rejection note is mandatory server-side too. */
export async function decideLeaveRequest(
  id: string, action: "approve" | "reject", note: string,
): Promise<HrLeave> {
  const res = await jsonRequest(`/api/human-resources/leave-requests/${id}/decide`, "POST", {
    action,
    note: note.trim() || null,
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
