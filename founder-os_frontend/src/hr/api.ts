import type { HrSalaryPreview, HrSalaryTemplate } from "./types";

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
