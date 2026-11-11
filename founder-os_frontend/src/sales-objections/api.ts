// sales-objections/api.ts — Objections worker calls (Worker-only).
// All writes broadcast live; the panel refetches via useLiveDashboard.

import type { SalesObjection } from "./types";

async function req(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { ...init, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((body as any)?.error ?? `request failed (${res.status})`));
  return body;
}

export async function fetchObjections(params: {
  status?: string; category?: string; q?: string;
}): Promise<{ objections: SalesObjection[] }> {
  const qs = new URLSearchParams();
  if (params.status && params.status !== "all") qs.set("status", params.status);
  if (params.category && params.category !== "all") qs.set("category", params.category);
  if (params.q?.trim()) qs.set("q", params.q.trim());
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return req(`/api/sales-objections${suffix}`);
}

export async function fileObjection(args: {
  estNumber: string; clientName: string; category: string; detail: string;
}): Promise<{ objection: SalesObjection }> {
  return req("/api/sales-objections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

export async function replyObjection(id: string, text: string): Promise<{ objection: SalesObjection }> {
  return req(`/api/sales-objections/${encodeURIComponent(id)}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export async function setObjectionStatus(id: string, status: "open" | "resolved"): Promise<{ objection: SalesObjection }> {
  return req(`/api/sales-objections/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}
