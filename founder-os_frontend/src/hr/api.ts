import type {
  HrDelegationBoard, HrDelegationTask, HrEmployee, HrHiringPosition, HrLeave,
  HrMyLeave, HrPositionDoc, HrSalaryPreview, HrSalaryTemplate, HrTaskLog, HiringDocKind,
} from "./types";

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

export async function renameHiringPosition(id: string, name: string): Promise<HrHiringPosition> {
  const res = await jsonRequest(`/api/human-resources/hiring-positions/${id}`, "PATCH", { name });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteHiringPosition(id: string): Promise<void> {
  const res = await jsonRequest(`/api/human-resources/hiring-positions/${id}`, "DELETE");
  if (!res.ok) throw new Error(await readError(res));
}

/** Adds a JD/SOP PDF to a position (roles can hold several of each). */
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
